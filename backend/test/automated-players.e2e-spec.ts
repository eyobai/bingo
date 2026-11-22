import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountType, PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { AppModule, loadConfig } from '../src/app.module';
import { APP_CONFIG } from '../src/config/config';
import { LedgerService } from '../src/ledger/ledger.service';
import { setupApp } from '../src/main';

/**
 * House-funded automated players in paid rooms: disclosure before purchase, real stakes from the house bankroll,
 * one shared pool, prizes routed by owner, skipped entries when the bankroll is short, refunds to the source,
 * staff controls and the audit trail.
 */
describe('automated players (integration)', () => {
  const db = new PrismaClient();
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let staff: string;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (telegramId: number, firstName: string) =>
    (await http.post('/api/auth/dev').send({ telegramId, firstName }).expect(200)).body as { token: string; user: { id: string } };
  const state = async (room: string) => (await http.get(`/api/rooms/${room}/state`).expect(200)).body;
  const bankroll = () => db.ledgerAccount.findUnique({ where: { code: `SYSTEM:${AccountType.HOUSE_BANKROLL}` } }).then((a) => a?.balanceMinor ?? 0n);
  const fund = (birr: number, ref: string) =>
    http.post('/api/admin/house-bankroll/funding').set(auth(staff)).send({ amountBirr: String(birr), bankReference: ref }).expect(200);

  async function until(room: string, predicate: (s: any) => boolean, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const s = await state(room);
      if (predicate(s)) return s;
      if (Date.now() >= deadline) throw new Error(`Room ${room} stuck: ${JSON.stringify(s.round)}`);
      await sleep(100);
    }
  }
  /** A fresh countdown with enough time left to act in. */
  const freshRound = (room: string, msLeft: number) =>
    until(room, (s) => s.round.status === 'SELECTING' && Date.parse(s.round.selectEndsAt) - Date.now() > msLeft);

  async function player(n: number) {
    const p = await login(5000 + n, `Player ${n}`);
    await http.post(`/api/admin/players/${p.user.id}/adjust`).set(auth(staff)).send({ wallet: 'main', amountBirr: '100', reason: 'test' }).expect(200);
    return p;
  }
  const buy = (room: string, token: string, cardNos: number[], accept = true) =>
    http.post(`/api/rooms/${room}/cards`).set(auth(token)).send({ cardNos, acceptAutomatedPlayers: accept });
  const mainBalance = async (userId: string) =>
    (await db.ledgerAccount.findUniqueOrThrow({ where: { code: `${AccountType.USER_MAIN}:${userId}` } })).balanceMinor;

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe "${dbName}": test database names must end in _test`);
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
    const room = { stakeMinor: 1000n, cardPool: 400, callIntervalMs: 30, houseCutBps: 2000 };
    await db.room.createMany({
      data: [
        { id: 'plain', name: 'Plain', ...room, selectSeconds: 60, sortOrder: 0 },
        { id: 'short', name: 'Short', ...room, selectSeconds: 6, automatedEnabled: true, automatedPlayers: 5, sortOrder: 1 },
        { id: 'full', name: 'Full', ...room, selectSeconds: 12, automatedEnabled: true, automatedPlayers: 50, sortOrder: 2 },
        { id: 'refund', name: 'Refund', ...room, selectSeconds: 5, automatedEnabled: true, automatedPlayers: 3, sortOrder: 3 },
      ],
    });
    const config = loadConfig();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...config, money: { ...config.money, welcomeBonusMinor: 0n } })
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());
    staff = (await login(1, 'Staff')).token;
  });

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  it('is off by default and announced before purchase where enabled', async () => {
    expect((await state('plain')).room.automatedPlayers).toBe(0);
    const lobby = (await http.get('/api/rooms').expect(200)).body.rooms;
    expect(lobby.find((r: any) => r.id === 'plain')).toMatchObject({ automatedPlayers: 0, round: { needPlayers: 2 } });
    expect(lobby.find((r: any) => r.id === 'full')).toMatchObject({ automatedPlayers: 50, round: { needPlayers: 1, automated: 0 } });
  });

  it('skips entries the bankroll cannot pay for, and requires the disclosure to be accepted', async () => {
    await fund(25, 'TEST-FUND-1'); // pays for 2 of the 5 announced 10-birr entries
    await fund(25, 'TEST-FUND-1'); // the same transfer recorded twice counts once
    await http.post('/api/admin/house-bankroll/funding').set(auth(staff)).send({ amountBirr: '30', bankReference: 'TEST-FUND-1' }).expect(409);
    expect(await bankroll()).toBe(2500n);

    const a = await player(1);
    await freshRound('short', 3000);
    const refused = await buy('short', a.token, [1], false).expect(400);
    expect(refused.body.code).toBe('AUTOMATED_TERMS_REQUIRED');
    await buy('short', a.token, [1]).expect(200);
    const s = await state('short');
    expect(s.round).toMatchObject({ players: 1, automated: 2, cardsSold: 3, prize: { minor: String((3000 * 8) / 10) } });
    expect(s.round.automatedCards).toHaveLength(2);
    expect(s.round.taken).toEqual(expect.arrayContaining([1, ...s.round.automatedCards]));
    expect(await bankroll()).toBe(500n);
    const round = await db.round.findFirstOrThrow({ where: { roomId: 'short', number: s.round.number } });
    expect(round).toMatchObject({ housePlanned: 5, houseSkipped: 3, houseStakeMinor: 2000n, stakeTotalMinor: 3000n });
    // A real player cannot take an automated player's card.
    const b = await player(2);
    await buy('short', b.token, [s.round.automatedCards[0]]).expect(409);

    // One real player plus automated players is enough to play; the round settles to the right owners.
    const done = await until('short', (x) => x.round.number === s.round.number && x.round.status === 'FINISHED');
    const settled = await db.round.findUniqueOrThrow({ where: { id: round.id }, include: { winners: true } });
    const perWinner = settled.prizePerWinnerMinor;
    expect(settled.prizeMinor).toBe(2400n - (2400n % BigInt(done.result.winners.length)));
    expect(settled.housePrizeMinor).toBe(perWinner * BigInt(settled.houseWinningCards.length));
    expect(await bankroll()).toBe(500n + settled.housePrizeMinor);
    expect(await mainBalance(a.user.id)).toBe(10_000n - 1000n + perWinner * BigInt(settled.winners.length));
    for (const w of done.result.winners) expect(Boolean(w.automated)).toBe(settled.houseWinningCards.includes(w.cardNo));
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });

  it('puts every paid card in one pool: 50 automated + 10 real players at 10 birr is a 600 birr pool', async () => {
    await fund(1000, 'TEST-FUND-2');
    const before = await bankroll();
    const players = await Promise.all(Array.from({ length: 10 }, (_, i) => player(10 + i)));
    const ready = await freshRound('full', 6000);
    for (const p of players) {
      // Automated players take random cards with the first purchase, so pick one that is still free.
      const taken = new Set<number>((await state('full')).round.taken);
      const free = Array.from({ length: 400 }, (_, i) => i + 1).find((n) => !taken.has(n))!;
      await buy('full', p.token, [free]).expect(200);
    }
    const s = await state('full');
    expect(s.round).toMatchObject({ players: 10, automated: 50, cardsSold: 60, prize: { minor: '48000' } }); // 600 - 20%
    expect(await bankroll()).toBe(before - 50_000n);

    await until('full', (x) => x.round.number === ready.round.number && x.round.status === 'FINISHED');
    const r = await db.round.findFirstOrThrow({ where: { roomId: 'full', number: ready.round.number }, include: { winners: true } });
    expect(r).toMatchObject({ stakeTotalMinor: 60_000n, houseStakeMinor: 50_000n, houseCutMinor: 60_000n - r.prizeMinor });
    const humanWinners = r.winners.length;
    const houseWinners = r.houseWinningCards.length;
    expect(humanWinners + houseWinners).toBeGreaterThan(0);
    // Same split for every winning card, whoever owns it; a sole real winner would get the full 480.
    expect(r.prizePerWinnerMinor).toBe(48_000n / BigInt(humanWinners + houseWinners));
    expect(await bankroll()).toBe(before - 50_000n + r.housePrizeMinor);
    for (const w of r.winners) expect(w.prizeMinor).toBe(r.prizePerWinnerMinor);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);

    const summary = (await http.get('/api/admin/summary').set(auth(staff)).expect(200)).body;
    expect(BigInt(summary.housePlayerStakes.minor)).toBeGreaterThanOrEqual(50_000n);
    const rounds = (await http.get('/api/admin/rounds').set(auth(staff)).expect(200)).body;
    expect(rounds.find((x: any) => x.number === ready.round.number)).toMatchObject({ automatedAnnounced: 50, automatedCards: 50, automatedSkipped: 0 });
  });

  it('refunds every stake to its source when the round is cancelled', async () => {
    const before = await bankroll();
    const p = await player(40);
    const ready = await freshRound('refund', 2500);
    await buy('refund', p.token, [7]).expect(200);
    expect((await state('refund')).round.automated).toBe(3);
    expect(await bankroll()).toBe(before - 3000n);
    // The only real player leaves: the round cannot run on automated players alone.
    await http.delete('/api/rooms/refund/cards/7').set(auth(p.token)).expect(200);
    await until('refund', (x) => x.round.number === ready.round.number && x.round.status === 'CANCELLED', 15_000);
    expect(await bankroll()).toBe(before);
    expect(await mainBalance(p.user.id)).toBe(10_000n);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });

  it('lets staff control it per room and records every change and bankroll movement', async () => {
    await http.patch('/api/admin/rooms/plain').set(auth(staff)).send({ automatedEnabled: true }).expect(400); // needs a count
    await http.patch('/api/admin/rooms/plain').set(auth(staff)).send({ automatedEnabled: true, automatedPlayers: 400 }).expect(400);
    await http.patch('/api/admin/rooms/plain').set(auth(staff)).send({ automatedEnabled: true, automatedPlayers: 20 }).expect(200);
    await http.patch('/api/admin/rooms/plain').set(auth(staff)).send({ automatedEnabled: false }).expect(200);
    const bank = (await http.get('/api/admin/house-bankroll').set(auth(staff)).expect(200)).body;
    await http
      .post('/api/admin/house-bankroll/withdrawal')
      .set(auth(staff))
      .send({ amountBirr: String(Number(BigInt(bank.balance.minor) / 100n) + 1), bankReference: 'TEST-OUT-1' })
      .expect(409);
    await http.post('/api/admin/house-bankroll/withdrawal').set(auth(staff)).send({ amountBirr: '1', bankReference: 'TEST-OUT-2' }).expect(200);

    const log = (await http.get('/api/admin/audit').set(auth(staff)).expect(200)).body;
    const actions = log.map((e: any) => `${e.action}:${e.targetId}`);
    expect(actions).toEqual(
      expect.arrayContaining([
        'ROOM_AUTOMATED_PLAYERS:plain',
        'BANKROLL_FUND:HOUSE_BANKROLL',
        'BANKROLL_WITHDRAW:HOUSE_BANKROLL',
      ]),
    );
    expect(log.filter((e: any) => e.action === 'BANKROLL_FUND')).toHaveLength(2); // the repeated reference is not logged twice
    const on = log.find((e: any) => e.action === 'ROOM_AUTOMATED_PLAYERS' && e.after.automatedEnabled === true);
    const off = log.find((e: any) => e.action === 'ROOM_AUTOMATED_PLAYERS' && e.after.automatedEnabled === false);
    expect(off).toMatchObject({ before: { automatedEnabled: true, automatedPlayers: 20 } });
    expect(on).toMatchObject({ before: { automatedEnabled: false, automatedPlayers: 0 }, after: { automatedEnabled: true, automatedPlayers: 20 }, staff: { telegramId: '1' } });
    // Players cannot read or change any of it.
    const p = await player(50);
    await http.get('/api/admin/audit').set(auth(p.token)).expect(403);
    await http.post('/api/admin/house-bankroll/funding').set(auth(p.token)).send({ amountBirr: '5', bankReference: 'X-123' }).expect(403);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });
});
