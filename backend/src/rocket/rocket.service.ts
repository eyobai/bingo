import { HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AccountType, RocketBetStatus, RocketStatus, TxType, type RocketBet, type RocketRound, type RocketSettings } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { AppError, isUniqueViolation, money } from '../common/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { LedgerService } from '../ledger/ledger.service';
import { NotifyService } from '../notify.service';
import { PrismaService, type Tx } from '../prisma.service';
import { crashX100, effectiveAutoX100, msUntil, newRocketSeed, payoutFor, x100At } from './crash';

/** Bets close this long before the betting countdown ends, so a bet never races the take-off. */
const CLOSE_GRACE_MS = 300;
/** How long the crash result stays on screen before the next betting window. */
const AFTER_CRASH_MS = 3500;
/** Check for automatic cash-outs and the crash this often during the flight. */
const TICK_MS = 100;

interface LiveBet {
  id: string;
  userId: string;
  name: string;
  slot: number;
  stakeMinor: bigint;
  autoX100: number | null;
  /** Where this bet is cashed out automatically (its own target or the max-win cap). */
  autoAt: number;
  status: RocketBetStatus;
  cashedX100: number | null;
  payoutMinor: bigint;
}

interface Live {
  round: RocketRound;
  settings: RocketSettings;
  bets: Map<string, LiveBet>;
  /** Server time when the flight crashes (set at take-off). */
  crashAt?: number;
}

export interface RocketEvents {
  state: [];
}

/**
 * Leyu Rocket: a crash game against the house.
 *
 * BETTING (a few seconds) → FLYING (the multiplier climbs e^(k·t) until the pre-committed crash point) → CRASHED.
 * Players bet in up to two slots and cash out any time before the crash (or automatically at a target).
 * Every bet goes to the ROCKET_HOUSE account and every win is paid from it, in the same transaction as the
 * bet or cash-out; the house account shows the game's result. The database is the source of truth: bets and
 * cash-outs lock the bet or round row, and the crash point is fixed and hashed before betting opens.
 * Timers live in this process, so run ONE instance of the server.
 */
