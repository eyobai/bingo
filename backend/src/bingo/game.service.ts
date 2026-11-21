import { HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AccountType, RoundStatus, TxType } from '@prisma/client';
import type { Room, Round } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { AppError, isUniqueViolation, money } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { LedgerService, type PostingLine } from '../ledger/ledger.service';
import { NotifyService } from '../notify.service';
import { PrismaService, Tx } from '../prisma.service';
import { type CardLayout, completeLines, generateCardSet } from './cards';
import { ballOrder, newServerSeed } from './fair';
import { settle } from './prize';
import { isTestPlayer } from '../test-players';

/** Selling stops this long before the countdown hits zero, so a purchase never races the round start. */
const CLOSE_GRACE_MS = 300;
const CANCELLED_PAUSE_MS = 4000;
const MIN_PLAYERS = 2;
/** Card numbers run 1..1000 at most; rooms choose how many of them to offer. */
export const MAX_CARD_POOL = 1000;

interface LiveWinner {
  cardNo: number;
  name: string;
  /** A test player run by the platform; its prize goes to the next round. */
  test: boolean;
  lineIndex: number;
  layout: CardLayout;
}

interface LiveRoom {
  room: Room;
  round: Round;
  order: number[];
  /** cardNo -> owner userId, for cards sold this round. */
  cards: Map<number, string>;
  /** Owners who are test players (TEST_MODE). Shown to everyone; their winnings are carried over. */
  testUsers: Set<string>;
  called: Set<number>;
  timer?: NodeJS.Timeout;
  result?: { winners: LiveWinner[]; prizePerWinnerMinor: bigint; nextRoundAt: Date; carriedOverMinor: bigint };
  cancelled?: { reason: string; nextRoundAt: Date };
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
    if (this.config.seedRooms && (await this.prisma.room.count()) === 0) {
      await this.prisma.room.create({
        data: { id: 'r10', name: '10 Birr Game', stakeMinor: 1000n, cardPool: 400, guaranteedPrizeMinor: 0n },
      });
    }
    const rooms = await this.prisma.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
    this.cardSet = generateCardSet(MAX_CARD_POOL, this.config.cardSetSeed);
    for (const room of rooms) await this.resume(room);
  }

  /** Starts a room that staff just switched on. A running room picks up new settings at its next round. */
  async ensureRoom(roomId: string) {
    if (this.live.has(roomId)) return;
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (room?.isActive) await this.resume(room);
  }

  onModuleDestroy() {
    this.stopped = true;
    for (const l of this.live.values()) clearTimeout(l.timer);
  }

  // ─── Public reads ─────────────────────────────────────────────────────────

  card(cardNo: number): CardLayout | undefined {
    return this.cardSet[cardNo - 1];
  }

  cards(pool: number): CardLayout[] {
    return this.cardSet.slice(0, pool);
  }

  roomIds(): string[] {
    return [...this.live.keys()];
  }

  /** Everything a viewer of the room may see. Never includes the server seed of a running round. */
  publicState(roomId: string) {
    const l = this.live.get(roomId);
    if (!l) return null;
    const { room, round } = l;
    const carry = this.carryMinor;
    const preview =
      round.stakeTotalMinor > 0n || round.guaranteedMinor > 0n || carry > 0n
        ? settle({ stakeTotalMinor: round.stakeTotalMinor, houseCutBps: round.houseCutBps, guaranteedMinor: round.guaranteedMinor, winners: 1, carryMinor: carry }).prizeMinor
        : 0n;
    const testCards = [...l.cards.entries()].filter(([, u]) => l.testUsers.has(u)).map(([c]) => c);
    const finished = round.status === RoundStatus.FINISHED;
    return {
      serverTime: new Date().toISOString(),
      testMode: this.config.testMode,
      room: {
        id: room.id,
        name: room.name,
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
        taken: [...l.cards.keys()].sort((a, b) => a - b),
        /** Test players and the cards they hold, so everyone can see them. */
        testPlayers: [...l.testUsers].filter((u) => [...l.cards.values()].includes(u)).length,
        testTaken: testCards.sort((a, b) => a - b),
        /** Carried over from earlier rounds into this prize. */
        carriedIn: money(finished ? round.carryInMinor : carry),
      },
      result: l.result
        ? {
            prizePerWinner: money(l.result.prizePerWinnerMinor),
            carriedOver: money(l.result.carriedOverMinor),
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

  async buyCards(userId: string, roomId: string, cardNos: number[]) {
    const l = this.requireRoom(roomId);
    const unique = [...new Set(cardNos)];
    if (!unique.length || unique.some((n) => !Number.isInteger(n) || n < 1 || n > l.room.cardPool)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_CARD', `Pick card numbers between 1 and ${l.room.cardPool}.`);
    }
    const roundId = l.round.id;
    const stake = l.room.stakeMinor;
    let buyerIsTest = false;
    try {
      await this.ledger.withTx(async (tx) => {
        const round = await this.lockRound(tx, roundId);
        this.assertSelling(round);
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        buyerIsTest = isTestPlayer(user.telegramId);
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
        const taken = relevant.filter((c) => unique.includes(c.cardNo));
        if (taken.length) throw this.takenError(taken.map((t) => t.cardNo));
        if (owned + unique.length > l.room.maxCardsPerPlayer) {
          throw new AppError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'TOO_MANY_CARDS',
            `You can hold up to ${l.room.maxCardsPerPlayer} cards per round.`,
          );
        }

        const { main, play } = await this.ledger.userAccounts(userId, tx);
        // Bonus (play) money is spent first, card by card.
        let playLeft = play.balanceMinor;
        const rows = unique.map((cardNo) => {
          const fromPlay = playLeft >= stake ? stake : playLeft > 0n ? playLeft : 0n;
          playLeft -= fromPlay;
          return { roundId, cardNo, userId, paidPlayMinor: fromPlay, paidMainMinor: stake - fromPlay };
        });
        await tx.card.createMany({ data: rows });
        const total = stake * BigInt(rows.length);
        const fromPlay = rows.reduce((s, r) => s + r.paidPlayMinor, 0n);
        const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
        await this.ledger.post(
          {
            type: TxType.CARD_PURCHASE,
            description: `Round #${round.number}: card${rows.length > 1 ? 's' : ''} ${unique.map((n) => '#' + n).join(', ')}`,
            metadata: { roundId, cards: unique },
            lines: [
              { accountId: play.id, amountMinor: -fromPlay },
              { accountId: main.id, amountMinor: -(total - fromPlay) },
              { accountId: pot.id, amountMinor: total },
            ],
          },
          tx,
        );
        const updated = await tx.round.update({
          where: { id: roundId },
          data: { cardsSold: { increment: rows.length }, stakeTotalMinor: { increment: total } },
        });
        l.round = { ...l.round, cardsSold: updated.cardsSold, stakeTotalMinor: updated.stakeTotalMinor };
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const taken = await this.prisma.card.findMany({ where: { roundId, cardNo: { in: unique } }, select: { cardNo: true } });
        throw this.takenError(taken.map((t) => t.cardNo));
      }
      throw e;
    }
    if (l.round.id === roundId) {
      for (const n of unique) l.cards.set(n, userId);
      if (buyerIsTest) l.testUsers.add(userId);
    }
    this.changed(roomId);
    this.notify.emit('walletChanged', userId);
    return this.myCards(roomId, userId);
  }

  /** Gives a card back before the countdown ends; the money returns to where it came from. */
  async returnCard(userId: string, roomId: string, cardNo: number) {
    const l = this.requireRoom(roomId);
    const roundId = l.round.id;
    await this.ledger.withTx(async (tx) => {
      const round = await this.lockRound(tx, roundId);
      this.assertSelling(round);
      const card = await tx.card.findUnique({ where: { roundId_cardNo: { roundId, cardNo } } });
      if (!card || card.userId !== userId) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_YOUR_CARD', 'That card is not yours.');
      await tx.card.delete({ where: { id: card.id } });
      const { main, play } = await this.ledger.userAccounts(userId, tx);
      const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
      const total = card.paidPlayMinor + card.paidMainMinor;
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
      const updated = await tx.round.update({
        where: { id: roundId },
        data: { cardsSold: { decrement: 1 }, stakeTotalMinor: { decrement: total } },
      });
      l.round = { ...l.round, cardsSold: updated.cardsSold, stakeTotalMinor: updated.stakeTotalMinor };
    });
    if (l.round.id === roundId) l.cards.delete(cardNo);
    this.changed(roomId);
    this.notify.emit('walletChanged', userId);
    return this.myCards(roomId, userId);
  }

  // ─── Round lifecycle ──────────────────────────────────────────────────────

  private async resume(room: Room) {
    const open = await this.prisma.round.findFirst({
      where: { roomId: room.id, status: { in: [RoundStatus.SELECTING, RoundStatus.DRAWING] } },
      orderBy: { createdAt: 'desc' },
      include: { cards: { select: { cardNo: true, userId: true, user: { select: { telegramId: true } } } } },
    });
    await this.refreshCarry();
    if (!open) return this.openRound(room);
    const { cards, ...round } = open;
    const l: LiveRoom = {
      room,
      round,
      order: ballOrder(round.serverSeed, round.number),
      cards: new Map(cards.map((c) => [c.cardNo, c.userId])),
      testUsers: new Set(cards.filter((c) => isTestPlayer(c.user.telegramId)).map((c) => c.userId)),
      called: new Set(round.calls),
      busy: false,
    };
    this.live.set(room.id, l);
    this.logger.log(`Resumed ${room.id} round #${round.number} (${round.status})`);
    if (round.status === RoundStatus.SELECTING) this.schedule(l, round.selectEndsAt.getTime() - Date.now(), () => this.closeSelection(l));
    else this.schedule(l, room.callIntervalMs, () => this.drawNext(l));
  }

  private async openRound(room: Room) {
    if (this.stopped) return;
    const fresh = await this.prisma.room.findUnique({ where: { id: room.id } });
    if (!fresh?.isActive) {
      this.live.delete(room.id);
      return;
    }
    const { serverSeed, seedHash } = newServerSeed();
    const round = await this.prisma.round.create({
      data: {
        roomId: fresh.id,
        stakeMinor: fresh.stakeMinor,
        houseCutBps: fresh.houseCutBps,
        guaranteedMinor: fresh.guaranteedPrizeMinor,
        serverSeed,
        seedHash,
        selectEndsAt: new Date(Date.now() + fresh.selectSeconds * 1000),
      },
    });
    const l: LiveRoom = { room: fresh, round, order: ballOrder(serverSeed, round.number), cards: new Map(), testUsers: new Set(), called: new Set(), busy: false };
    const previous = this.live.get(fresh.id);
    if (previous) clearTimeout(previous.timer);
    this.live.set(fresh.id, l);
    this.changed(fresh.id);
    this.schedule(l, fresh.selectSeconds * 1000, () => this.closeSelection(l));
  }

  private async closeSelection(l: LiveRoom) {
    const roundId = l.round.id;
    const outcome = await this.ledger.withTx(async (tx) => {
      const round = await this.lockRound(tx, roundId);
      if (round.status !== RoundStatus.SELECTING) return 'skip' as const;
      const cards = await tx.card.findMany({ where: { roundId }, include: { user: { select: { telegramId: true } } } });
      const players = new Set(cards.map((c) => c.userId)).size;
      if (cards.length < l.room.minCards || players < MIN_PLAYERS) {
        await this.refundAll(tx, round, cards);
        await tx.round.update({ where: { id: roundId }, data: { status: RoundStatus.CANCELLED, finishedAt: new Date() } });
        return cards.length ? ('refunded' as const) : ('empty' as const);
      }
      const started = await tx.round.update({ where: { id: roundId }, data: { status: RoundStatus.DRAWING, startedAt: new Date() } });
      l.round = started;
      l.cards = new Map(cards.map((c) => [c.cardNo, c.userId]));
      l.testUsers = new Set(cards.filter((c) => isTestPlayer(c.user.telegramId)).map((c) => c.userId));
      return 'started' as const;
    });

    if (outcome === 'started') {
      this.changed(l.room.id);
      this.schedule(l, 1200, () => this.drawNext(l));
      return;
    }
    if (outcome === 'empty') {
      // Nobody played: quietly start a fresh countdown.
      await this.prisma.round.delete({ where: { id: roundId } }).catch(() => undefined);
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
    const ball = l.order[l.round.calls.length];
    if (ball === undefined) return; // cannot happen: with 75 balls every card has a full line
    await this.prisma.$executeRaw`UPDATE rounds SET calls = array_append(calls, ${ball}) WHERE id = ${l.round.id}::uuid AND status = 'DRAWING'`;
    l.round = { ...l.round, calls: [...l.round.calls, ball] };
    l.called.add(ball);

    const winners: { cardNo: number; userId: string; lineIndex: number }[] = [];
    for (const [cardNo, userId] of l.cards) {
      const lines = completeLines(this.cardSet[cardNo - 1], l.called);
      if (lines.length) winners.push({ cardNo, userId, lineIndex: lines[0] });
    }
    if (!winners.length) {
      this.changed(l.room.id);
      this.schedule(l, l.room.callIntervalMs, () => this.drawNext(l));
      return;
    }
    await this.finish(l, winners);
  }

  private async finish(l: LiveRoom, winners: { cardNo: number; userId: string; lineIndex: number }[]) {
    const roundId = l.round.id;
    const done = await this.ledger.withTx(async (tx) => {
      const round = await this.lockRound(tx, roundId);
      if (round.status !== RoundStatus.DRAWING) return null;
      // Carry-over from earlier rounds: the whole balance, read under lock so two rooms cannot both use it.
      const rollover = await this.ledger.systemAccount(AccountType.ROLLOVER, tx);
      const locked = await tx.$queryRaw<{ balance_minor: bigint }[]>`SELECT balance_minor FROM ledger_accounts WHERE id = ${rollover.id}::uuid FOR UPDATE`;
      const carry = locked[0]?.balance_minor ?? 0n;
      const testWinners = winners.filter((w) => l.testUsers.has(w.userId));
      const s = settle({
        stakeTotalMinor: round.stakeTotalMinor,
        houseCutBps: round.houseCutBps,
        guaranteedMinor: round.guaranteedMinor,
        winners: winners.length,
        carryMinor: carry,
        sampleWinners: testWinners.length,
      });
      const lines: PostingLine[] = [];
      const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
      lines.push({ accountId: pot.id, amountMinor: -round.stakeTotalMinor });
      const rolloverChange = s.toRolloverMinor - s.carryInMinor;
      if (rolloverChange !== 0n) lines.push({ accountId: rollover.id, amountMinor: rolloverChange });
      if (s.topUpMinor > 0n) lines.push({ accountId: (await this.ledger.systemAccount(AccountType.PROMOTIONS, tx)).id, amountMinor: -s.topUpMinor });
      if (s.houseCutMinor > 0n) lines.push({ accountId: (await this.ledger.systemAccount(AccountType.HOUSE_REVENUE, tx)).id, amountMinor: s.houseCutMinor });
      const perUser = new Map<string, bigint>();
      for (const w of winners) {
        if (l.testUsers.has(w.userId)) continue; // test players' share goes to the rollover line above
        perUser.set(w.userId, (perUser.get(w.userId) ?? 0n) + s.prizePerWinnerMinor);
      }
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
      await tx.winner.createMany({
        data: winners.map((w) => ({ roundId, cardNo: w.cardNo, userId: w.userId, lineIndex: w.lineIndex, prizeMinor: s.prizePerWinnerMinor })),
      });
      const finished = await tx.round.update({
        where: { id: roundId },
        data: {
          status: RoundStatus.FINISHED,
          finishedAt: new Date(),
          prizeMinor: s.prizeMinor,
          houseCutMinor: s.houseCutMinor,
          topUpMinor: s.topUpMinor,
          prizePerWinnerMinor: s.prizePerWinnerMinor,
          carryInMinor: s.carryInMinor,
          carryOutMinor: s.toRolloverMinor,
        },
      });
      const users = await tx.user.findMany({ where: { id: { in: winners.map((w) => w.userId) } }, select: { id: true, firstName: true } });
      return { finished, s, names: new Map(users.map((u) => [u.id, u.firstName])), perUser };
    });
    if (!done) return;
    l.round = done.finished;
    await this.refreshCarry();
    const nextRoundAt = new Date(Date.now() + this.config.resultSeconds * 1000);
    l.result = {
      prizePerWinnerMinor: done.s.prizePerWinnerMinor,
      nextRoundAt,
      carriedOverMinor: done.s.toRolloverMinor,
      winners: winners.map((w) => ({
        cardNo: w.cardNo,
        test: l.testUsers.has(w.userId),
        name: (done.names.get(w.userId) ?? 'Player').slice(0, 20),
        lineIndex: w.lineIndex,
        layout: this.cardSet[w.cardNo - 1],
      })),
    };
    this.changed(l.room.id);
    for (const u of done.perUser.keys()) this.notify.emit('walletChanged', u);
    this.schedule(l, this.config.resultSeconds * 1000, () => this.openRound(l.room));
  }

  private async refundAll(tx: Tx, round: Round, cards: { userId: string; paidPlayMinor: bigint; paidMainMinor: bigint }[]) {
    if (!cards.length) return;
    const pot = await this.ledger.systemAccount(AccountType.GAME_POT, tx);
    const byAccount = new Map<string, bigint>();
    let total = 0n;
    for (const c of cards) {
      const { main, play } = await this.ledger.userAccounts(c.userId, tx);
      byAccount.set(play.id, (byAccount.get(play.id) ?? 0n) + c.paidPlayMinor);
      byAccount.set(main.id, (byAccount.get(main.id) ?? 0n) + c.paidMainMinor);
      total += c.paidPlayMinor + c.paidMainMinor;
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

  /** Rollover balance, cached for display; settlement always reads it from the database under lock. */
  private carryMinor = 0n;
  private async refreshCarry() {
    const acc = await this.prisma.ledgerAccount.findUnique({ where: { code: `SYSTEM:${AccountType.ROLLOVER}` } });
    this.carryMinor = acc?.balanceMinor ?? 0n;
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
      carryInMinor: r.carry_in_minor,
      carryOutMinor: r.carry_out_minor,
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
