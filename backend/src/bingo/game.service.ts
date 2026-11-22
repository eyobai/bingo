import { HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AccountType, RoundStatus, TxType } from '@prisma/client';
import type { Room, Round } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { AppError, isUniqueViolation, money } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { LedgerService, type PostingLine } from '../ledger/ledger.service';
import { NotifyService } from '../notify.service';
import { PrismaService, Tx } from '../prisma.service';
import { type CardLayout, completeLines, generateCardSet } from './cards';
import { ballOrder, newServerSeed } from './fair';
import { settle } from './prize';
import { automatedName } from './automated-names';

/** Selling stops this long before the countdown hits zero, so a purchase never races the round start. */
const CLOSE_GRACE_MS = 300;
const CANCELLED_PAUSE_MS = 4000;
export const MIN_PLAYERS = 2;
export const PRACTICE_ROOM_ID = 'practice';
export const HOUSE_CASH_ROOM_ID = 'house-cash';
export const isManagedRoom = (id: string) => id === PRACTICE_ROOM_ID || id === HOUSE_CASH_ROOM_ID;

const PRACTICE_ROOM = {
  name: 'Practice',
  stakeMinor: 0n,
  guaranteedPrizeMinor: 0n,
  houseCutBps: 0,
  cardPool: 100,
  minCards: 1,
  selectSeconds: 20,
  callIntervalMs: 2000,
  sortOrder: -1,
  isActive: true,
};
// Reserved cards let sample players resume with the round without creating user or wallet records.
const SAMPLE_CARDS = [PRACTICE_ROOM.cardPool - 1, PRACTICE_ROOM.cardPool];
/** How many automated players (not cards) are in a round. */
export function automatedPlayersIn(round: Pick<Round, 'houseCards' | 'houseOwners'>) {
  return round.houseOwners.length ? new Set(round.houseOwners).size : round.houseCards.length;
}
function reservedCards(round: Round) {
  if (round.roomId === PRACTICE_ROOM_ID) return SAMPLE_CARDS;
  return round.houseCards;
}

/** One room per stake, shown in the lobby in this order. */
const DEFAULT_ROOMS = [
  { id: 'r10', name: 'Classic', stakeMinor: 1_000n, cardPool: 400, sortOrder: 0 },
  { id: 'r20', name: 'Silver', stakeMinor: 2_000n, cardPool: 400, sortOrder: 1 },
  { id: 'r50', name: 'Gold', stakeMinor: 5_000n, cardPool: 400, sortOrder: 2 },
  { id: 'r100', name: 'VIP', stakeMinor: 10_000n, cardPool: 400, sortOrder: 3 },
  { id: 'r200', name: 'VVIP', stakeMinor: 20_000n, cardPool: 400, sortOrder: 4 },
];
/** Card numbers run 1..1000 at most; rooms choose how many of them to offer. */
export const MAX_CARD_POOL = 1000;

interface LiveWinner {
  cardNo: number;
  name: string;
  sampleNo?: number;
  /** A house-funded automated player in a paid room: its prize goes to the house bankroll. */
  automated?: boolean;
  lineIndex: number;
  layout: CardLayout;
}

type DrawWinner = { cardNo: number; lineIndex: number } & ({ userId: string } | { sampleNo: number });

interface LiveRoom {
  room: Room;
  round: Round;
  order: number[];
  /** cardNo -> owner userId, for cards sold this round. */
  cards: Map<number, string>;
  called: Set<number>;
  timer?: NodeJS.Timeout;
  result?: { winners: LiveWinner[]; prizePerWinnerMinor: bigint; nextRoundAt: Date };
  cancelled?: { reason: string; nextRoundAt: Date };
  pendingWinners?: DrawWinner[];
  busy: boolean;
}

export interface GameEvents {
  /** Public state of a room changed. */
  state: [string];
}

/**
 * Runs every active room on a loop: SELECTING (countdown, players pick cards) → DRAWING (a ball every few
 * seconds; every card is checked after each ball) → FINISHED (prize paid, winners shown) → next round.
 *
 * The database is the source of truth for money and card ownership: a card purchase and the start of the
 * draw both lock the round row, so nobody can buy after the draw has begun. The ball order comes from a
 * secret committed (hashed) before the first card is sold, and the secret is published when the round ends.
 *
 * Timers live in this process, so run ONE instance of the server. On restart, open rounds are picked up
 * where they left off.
 */