@Injectable()
export class RocketService extends EventEmitter<RocketEvents> implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Rocket');
  private live: Live | null = null;
  private timer?: NodeJS.Timeout;
  private ticker?: NodeJS.Timeout;
  private stopped = false;
  private busy = false;
  private history: { number: number; x100: number }[] = [];
  private pending?: NodeJS.Timeout;

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
    await this.prisma.rocketSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
    this.history = (await this.prisma.rocketRound.findMany({ where: { status: RocketStatus.CRASHED }, orderBy: { number: 'desc' }, take: 30 })).map(
      (r) => ({ number: r.number, x100: r.crashX100 }),
    );
    await this.resume();
  }

  onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.ticker);
    clearTimeout(this.pending);
  }

  // ─── Public reads ─────────────────────────────────────────────────────────

  settings() {
    return this.prisma.rocketSettings.findUniqueOrThrow({ where: { id: 1 } });
  }

  /** Everything any viewer may see. The crash point and seed are only included once the round has crashed. */
  publicState() {
    const l = this.live;
    const now = Date.now();
    if (!l) return { serverTime: new Date(now).toISOString(), enabled: false, round: null, bets: [], history: this.history.slice(0, 20) };
    const { round, settings } = l;
    const crashed = round.status === RocketStatus.CRASHED;
    const bets = [...l.bets.values()].sort((a, b) => Number(b.stakeMinor - a.stakeMinor));
    return {
      serverTime: new Date(now).toISOString(),
      enabled: settings.enabled,
      limits: {
        minBet: money(settings.minBetMinor),
        maxBet: money(settings.maxBetMinor),
        maxX: settings.maxX100 / 100,
        maxWin: money(settings.maxWinMinor),
        houseEdgePercent: round.houseEdgeBps / 100,
      },
      round: {
        id: round.id,
        number: round.number,
        status: round.status,
        seedHash: round.seedHash,
        bettingEndsAt: round.bettingEndsAt.toISOString(),
        startedAt: round.startedAt?.toISOString() ?? null,
        crashX: crashed ? round.crashX100 / 100 : null,
        serverSeed: crashed ? round.serverSeed : null,
        players: new Set(bets.map((b) => b.userId)).size,
        betsCount: bets.length,
        totalBet: money(bets.reduce((s, b) => s + b.stakeMinor, 0n)),
        totalWon: money(bets.reduce((s, b) => s + b.payoutMinor, 0n)),
      },
      // Real players' bets only; names are shortened for privacy.
      bets: bets.slice(0, 100).map((b) => ({
        name: mask(b.name),
        stake: money(b.stakeMinor),
        cashedX: b.cashedX100 ? b.cashedX100 / 100 : null,
        payout: money(b.payoutMinor),
        status: b.status,
      })),
      history: this.history.slice(0, 20),
    };
  }

  /** The player's own bets in the current round (by slot) and their recent bets. */
  async myBets(userId: string) {
    const current = this.live ? [...this.live.bets.values()].filter((b) => b.userId === userId) : [];
    const recent = await this.prisma.rocketBet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { round: { select: { number: true, status: true, crashX100: true } } },
    });
    return {
      roundId: this.live?.round.id ?? null,
      current: current.map((b) => ({
        slot: b.slot,
        stake: money(b.stakeMinor),
        autoX: b.autoX100 ? b.autoX100 / 100 : null,
        status: b.status,
        cashedX: b.cashedX100 ? b.cashedX100 / 100 : null,
        payout: money(b.payoutMinor),
      })),
      recent: recent.map((b) => ({
        round: b.round.number,
        stake: money(b.stakeMinor),
        cashedX: b.cashedX100 ? b.cashedX100 / 100 : null,
        crashX: b.round.status === RocketStatus.CRASHED ? b.round.crashX100 / 100 : null,
        payout: money(b.payoutMinor),
        status: b.status,
        at: b.createdAt,
      })),
    };
  }

  /** Fairness check for a finished round. */
  async verify(number: number) {
    const r = await this.prisma.rocketRound.findUnique({ where: { number } });
    if (!r || r.status !== RocketStatus.CRASHED) throw new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Round not found or not finished yet.');
    return { number: r.number, seedHash: r.seedHash, serverSeed: r.serverSeed, houseEdgeBps: r.houseEdgeBps, crashX: r.crashX100 / 100 };
  }

  // ─── Player actions ───────────────────────────────────────────────────────

  async bet(userId: string, slot: number, stakeMinor: bigint, autoX100: number | null) {
    const l = this.live;
    if (!l || !l.settings.enabled) throw new AppError(HttpStatus.CONFLICT, 'ROCKET_OFF', 'Leyu Rocket is closed right now.');
    const { settings } = l;
    if (slot !== 1 && slot !== 2) throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_SLOT', 'Choose bet 1 or 2.');
    if (stakeMinor < settings.minBetMinor || stakeMinor > settings.maxBetMinor) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_STAKE', `Bet between ${money(settings.minBetMinor).birr} and ${money(settings.maxBetMinor).birr} birr.`);
    }
    if (autoX100 !== null && (autoX100 < 101 || autoX100 > settings.maxX100)) {
      throw new AppError(HttpStatus.BAD_REQUEST, 'BAD_AUTO', `Auto cash out between 1.01× and ${settings.maxX100 / 100}×.`);
    }
    const roundId = l.round.id;
    let created: RocketBet;
    let name = 'Player';
    try {
      created = await this.ledger.withTx(async (tx) => {
        const round = await this.lockRound(tx, roundId);
        if (round.status !== RocketStatus.BETTING || Date.now() > round.bettingEndsAt.getTime() - CLOSE_GRACE_MS) {
          throw new AppError(HttpStatus.CONFLICT, 'BETTING_CLOSED', 'Betting for this round has closed. Bet on the next one.');
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.isBlocked) throw new AppError(HttpStatus.FORBIDDEN, 'BLOCKED', 'Your account is blocked. Contact support.');
        if (this.config.requirePhone && !user.phone) {
          throw new AppError(HttpStatus.FORBIDDEN, 'PHONE_REQUIRED', 'Register first: open the bot, press Start and share your phone number.');
        }
        name = user.firstName;
        const { main, play } = await this.ledger.userAccounts(userId, tx);
        const house = await this.ledger.systemAccount(AccountType.ROCKET_HOUSE, tx);
        const balances = await this.ledger.lockAccounts(tx, [main.id, play.id, house.id]);
        // Bonus (play) money is used first, as in bingo; winnings always go to the main wallet.
        const playBal = balances.get(play.id)!.balance_minor;
        const fromPlay = playBal >= stakeMinor ? stakeMinor : playBal > 0n ? playBal : 0n;
        const bet = await tx.rocketBet.create({
          data: { roundId, userId, slot, stakeMinor, paidPlayMinor: fromPlay, paidMainMinor: stakeMinor - fromPlay, autoX100 },
        });
        await this.ledger.post(
          {
            type: TxType.ROCKET_BET,
            description: `Leyu Rocket #${round.number}: bet ${slot}`,
            metadata: { roundId, betId: bet.id, slot },
            lines: [
              { accountId: play.id, amountMinor: -fromPlay },
              { accountId: main.id, amountMinor: -(stakeMinor - fromPlay) },
              { accountId: house.id, amountMinor: stakeMinor },
            ],
          },
          tx,
        );
        await tx.rocketRound.update({ where: { id: roundId }, data: { totalBetMinor: { increment: stakeMinor } } });
        return bet;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError(HttpStatus.CONFLICT, 'SLOT_USED', `You already have bet ${slot} in this round.`);
      throw e;
    }
    if (this.live?.round.id === roundId) {
      this.live.bets.set(created.id, {
        id: created.id,
        userId,
        name,
        slot,
        stakeMinor,
        autoX100,
        autoAt: effectiveAutoX100(stakeMinor, autoX100, settings.maxWinMinor),
        status: RocketBetStatus.PLACED,
        cashedX100: null,
        payoutMinor: 0n,
      });
    }
    this.changed();
    this.notify.emit('walletChanged', userId);
    return this.myBets(userId);
  }

  /** Takes a bet back before take-off; the money returns to where it came from. */
  async cancel(userId: string, slot: number) {
    const l = this.live;
    if (!l) throw new AppError(HttpStatus.CONFLICT, 'ROCKET_OFF', 'Leyu Rocket is closed right now.');
    const roundId = l.round.id;
    const removed = await this.ledger.withTx(async (tx) => {
      const round = await this.lockRound(tx, roundId);
      if (round.status !== RocketStatus.BETTING || Date.now() > round.bettingEndsAt.getTime() - CLOSE_GRACE_MS) {
        throw new AppError(HttpStatus.CONFLICT, 'BETTING_CLOSED', 'The rocket has taken off: cash out instead.');
      }
      const bet = await tx.rocketBet.findUnique({ where: { roundId_userId_slot: { roundId, userId, slot } } });
      if (!bet) throw new AppError(HttpStatus.NOT_FOUND, 'NO_BET', 'You have no bet in that slot.');
      await this.refund(tx, round, bet, 'cancelled');
      await tx.rocketBet.delete({ where: { id: bet.id } });
      return bet.id;
    });
    this.live?.bets.delete(removed);
    this.changed();
    this.notify.emit('walletChanged', userId);
    return this.myBets(userId);
  }

  /** Cashes out now, at the multiplier the rocket has reached on the server's clock. */
  async cashOut(userId: string, slot: number) {
    const l = this.live;
    if (!l || l.round.status !== RocketStatus.FLYING || !l.round.startedAt || !l.crashAt) {
      throw new AppError(HttpStatus.CONFLICT, 'NOT_FLYING', 'The rocket is not flying.');
    }
    const bet = [...l.bets.values()].find((b) => b.userId === userId && b.slot === slot);
    if (!bet || bet.status !== RocketBetStatus.PLACED) throw new AppError(HttpStatus.NOT_FOUND, 'NO_BET', 'You have no active bet in that slot.');
    const now = Date.now();
    if (now >= l.crashAt) throw new AppError(HttpStatus.CONFLICT, 'CRASHED', 'Too late: the rocket has crashed.');
    const x = Math.min(x100At(now - l.round.startedAt.getTime()), l.round.crashX100 - 1, bet.autoAt);
    await this.settleCashOut(l, bet, Math.max(100, x));
    return this.myBets(userId);
  }

  // ─── Round lifecycle ──────────────────────────────────────────────────────

  private async resume(): Promise<void> {
    const open = await this.prisma.rocketRound.findFirst({
      where: { status: { in: [RocketStatus.BETTING, RocketStatus.FLYING] } },
      orderBy: { number: 'desc' },
      include: { bets: { include: { user: { select: { firstName: true } } } } },
    });
    if (!open) return this.openRound();
    const settings = await this.settings();
    const { bets, ...round } = open;
    this.live = { round, settings, bets: new Map(bets.map((b) => [b.id, this.liveBet(b, b.user.firstName, settings)])) };
    this.logger.log(`Resumed round #${round.number} (${round.status})`);
    if (round.status === RocketStatus.BETTING) return this.after(round.bettingEndsAt.getTime() - Date.now(), () => this.takeOff());
    this.live.crashAt = round.startedAt!.getTime() + msUntil(round.crashX100);
    this.startTicking();
  }

  private async openRound(): Promise<void> {
    if (this.stopped) return;
    const settings = await this.settings();
    if (!settings.enabled) {
      // Closed: show nothing to bet on and look again shortly (staff may switch it on).
      this.live = null;
      this.changed();
      return this.after(5000, () => this.openRound());
    }
    const { serverSeed, seedHash } = newRocketSeed();
    const round = await this.prisma.rocketRound.create({
      data: {
        serverSeed,
        seedHash,
        crashX100: 100, // set just below, once the round number is known
        houseEdgeBps: settings.houseEdgeBps,
        bettingEndsAt: new Date(Date.now() + settings.bettingSeconds * 1000),
      },
    });
    const crash = crashX100(serverSeed, round.number, settings.houseEdgeBps, settings.maxX100);
    const fixed = await this.prisma.rocketRound.update({ where: { id: round.id }, data: { crashX100: crash } });
    this.live = { round: fixed, settings, bets: new Map() };
    this.changed();
    this.after(settings.bettingSeconds * 1000, () => this.takeOff());
  }

  private async takeOff() {
    const l = this.live;
    if (!l) return;
    const started = await this.prisma.rocketRound.update({
      where: { id: l.round.id },
      data: { status: RocketStatus.FLYING, startedAt: new Date() },
    });
    l.round = started;
    l.crashAt = started.startedAt!.getTime() + msUntil(started.crashX100);
    this.changed();
    this.startTicking();
  }

  private startTicking() {
    clearInterval(this.ticker);
    this.ticker = setInterval(() => void this.tick(), TICK_MS);
  }

  /** During the flight: automatic cash-outs that are due, then the crash when its time comes. */
  private async tick() {
    const l = this.live;
    if (this.busy || !l || l.round.status !== RocketStatus.FLYING || !l.crashAt || !l.round.startedAt) return;
    this.busy = true;
    try {
      const now = Date.now();
      const reached = now >= l.crashAt ? l.round.crashX100 : x100At(now - l.round.startedAt.getTime());
      for (const bet of l.bets.values()) {
        // A target counts when the rocket reaches it before crashing (target below the crash point).
        if (bet.status === RocketBetStatus.PLACED && bet.autoAt <= reached && bet.autoAt < l.round.crashX100) {
          await this.settleCashOut(l, bet, bet.autoAt).catch((e: Error) => this.logger.error(`auto cash-out ${bet.id}: ${e.message}`));
        }
      }
      if (now >= l.crashAt) await this.crash(l);
    } finally {
      this.busy = false;
    }
  }

  private async crash(l: Live) {
    clearInterval(this.ticker);
    const done = await this.ledger.withTx(async (tx) => {
      const round = await this.lockRound(tx, l.round.id);
      if (round.status !== RocketStatus.FLYING) return round;
      // Bets still in the air lose; their stake already sits in the house account.
      await tx.rocketBet.updateMany({ where: { roundId: round.id, status: RocketBetStatus.PLACED }, data: { status: RocketBetStatus.LOST } });
      return tx.rocketRound.update({ where: { id: round.id }, data: { status: RocketStatus.CRASHED, crashedAt: new Date() } });
    });
    for (const b of l.bets.values()) {
      if (b.status === RocketBetStatus.PLACED) b.status = RocketBetStatus.LOST;
    }
    l.round = done;
    this.history.unshift({ number: done.number, x100: done.crashX100 });
    this.history.length = Math.min(this.history.length, 30);
    this.changed(true);
    this.after(AFTER_CRASH_MS, () => this.openRound());
  }

  private async settleCashOut(l: Live, bet: LiveBet, x100: number) {
    const payout = payoutFor(bet.stakeMinor, x100, l.settings.maxWinMinor);
    const ok = await this.ledger.withTx(async (tx) => {
      const [row] = await tx.$queryRaw<{ status: RocketBetStatus }[]>`SELECT status FROM rocket_bets WHERE id = ${bet.id}::uuid FOR UPDATE`;
      if (!row || row.status !== RocketBetStatus.PLACED) return false;
      const round = await tx.rocketRound.findUniqueOrThrow({ where: { id: l.round.id } });
      if (round.status !== RocketStatus.FLYING) return false;
      const { main } = await this.ledger.userAccounts(bet.userId, tx);
      const house = await this.ledger.systemAccount(AccountType.ROCKET_HOUSE, tx);
      await this.ledger.post(
        {
          type: TxType.ROCKET_PAYOUT,
          description: `Leyu Rocket #${round.number}: cashed out at ${(x100 / 100).toFixed(2)}×`,
          idempotencyKey: `rocket-cashout:${bet.id}`,
          metadata: { roundId: round.id, betId: bet.id, x100 },
          lines: [
            { accountId: house.id, amountMinor: -payout },
            { accountId: main.id, amountMinor: payout },
          ],
        },
        tx,
      );
      await tx.rocketBet.update({ where: { id: bet.id }, data: { status: RocketBetStatus.CASHED, cashedX100: x100, payoutMinor: payout } });
      await tx.rocketRound.update({ where: { id: round.id }, data: { totalPaidMinor: { increment: payout } } });
      return true;
    });
    if (!ok) return;
    bet.status = RocketBetStatus.CASHED;
    bet.cashedX100 = x100;
    bet.payoutMinor = payout;
    this.changed();
    this.notify.emit('walletChanged', bet.userId);
  }

  private async refund(tx: Tx, round: RocketRound, bet: RocketBet, why: string) {
    const { main, play } = await this.ledger.userAccounts(bet.userId, tx);
    const house = await this.ledger.systemAccount(AccountType.ROCKET_HOUSE, tx);
    await this.ledger.post(
      {
        type: TxType.ROCKET_REFUND,
        description: `Leyu Rocket #${round.number}: bet ${bet.slot} ${why}`,
        metadata: { roundId: round.id, betId: bet.id },
        lines: [
          { accountId: house.id, amountMinor: -bet.stakeMinor },
          { accountId: play.id, amountMinor: bet.paidPlayMinor },
          { accountId: main.id, amountMinor: bet.paidMainMinor },
        ],
      },
      tx,
    );
    await tx.rocketRound.update({ where: { id: round.id }, data: { totalBetMinor: { decrement: bet.stakeMinor } } });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private liveBet(b: RocketBet, name: string, settings: RocketSettings): LiveBet {
    return {
      id: b.id,
      userId: b.userId,
      name,
      slot: b.slot,
      stakeMinor: b.stakeMinor,
      autoX100: b.autoX100,
      autoAt: effectiveAutoX100(b.stakeMinor, b.autoX100, settings.maxWinMinor),
      status: b.status,
      cashedX100: b.cashedX100,
      payoutMinor: b.payoutMinor,
    };
  }

  private after(ms: number, fn: () => Promise<void>) {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      if (this.stopped) return;
      fn().catch((e: Error) => {
        this.logger.error(e.stack ?? e.message);
        this.after(2000, fn); // every step is safe to repeat
      });
    }, Math.max(0, ms));
  }

  /** Coalesces bursts of changes into one broadcast per 150 ms (immediately for the crash). */
  private changed(now = false) {
    if (now) {
      clearTimeout(this.pending);
      this.pending = undefined;
      this.emit('state');
      return;
    }
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.emit('state');
    }, 150);
  }

  private async lockRound(tx: Tx, id: string): Promise<RocketRound> {
    await tx.$queryRaw`SELECT id FROM rocket_rounds WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.rocketRound.findUniqueOrThrow({ where: { id } });
  }
}

/** "Abebe" → "A***e": enough to recognise yourself, not enough to identify others. */
export function mask(name: string) {
  const n = [...name.trim()];
  if (n.length <= 1) return (n[0] ?? '?') + '***';
  return `${n[0]}***${n[n.length - 1]}`;
}