@Injectable()
export class GameService extends EventEmitter<GameEvents> implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Game');
  private readonly live = new Map<string, LiveRoom>();
  private cardSet: CardLayout[] = [];
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly notify: NotifyService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
    this.setMaxListeners(50);
  }

  async onApplicationBootstrap() {
    if (this.config.seedRooms) {
      // The standard stake rooms. Only missing ones are added: staff can rename them, change them or switch them off.
      await this.prisma.room.createMany({ data: DEFAULT_ROOMS, skipDuplicates: true });
      // Rename the first room from its old default name to match the others.
      await this.prisma.room.updateMany({ where: { id: 'r10', name: '10 Birr Game' }, data: { name: 'Classic' } });
    }
    const rooms = await this.prisma.room.findMany({
      where: { isActive: true, id: { notIn: [PRACTICE_ROOM_ID, HOUSE_CASH_ROOM_ID] } },
      orderBy: { sortOrder: 'asc' },
    });
    if (this.config.practiceRoomEnabled) {
      rooms.push(
        await this.prisma.room.upsert({
          where: { id: PRACTICE_ROOM_ID },
          create: { id: PRACTICE_ROOM_ID, ...PRACTICE_ROOM },
          update: PRACTICE_ROOM,
        }),
      );
    }
    // Retire empty countdowns and finish only rounds with money already in the pot.
    await this.prisma.round.updateMany({
      where: { roomId: HOUSE_CASH_ROOM_ID, status: RoundStatus.SELECTING, houseStakeMinor: 0n, cards: { none: {} } },
      data: { status: RoundStatus.CANCELLED, finishedAt: new Date() },
    });
    const cashRound = await this.prisma.round.findFirst({
      where: { roomId: HOUSE_CASH_ROOM_ID, status: { in: [RoundStatus.SELECTING, RoundStatus.DRAWING] }, houseStakeMinor: { gt: 0n } },
      include: { room: true },
    });
    if (cashRound) rooms.push(cashRound.room);
    this.cardSet = generateCardSet(MAX_CARD_POOL, this.config.cardSetSeed);
    for (const room of rooms) await this.resume(room);
  }

  /** Starts a room that staff just switched on. A running room picks up new settings at its next round. */
  async ensureRoom(roomId: string) {
    if (isManagedRoom(roomId) || this.live.has(roomId)) return;
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (room?.isActive) await this.resume(room);
  }

  onModuleDestroy() {
    this.stopped = true;
    for (const l of this.live.values()) clearTimeout(l.timer);
    for (const timer of this.pending.values()) clearTimeout(timer);
  }

  // ─── Public reads ─────────────────────────────────────────────────────────

  card(cardNo: number): CardLayout | undefined {
    return this.cardSet[cardNo - 1];
  }

  cards(pool: number): CardLayout[] {
    return this.cardSet.slice(0, pool);
  }

  /** Open rooms, in lobby order. */
  roomIds(): string[] {
    return [...this.live.values()]
      .sort((a, b) => a.room.sortOrder - b.room.sortOrder || Number(a.room.stakeMinor - b.room.stakeMinor))
      .map((l) => l.room.id);
  }

  /** The prize if every card in the room were sold: the most a single winner can get in one round. */
  maxWinMinor(roomId: string): bigint {
    const l = this.live.get(roomId);
    if (!l || roomId === PRACTICE_ROOM_ID) return 0n;
    const { room } = l;
    return settle({ stakeTotalMinor: BigInt(room.cardPool) * room.stakeMinor, houseCutBps: room.houseCutBps, guaranteedMinor: room.guaranteedPrizeMinor, winners: 1 }).prizeMinor;
  }

  /** Everything a viewer of the room may see. Never includes the server seed of a running round. */
  publicState(roomId: string) {
    const l = this.live.get(roomId);
    if (!l) return null;
    const { room, round } = l;
    const practice = roomId === PRACTICE_ROOM_ID;
    const houseCash = roomId === HOUSE_CASH_ROOM_ID;
    const reserved = reservedCards(round);
    const preview =
      !practice && (round.stakeTotalMinor > 0n || round.guaranteedMinor > 0n)
        ? settle({ stakeTotalMinor: round.stakeTotalMinor, houseCutBps: round.houseCutBps, guaranteedMinor: round.guaranteedMinor, winners: 1 }).prizeMinor
        : 0n;
    const finished = round.status === RoundStatus.FINISHED;
    return {
      serverTime: new Date().toISOString(),
      room: {
        id: room.id,
        name: room.name,
        practice,
        houseCash,
        entriesPaused: houseCash,
        samplePlayers: reserved.length,
        houseCards: houseCash ? reserved : [],
        /** House-funded automated players announced for this round (0 = none). Shown before anyone buys. */
        automatedPlayers: practice ? 0 : round.housePlanned,
        /** Each automated player takes 1 up to this many cards. */
        automatedMaxCards: Math.max(1, Math.min(room.automatedMaxCards, room.maxCardsPerPlayer)),
        stake: money(room.stakeMinor),
        cardPool: room.cardPool,
        maxCardsPerPlayer: room.maxCardsPerPlayer,
        selectSeconds: room.selectSeconds,
        callIntervalMs: room.callIntervalMs,
        guaranteedPrize: money(room.guaranteedPrizeMinor),
      },
      round: {
        id: round.id,
        number: round.number,
        status: round.status,
        seedHash: round.seedHash,
        serverSeed: finished ? round.serverSeed : null,
        selectEndsAt: round.selectEndsAt.toISOString(),
        startedAt: round.startedAt?.toISOString() ?? null,
        calls: round.calls,
        cardsSold: round.cardsSold,
        players: new Set(l.cards.values()).size,
        prize: money(finished ? round.prizeMinor : preview),
        taken: [...l.cards.keys(), ...reserved].sort((a, b) => a - b),
        /** Automated players who joined (one card each) and their card numbers. */
        automated: practice ? 0 : automatedPlayersIn(round),
        automatedCards: practice ? [] : [...round.houseCards].sort((a, b) => a - b),
      },
      result: l.result
        ? {
            prizePerWinner: money(l.result.prizePerWinnerMinor),
            nextRoundAt: l.result.nextRoundAt.toISOString(),
            winners: l.result.winners,
          }
        : null,
      cancelled: l.cancelled ? { reason: l.cancelled.reason, nextRoundAt: l.cancelled.nextRoundAt.toISOString() } : null,
    };
  }

  myCards(roomId: string, userId: string): number[] {
    const l = this.live.get(roomId);
    if (!l) return [];
    return [...l.cards.entries()].filter(([, u]) => u === userId).map(([c]) => c).sort((a, b) => a - b);
  }

  // ─── Player actions ───────────────────────────────────────────────────────

  async buyCards(userId: string, roomId: string, cardNos: number[], acceptAutomatedPlayers = false) {
    if (roomId === HOUSE_CASH_ROOM_ID) {
      throw new AppError(HttpStatus.NOT_FOUND, 'ROOM_NOT_FOUND', 'This game room is closed.');
    }
    const l = this.requireRoom(roomId);
    const practice = roomId === PRACTICE_ROOM_ID;
    const unique = [...new Set(cardNos)];
    if (!unique.length || unique.some((n) => !Number.isInteger(n) || n < 1 || n > l.room.cardPool)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_CARD', `Pick card numbers between 1 and ${l.room.cardPool}.`);
    }
    const roundId = l.round.id;
    try {
      const updated = await this.ledger.withTx(async (tx) => {
        const round = await this.lockRound(tx, roundId);
        this.assertSelling(round);
        if (round.housePlanned > 0 && !acceptAutomatedPlayers) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            'AUTOMATED_TERMS_REQUIRED',
            'House-funded automated players take part in this room and can win. Confirm you understand before buying a card.',
          );
        }
        const stake = practice ? 0n : round.stakeMinor;
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.isBlocked) throw new AppError(HttpStatus.FORBIDDEN, 'BLOCKED', 'Your account is blocked. Contact support.');
        if (this.config.requirePhone && !user.phone) {
          throw new AppError(
            HttpStatus.FORBIDDEN,
            'PHONE_REQUIRED',
            'Register first: open the bot, press Start and share your phone number. / መጀመሪያ ይመዝገቡ፦ ቦቱን ከፍተው ስልክ ቁጥርዎን ያጋሩ።',
          );
        }
        // One query answers both "how many do I hold" and "is any of these taken".
        const relevant = await tx.card.findMany({
          where: { roundId, OR: [{ userId }, { cardNo: { in: unique } }] },
          select: { cardNo: true, userId: true },
        });
        const owned = relevant.filter((c) => c.userId === userId).length;
        const reserved = reservedCards(round);
        const taken = unique.filter((n) => relevant.some((c) => c.cardNo === n) || reserved.includes(n));
        if (taken.length) throw this.takenError(taken);
        if (owned + unique.length > l.room.maxCardsPerPlayer) {
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'TOO_MANY_CARDS',
            `You can hold up to ${l.room.maxCardsPerPlayer} cards per round.`,
          );
        }

        const accounts = practice ? undefined : await this.ledger.userAccounts(userId, tx);
        // Bonus (play) money is spent first, card by card.
        let playLeft = accounts?.play.balanceMinor ?? 0n;
        const rows = unique.map((cardNo) => {
          const fromPlay = playLeft >= stake ? stake : playLeft > 0n ? playLeft : 0n;
          playLeft -= fromPlay;
          return { roundId, cardNo, userId, paidPlayMinor: fromPlay, paidMainMinor: stake - fromPlay };
        });
        await tx.card.createMany({ data: rows });
        const total = stake * BigInt(rows.length);
        const joinPending = !practice && round.housePlanned > 0 && !round.houseCards.length && !round.houseSkipped;
        if (accounts) {
          const fromPlay = rows.reduce((s, r) => s + r.paidPlayMinor, 0n);
          const bankroll = joinPending ? await this.ledger.systemAccount(AccountType.HOUSE_BANKROLL, tx) : undefined;
          const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
          // The fallback purchase posts twice; lock both postings' accounts together.
          if (bankroll) await this.ledger.lockAccounts(tx, [accounts.play.id, accounts.main.id, pot.id, bankroll.id]);
          await this.ledger.post(
            {
              type: TxType.CARD_PURCHASE,
              description: `Round #${round.number}: card${rows.length > 1 ? 's' : ''} ${unique.map((n) => '#' + n).join(', ')}`,
              metadata: { roundId, cards: unique, ...(round.housePlanned > 0 ? { acceptedAutomatedPlayers: true, automatedAnnounced: round.housePlanned } : {}) },
              lines: [
                { accountId: accounts.play.id, amountMinor: -fromPlay },
                { accountId: accounts.main.id, amountMinor: -(total - fromPlay) },
                { accountId: pot.id, amountMinor: total },
              ],
            },
            tx,
          );
        }
        const afterHuman = await tx.round.update({
          where: { id: roundId },
          data: { cardsSold: { increment: rows.length }, stakeTotalMinor: { increment: total } },
        });
        // Normally automated players join when the countdown starts; if that failed, they join now.
        if (joinPending) {
          return this.joinAutomated(tx, afterHuman);
        }
        return afterHuman;
      });
      l.round = {
        ...l.round,
        cardsSold: updated.cardsSold,
        stakeTotalMinor: updated.stakeTotalMinor,
        houseCards: updated.houseCards,
        houseOwners: updated.houseOwners,
        houseStakeMinor: updated.houseStakeMinor,
        houseSkipped: updated.houseSkipped,
      };
    } catch (e) {
      if (isUniqueViolation(e)) {
        const taken = await this.prisma.card.findMany({ where: { roundId, cardNo: { in: unique } }, select: { cardNo: true } });
        throw this.takenError(taken.map((t) => t.cardNo));
      }
      throw e;
    }
    if (l.round.id === roundId) for (const n of unique) l.cards.set(n, userId);
    this.changed(roomId);
    if (!practice) this.notify.emit('walletChanged', userId);
    return this.myCards(roomId, userId);
  }

  /** Gives a card back before the countdown ends; the money returns to where it came from. */
  async returnCard(userId: string, roomId: string, cardNo: number) {
    const l = this.requireRoom(roomId);
    const practice = roomId === PRACTICE_ROOM_ID;
    const roundId = l.round.id;
    await this.ledger.withTx(async (tx) => {
      const round = await this.lockRound(tx, roundId);
      this.assertSelling(round);
      const card = await tx.card.findUnique({ where: { roundId_cardNo: { roundId, cardNo } } });
      if (!card || card.userId !== userId) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_YOUR_CARD', 'That card is not yours.');
      await tx.card.delete({ where: { id: card.id } });
      const total = card.paidPlayMinor + card.paidMainMinor;
      if (!practice) {
        const { main, play } = await this.ledger.userAccounts(userId, tx);
        const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
        await this.ledger.post(
          {
            type: TxType.CARD_REFUND,
            description: `Round #${round.number}: card #${cardNo} returned`,
            metadata: { roundId, cardNo },
            lines: [
              { accountId: pot.id, amountMinor: -total },
              { accountId: play.id, amountMinor: card.paidPlayMinor },
              { accountId: main.id, amountMinor: card.paidMainMinor },
            ],
          },
          tx,
        );
      }
      const updated = await tx.round.update({
        where: { id: roundId },
        data: { cardsSold: { decrement: 1 }, stakeTotalMinor: { decrement: total } },
      });
      l.round = { ...l.round, cardsSold: updated.cardsSold, stakeTotalMinor: updated.stakeTotalMinor };
    });
    if (l.round.id === roundId) l.cards.delete(cardNo);
    this.changed(roomId);
    if (!practice) this.notify.emit('walletChanged', userId);
    return this.myCards(roomId, userId);
  }

  /**
   * Each announced automated player takes a random number of cards (1 up to the room's setting, never more than
   * a real player may hold), at the round's normal stake, paid from the house bankroll. Cards are picked at random
   * from those still free. A player the bankroll cannot pay for gets fewer cards, or is skipped (and counted);
   * nothing is ever paid from anywhere else.
   */
  private async joinAutomated(tx: Tx, round: Round): Promise<Round> {
    const stake = round.stakeMinor;
    const room = await tx.room.findUniqueOrThrow({
      where: { id: round.roomId },
      select: { cardPool: true, automatedMaxCards: true, maxCardsPerPlayer: true },
    });
    const maxEach = Math.max(1, Math.min(room.automatedMaxCards, room.maxCardsPerPlayer));
    const bankroll = await this.ledger.systemAccount(AccountType.HOUSE_BANKROLL, tx);
    const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
    const balance = (await this.ledger.lockAccounts(tx, [bankroll.id, pot.id])).get(bankroll.id)!.balance_minor;
    const taken = new Set((await tx.card.findMany({ where: { roundId: round.id }, select: { cardNo: true } })).map((c) => c.cardNo));
    const free = Array.from({ length: room.cardPool }, (_, i) => i + 1).filter((n) => !taken.has(n));
    let affordable = stake > 0n ? Number(balance / stake > 100_000n ? 100_000n : balance / stake) : 0;
    const cards: number[] = [];
    const owners: number[] = [];
    let joined = 0;
    for (let player = 1; player <= round.housePlanned; player++) {
      const wanted = randomInt(1, maxEach + 1);
      const count = Math.min(wanted, affordable, free.length);
      if (count < 1) continue; // skipped: no money or no free cards left
      joined++;
      affordable -= count;
      for (let i = 0; i < count; i++) {
        cards.push(free.splice(randomInt(free.length), 1)[0]);
        owners.push(joined);
      }
    }
    const skipped = round.housePlanned - joined;
    const houseStake = stake * BigInt(cards.length);
    if (cards.length > 0) {
      await this.ledger.post(
        {
          type: TxType.CARD_PURCHASE,
          description: `Round #${round.number}: ${joined} automated player${joined > 1 ? 's' : ''}, ${cards.length} card${cards.length > 1 ? 's' : ''} (house bankroll)`,
          idempotencyKey: `automated-entry:${round.id}`,
          metadata: { roundId: round.id, automated: true, cards, owners, announced: round.housePlanned, joined, skipped, stakeMinor: stake.toString() },
          lines: [
            { accountId: bankroll.id, amountMinor: -houseStake },
            { accountId: pot.id, amountMinor: houseStake },
          ],
        },
        tx,
      );
    }
    if (skipped > 0) {
      this.logger.warn(
        `Round #${round.number} (${round.roomId}): ${skipped} of ${round.housePlanned} automated players skipped; bankroll ${money(balance).birr} birr, stake ${money(stake).birr} birr`,
      );
    }
    return tx.round.update({
      where: { id: round.id },
      data: {
        houseCards: cards,
        houseOwners: owners,
        houseStakeMinor: houseStake,
        houseSkipped: skipped,
        cardsSold: { increment: cards.length },
        stakeTotalMinor: { increment: houseStake },
      },
    });
  }

  // ─── Round lifecycle ──────────────────────────────────────────────────────

  private async resume(room: Room) {
    const open = await this.prisma.round.findFirst({
      where: {
        roomId: room.id,
        status: { in: [RoundStatus.SELECTING, RoundStatus.DRAWING] },
        ...(room.id === HOUSE_CASH_ROOM_ID ? { houseStakeMinor: { gt: 0n } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { cards: { select: { cardNo: true, userId: true } } },
    });
    if (!open) return this.openRound(room);
    const { cards, ...round } = open;
    const l: LiveRoom = {
      room,
      round,
      order: ballOrder(round.serverSeed, round.number),
      cards: new Map(cards.map((c) => [c.cardNo, c.userId])),
      called: new Set(round.calls),
      busy: false,
    };
    this.live.set(room.id, l);
    this.logger.log(`Resumed ${room.id} round #${round.number} (${round.status})`);
    if (round.status === RoundStatus.SELECTING) {
      this.schedule(l, round.selectEndsAt.getTime() - Date.now(), () => this.closeSelection(l));
    } else {
      l.pendingWinners = this.findWinners(l);
      this.schedule(l, room.callIntervalMs, () => this.drawNext(l));
    }
  }

  private async openRound(room: Room) {
    if (this.stopped) return;
    const fresh = room.id === HOUSE_CASH_ROOM_ID ? null : await this.prisma.room.findUnique({ where: { id: room.id } });
    if (!fresh?.isActive) {
      this.live.delete(room.id);
      this.changed(room.id);
      return;
    }
    const { serverSeed, seedHash } = newServerSeed();
    const round = await this.prisma.round.create({
      data: {
        roomId: fresh.id,
        stakeMinor: fresh.stakeMinor,
        houseCutBps: fresh.houseCutBps,
        guaranteedMinor: fresh.guaranteedPrizeMinor,
        // A random number of automated players from the room's range, picked fresh for every round.
        housePlanned:
          fresh.automatedEnabled && fresh.stakeMinor > 0n && !isManagedRoom(fresh.id)
            ? randomInt(Math.min(fresh.automatedMinPlayers, fresh.automatedPlayers), fresh.automatedPlayers + 1)
            : 0,
        serverSeed,
        seedHash,
        selectEndsAt: new Date(Date.now() + fresh.selectSeconds * 1000),
      },
    });
    // Announced automated players buy their cards as soon as the countdown starts.
    const opened =
      round.housePlanned > 0
        ? await this.ledger.withTx(async (tx) => this.joinAutomated(tx, await this.lockRound(tx, round.id))).catch((e: Error) => {
            this.logger.error(`Room ${fresh.id}: automated players could not join round #${round.number}: ${e.message}`);
            return round;
          })
        : round;
    const l: LiveRoom = { room: fresh, round: opened, order: ballOrder(serverSeed, round.number), cards: new Map(), called: new Set(), busy: false };
    const previous = this.live.get(fresh.id);
    if (previous) clearTimeout(previous.timer);
    this.live.set(fresh.id, l);
    this.changed(fresh.id);
    this.schedule(l, fresh.selectSeconds * 1000, () => this.closeSelection(l));
  }

  private async closeSelection(l: LiveRoom) {
    const roundId = l.round.id;
    const practice = l.room.id === PRACTICE_ROOM_ID;
    const houseCash = l.room.id === HOUSE_CASH_ROOM_ID;
    const outcome = await this.ledger.withTx(async (tx) => {
      const round = await this.lockRound(tx, roundId);
      if (round.status !== RoundStatus.SELECTING) return 'skip' as const;
      const cards = await tx.card.findMany({ where: { roundId } });
      const players = new Set(cards.map((c) => c.userId)).size;
      if (practice && !players) {
        const selectEndsAt = new Date(Date.now() + l.room.selectSeconds * 1000);
        return tx.round.update({ where: { id: roundId }, data: { selectEndsAt } });
      }
      // Automated players count as players: a round can run with automated players only.
      const automated = automatedPlayersIn(round);
      const short = houseCash ? !players || !round.houseStakeMinor
        : !practice && (cards.length + round.houseCards.length < l.room.minCards || players + automated < MIN_PLAYERS);
      if (short) {
        await this.refundAll(tx, round, cards);
        await tx.round.update({ where: { id: roundId }, data: { status: RoundStatus.CANCELLED, finishedAt: new Date() } });
        if (cards.length || round.houseStakeMinor > 0n) return 'refunded' as const;
        return round.housePlanned > 0 ? ('announcedEmpty' as const) : ('empty' as const);
      }
      const started = await tx.round.update({ where: { id: roundId }, data: { status: RoundStatus.DRAWING, startedAt: new Date() } });
      return { started, cards };
    });

    if (typeof outcome !== 'string' && 'started' in outcome) {
      l.round = outcome.started;
      l.cards = new Map(outcome.cards.map((c) => [c.cardNo, c.userId]));
      this.changed(l.room.id);
      this.schedule(l, 1200, () => this.drawNext(l));
      return;
    }
    if (typeof outcome !== 'string') {
      l.round = outcome;
      this.changed(l.room.id);
      this.schedule(l, l.round.selectEndsAt.getTime() - Date.now(), () => this.closeSelection(l));
      return;
    }
    if (outcome === 'empty' || outcome === 'announcedEmpty') {
      // Keep cancelled automated rounds for staff, even if no stakes were placed.
      if (outcome === 'empty') await this.prisma.round.delete({ where: { id: roundId } }).catch(() => undefined);
      return this.openRound(l.room);
    }
    if (outcome === 'refunded') {
      const owners = new Set(l.cards.values());
      l.round = { ...l.round, status: RoundStatus.CANCELLED };
      l.cancelled = { reason: 'NOT_ENOUGH_PLAYERS', nextRoundAt: new Date(Date.now() + CANCELLED_PAUSE_MS) };
      this.changed(l.room.id);
      owners.forEach((u) => this.notify.emit('walletChanged', u));
      this.schedule(l, CANCELLED_PAUSE_MS, () => this.openRound(l.room));
    }
  }

  private async drawNext(l: LiveRoom) {
    if (l.pendingWinners?.length) return this.finish(l, l.pendingWinners);
    const ball = l.order[l.round.calls.length];
    if (ball === undefined) return; // cannot happen: with 75 balls every card has a full line
    await this.prisma.$executeRaw`UPDATE rounds SET calls = array_append(calls, ${ball}) WHERE id = ${l.round.id}::uuid AND status = 'DRAWING'`;
    l.round = { ...l.round, calls: [...l.round.calls, ball] };
    l.called.add(ball);

    const winners = this.findWinners(l);
    if (!winners.length) {
      this.changed(l.room.id);
      this.schedule(l, l.room.callIntervalMs, () => this.drawNext(l));
      return;
    }
    l.pendingWinners = winners;
    await this.finish(l, winners);
  }

  private findWinners(l: LiveRoom): DrawWinner[] {
    const winners: DrawWinner[] = [];
    for (const [cardNo, userId] of l.cards) {
      const [lineIndex] = completeLines(this.cardSet[cardNo - 1], l.called);
      if (lineIndex !== undefined) winners.push({ cardNo, userId, lineIndex });
    }
    const samples = l.room.id === PRACTICE_ROOM_ID ? SAMPLE_CARDS : l.round.houseCards;
    samples.forEach((cardNo, i) => {
      const [lineIndex] = completeLines(this.cardSet[cardNo - 1], l.called);
      // Several cards can belong to the same automated player: name them by player, not by card.
      const owner = l.room.id === PRACTICE_ROOM_ID ? i + 1 : (l.round.houseOwners[i] ?? i + 1);
      if (lineIndex !== undefined) winners.push({ cardNo, sampleNo: owner, lineIndex });
    });
    return winners;
  }

  private async finish(l: LiveRoom, winners: DrawWinner[]) {
    const roundId = l.round.id;
    const practice = l.room.id === PRACTICE_ROOM_ID;
    const houseCash = l.room.id === HOUSE_CASH_ROOM_ID;
    const done = await this.ledger.withTx(async (tx) => {
      const round = await this.lockRound(tx, roundId);
      if (round.status !== RoundStatus.DRAWING) return null;
      // A round with only automated players is the house playing against itself: no house cut and no
      // guaranteed-prize top-up, so the whole pool goes back to the bankroll and revenue is not inflated.
      const automatedOnly = !practice && round.houseCards.length > 0 && !winners.some((w) => 'userId' in w) && l.cards.size === 0;
      const s = settle({
        stakeTotalMinor: practice ? 0n : round.stakeTotalMinor,
        houseCutBps: automatedOnly ? 0 : round.houseCutBps,
        guaranteedMinor: practice || automatedOnly ? 0n : round.guaranteedMinor,
        winners: winners.length,
      });
      const humanWinners = winners.filter((w) => 'userId' in w);
      // Automated players' prizes go back to the house bankroll (paid rooms; practice has no money).
      const houseWinningCards = practice ? [] : winners.filter((w) => 'sampleNo' in w).map((w) => w.cardNo);
      const housePrizeMinor = BigInt(houseWinningCards.length) * s.prizePerWinnerMinor;
      const perUser = new Map<string, bigint>();
      for (const w of humanWinners) perUser.set(w.userId, (perUser.get(w.userId) ?? 0n) + s.prizePerWinnerMinor);
      if (!practice) {
        const lines: PostingLine[] = [];
        const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
        lines.push({ accountId: pot.id, amountMinor: -round.stakeTotalMinor });
        if (s.topUpMinor > 0n) lines.push({ accountId: (await this.ledger.systemAccount(AccountType.PROMOTIONS, tx)).id, amountMinor: -s.topUpMinor });
        if (s.houseCutMinor > 0n) lines.push({ accountId: (await this.ledger.systemAccount(AccountType.HOUSE_REVENUE, tx)).id, amountMinor: s.houseCutMinor });
        if (housePrizeMinor > 0n) lines.push({ accountId: (await this.ledger.systemAccount(AccountType.HOUSE_BANKROLL, tx)).id, amountMinor: housePrizeMinor });
        for (const [userId, amount] of perUser) lines.push({ accountId: (await this.ledger.userAccounts(userId, tx)).main.id, amountMinor: amount });
        await this.ledger.post(
          {
            type: TxType.ROUND_SETTLEMENT,
            description: `Round #${round.number}: bingo prize`,
            idempotencyKey: `settle:${round.id}`,
            metadata: { roundId: round.id, winners: winners.map((w) => w.cardNo) },
            lines,
          },
          tx,
        );
      }
      if (humanWinners.length) {
        await tx.winner.createMany({
          data: humanWinners.map((w) => ({ roundId, cardNo: w.cardNo, userId: w.userId, lineIndex: w.lineIndex, prizeMinor: s.prizePerWinnerMinor })),
        });
      }
      const finished = await tx.round.update({
        where: { id: roundId },
        data: {
          status: RoundStatus.FINISHED,
          finishedAt: new Date(),
          prizeMinor: s.prizeMinor,
          houseCutMinor: s.houseCutMinor,
          topUpMinor: s.topUpMinor,
          prizePerWinnerMinor: s.prizePerWinnerMinor,
          housePrizeMinor,
          houseWinningCards,
        },
      });
      const users = await tx.user.findMany({ where: { id: { in: [...perUser.keys()] } }, select: { id: true, firstName: true } });
      return { finished, s, names: new Map(users.map((u) => [u.id, u.firstName])), perUser };
    });
    if (!done) return;
    l.round = done.finished;
    const nextRoundAt = new Date(Date.now() + this.config.resultSeconds * 1000);
    l.result = {
      prizePerWinnerMinor: done.s.prizePerWinnerMinor,
      nextRoundAt,
      winners: winners.map((w) => ({
        cardNo: w.cardNo,
        ...('sampleNo' in w
          ? practice
            ? { name: `Sample player ${w.sampleNo}`, sampleNo: w.sampleNo }
            : { name: automatedName(l.round.id, w.sampleNo), sampleNo: w.sampleNo, automated: true }
          : { name: (done.names.get(w.userId) ?? 'Player').slice(0, 20) }),
        lineIndex: w.lineIndex,
        layout: this.cardSet[w.cardNo - 1],
      })),
    };
    this.changed(l.room.id);
    if (!practice) for (const u of done.perUser.keys()) this.notify.emit('walletChanged', u);
    this.schedule(l, this.config.resultSeconds * 1000, () => this.openRound(l.room));
  }

  private async refundAll(tx: Tx, round: Round, cards: { userId: string; paidPlayMinor: bigint; paidMainMinor: bigint }[]) {
    if (!cards.length && !round.houseStakeMinor) return;
    const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
    const byAccount = new Map<string, bigint>();
    let total = 0n;
    for (const c of cards) {
      const { main, play } = await this.ledger.userAccounts(c.userId, tx);
      byAccount.set(play.id, (byAccount.get(play.id) ?? 0n) + c.paidPlayMinor);
      byAccount.set(main.id, (byAccount.get(main.id) ?? 0n) + c.paidMainMinor);
      total += c.paidPlayMinor + c.paidMainMinor;
    }
    if (round.houseStakeMinor > 0n) {
      const house = await this.ledger.systemAccount(AccountType.HOUSE_BANKROLL, tx);
      byAccount.set(house.id, round.houseStakeMinor);
      total += round.houseStakeMinor;
    }
    await this.ledger.post(
      {
        type: TxType.CARD_REFUND,
        description: `Round #${round.number} cancelled: not enough players`,
        idempotencyKey: `cancel:${round.id}`,
        metadata: { roundId: round.id },
        lines: [{ accountId: pot.id, amountMinor: -total }, ...[...byAccount].map(([accountId, amountMinor]) => ({ accountId, amountMinor }))],
      },
      tx,
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private schedule(l: LiveRoom, delayMs: number, fn: () => Promise<void>) {
    clearTimeout(l.timer);
    if (this.stopped) return;
    l.timer = setTimeout(() => {
      if (this.stopped) return;
      if (l.busy) return this.schedule(l, 200, fn);
      l.busy = true;
      fn()
        .catch((e: Error) => {
          this.logger.error(`Room ${l.room.id}: ${e.stack ?? e.message}`);
          // Try the same step again shortly; every step is safe to repeat.
          this.schedule(l, 2000, fn);
        })
        .finally(() => (l.busy = false));
    }, Math.max(0, delayMs));
  }

  private readonly pending = new Map<string, NodeJS.Timeout>();
  /** Coalesces bursts of changes (many purchases at once) into one broadcast per 250 ms. */
  private changed(roomId: string) {
    if (this.pending.has(roomId)) return;
    this.pending.set(
      roomId,
      setTimeout(() => {
        this.pending.delete(roomId);
        this.emit('state', roomId);
      }, 250),
    );
  }

  private requireRoom(roomId: string): LiveRoom {
    const l = this.live.get(roomId);
    if (!l) throw new AppError(HttpStatus.NOT_FOUND, 'ROOM_NOT_FOUND', 'This game room is closed.');
    return l;
  }

  /** Locks the round row and reads it in one statement. */
  private async lockRound(tx: Tx, roundId: string): Promise<Round> {
    const rows = await tx.$queryRaw<Record<string, any>[]>`SELECT * FROM rounds WHERE id = ${roundId}::uuid FOR UPDATE`;
    const r = rows[0];
    if (!r) throw new Error(`Round ${roundId} not found`);
    return {
      id: r.id,
      number: r.number,
      roomId: r.room_id,
      status: r.status,
      stakeMinor: r.stake_minor,
      houseCutBps: r.house_cut_bps,
      guaranteedMinor: r.guaranteed_minor,
      serverSeed: r.server_seed,
      seedHash: r.seed_hash,
      selectEndsAt: r.select_ends_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      calls: r.calls,
      cardsSold: r.cards_sold,
      stakeTotalMinor: r.stake_total_minor,
      prizeMinor: r.prize_minor,
      houseCutMinor: r.house_cut_minor,
      topUpMinor: r.top_up_minor,
      prizePerWinnerMinor: r.prize_per_winner_minor,
      houseStakeMinor: r.house_stake_minor,
      housePrizeMinor: r.house_prize_minor,
      houseCards: r.house_cards,
      houseWinningCards: r.house_winning_cards,
      housePlanned: r.house_planned,
      houseSkipped: r.house_skipped,
      houseOwners: r.house_owners,
      createdAt: r.created_at,
    };
  }

  private assertSelling(round: Round) {
    if (round.status !== RoundStatus.SELECTING || Date.now() > round.selectEndsAt.getTime() - CLOSE_GRACE_MS) {
      throw new AppError(HttpStatus.CONFLICT, 'ROUND_STARTED', 'This round has already started. Pick cards for the next one.');
    }
  }

  private takenError(cards: number[]) {
    return new AppError(
      HttpStatus.CONFLICT,
      'CARD_TAKEN',
      cards.length === 1 ? `Card #${cards[0]} was just taken. Pick another one.` : `Cards ${cards.map((c) => '#' + c).join(', ')} were just taken.`,
      { cards },
    );
  }
}
