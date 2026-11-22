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
    // All start switched off; each test switches on only its own room, so the shared bankroll is predictable.
    await db.room.createMany({
      data: [
        { id: 'plain', name: 'Plain', ...room, selectSeconds: 60, sortOrder: 0 },
        { id: 'short', name: 'Short', ...room, selectSeconds: 6, sortOrder: 1 },
        { id: 'full', name: 'Full', ...room, selectSeconds: 12, sortOrder: 2 },
        { id: 'solo', name: 'Solo', ...room, selectSeconds: 4, sortOrder: 3 },
        { id: 'refund', name: 'Refund', ...room, selectSeconds: 5, minCards: 10, sortOrder: 4 },
        { id: 'unfunded', name: 'Unfunded', ...room, selectSeconds: 2, sortOrder: 5 },
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

  const enable = (room: string, n: number, maxCards = 1) =>
    http.patch(`/api/admin/rooms/${room}`).set(auth(staff)).send({ automatedEnabled: true, automatedPlayers: n, automatedMaxCards: maxCards }).expect(200);
  const disable = (room: string) => http.patch(`/api/admin/rooms/${room}`).set(auth(staff)).send({ automatedEnabled: false }).expect(200);
  /** The first countdown that uses the room's automated-player setting, with time left to act in. */
  const automatedRound = (room: string, n: number, msLeft: number) =>
    until(room, (s) => s.room.automatedPlayers === n && s.round.status === 'SELECTING' && Date.parse(s.round.selectEndsAt) - Date.now() > msLeft);

  it('is off by default', async () => {
    expect((await state('plain')).room.automatedPlayers).toBe(0);
    const lobby = (await http.get('/api/rooms').expect(200)).body.rooms;
    expect(lobby.find((r: any) => r.id === 'plain')).toMatchObject({ automatedPlayers: 0, round: { needPlayers: 2, automated: 0 } });
  });

  it('keeps the staff record when every automated player was skipped', async () => {
    await enable('unfunded', 3);
    const ready = await automatedRound('unfunded', 3, 900);
    await disable('unfunded');
    await until('unfunded', (s) => s.round.number > ready.round.number);
    const rounds = (await http.get('/api/admin/rounds').set(auth(staff)).expect(200)).body;
    expect(rounds.find((r: any) => r.number === ready.round.number)).toMatchObject({
      status: 'CANCELLED', automatedAnnounced: 3, automatedCards: 0, automatedSkipped: 3,
    });
    expect(await bankroll()).toBe(0n);
  });

  it('joins at the countdown start, skips what the bankroll cannot pay, and requires the disclosure', async () => {
    await fund(25, 'TEST-FUND-1'); // pays for 2 of the 5 announced 10-birr entries
    await fund(25, 'TEST-FUND-1'); // the same transfer recorded twice counts once
    await http.post('/api/admin/house-bankroll/funding').set(auth(staff)).send({ amountBirr: '30', bankReference: 'TEST-FUND-1' }).expect(409);
    const duplicate = await http.post('/api/admin/house-bankroll/withdrawal').set(auth(staff))
      .send({ amountBirr: '25', bankReference: 'test-fund-1' }).expect(409);
    expect(duplicate.body.code).toBe('REFERENCE_USED');
    expect(await bankroll()).toBe(2500n);

    await enable('short', 5);
    const open = await automatedRound('short', 5, 3000);
    await disable('short'); // only this round uses automated players
    // Before any real player: the automated players are already in, counted and labelled.
    expect(open.round).toMatchObject({ players: 0, automated: 2, cardsSold: 2 });
    const lobby = (await http.get('/api/rooms').expect(200)).body.rooms;
    expect(lobby.find((r: any) => r.id === 'short').round).toMatchObject({ automated: 2, needPlayers: 0 });
    expect(await bankroll()).toBe(500n);
    const round = await db.round.findFirstOrThrow({ where: { roomId: 'short', number: open.round.number } });
    expect(round).toMatchObject({ housePlanned: 5, houseSkipped: 3, houseStakeMinor: 2000n, stakeTotalMinor: 2000n });

    const a = await player(1);
    const card = Array.from({ length: 400 }, (_, i) => i + 1).find((n) => !open.round.taken.includes(n))!;
    const refused = await buy('short', a.token, [card], false).expect(400);
    expect(refused.body.code).toBe('AUTOMATED_TERMS_REQUIRED');
    await buy('short', a.token, [card]).expect(200);
    await buy('short', a.token, [open.round.automatedCards[0]]).expect(409); // an automated player's card
    const s = await state('short');
    expect(s.round).toMatchObject({ players: 1, automated: 2, cardsSold: 3, prize: { minor: '2400' } });

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
    const players = await Promise.all(Array.from({ length: 10 }, (_, i) => player(10 + i)));
    await enable('full', 50);
    const ready = await automatedRound('full', 50, 6000);
    await disable('full');
    expect(ready.round).toMatchObject({ players: 0, automated: 50 });
    const afterJoin = await bankroll();
    const free = Array.from({ length: 400 }, (_, i) => i + 1).filter((n) => !ready.round.taken.includes(n));
    for (const [i, p] of players.entries()) await buy('full', p.token, [free[i]]).expect(200);
    const s = await state('full');
    expect(s.round).toMatchObject({ players: 10, automated: 50, cardsSold: 60, prize: { minor: '48000' } }); // 600 - 20%

    await until('full', (x) => x.round.number === ready.round.number && x.round.status === 'FINISHED');
    const r = await db.round.findFirstOrThrow({ where: { roomId: 'full', number: ready.round.number }, include: { winners: true } });
    expect(r).toMatchObject({ stakeTotalMinor: 60_000n, houseStakeMinor: 50_000n, houseCutMinor: 60_000n - r.prizeMinor });
    const winners = r.winners.length + r.houseWinningCards.length;
    expect(winners).toBeGreaterThan(0);
    // Same split for every winning card, whoever owns it; a sole real winner would get the full 480.
    expect(r.prizePerWinnerMinor).toBe(48_000n / BigInt(winners));
    expect(await bankroll()).toBe(afterJoin + r.housePrizeMinor);
    for (const w of r.winners) expect(w.prizeMinor).toBe(r.prizePerWinnerMinor);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);

    const summary = (await http.get('/api/admin/summary').set(auth(staff)).expect(200)).body;
    expect(BigInt(summary.housePlayerStakes.minor)).toBeGreaterThanOrEqual(50_000n);
    const rounds = (await http.get('/api/admin/rounds').set(auth(staff)).expect(200)).body;
    expect(rounds.find((x: any) => x.number === ready.round.number)).toMatchObject({ automatedAnnounced: 50, automatedCards: 50, automatedSkipped: 0 });
  });

  it('plays with automated players only (several cards each), with no house cut, so the bankroll gets its pool back', async () => {
    const revenue = () => db.ledgerAccount.findUnique({ where: { code: 'SYSTEM:HOUSE_REVENUE' } }).then((a) => a?.balanceMinor ?? 0n);
    await enable('solo', 3, 3);
    const open = await automatedRound('solo', 3, 1000);
    await disable('solo');
    // 3 automated players, each with 1 to 3 random cards at the normal stake.
    const round = await db.round.findFirstOrThrow({ where: { roomId: 'solo', number: open.round.number } });
    expect(new Set(round.houseOwners).size).toBe(3);
    for (const owner of [1, 2, 3]) {
      const held = round.houseOwners.filter((o) => o === owner).length;
      expect(held).toBeGreaterThanOrEqual(1);
      expect(held).toBeLessThanOrEqual(3);
    }
    const cards = round.houseCards.length;
    const pool = 1000n * BigInt(cards);
    expect(round.houseStakeMinor).toBe(pool);
    expect(open.round).toMatchObject({ players: 0, automated: 3, cardsSold: cards });
    expect(open.room.automatedMaxCards).toBe(3);
    const [bankBefore, revenueBefore] = [(await bankroll()) + pool, await revenue()];

    const done = await until('solo', (x) => x.round.number === open.round.number && x.round.status === 'FINISHED');
    expect(done.result.winners.every((w: any) => w.automated && w.sampleNo >= 1 && w.sampleNo <= 3)).toBe(true);
    const r = await db.round.findFirstOrThrow({ where: { roomId: 'solo', number: open.round.number } });
    expect(r).toMatchObject({ houseCutMinor: pool - r.prizeMinor, topUpMinor: 0n, prizeMinor: pool - (pool % BigInt(r.houseWinningCards.length)) });
    expect(await bankroll()).toBe(bankBefore - (pool - r.housePrizeMinor));
    expect(await revenue()).toBe(revenueBefore + (pool - r.housePrizeMinor)); // only the split's rounding remainder
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });

  it('refunds every stake to its source when the round is cancelled', async () => {
    const p = await player(40);
    await enable('refund', 3);
    const ready = await automatedRound('refund', 3, 2500);
    await disable('refund');
    const afterJoin = await bankroll();
    const card = Array.from({ length: 400 }, (_, i) => i + 1).find((n) => !ready.round.taken.includes(n))!;
    await buy('refund', p.token, [card]).expect(200);
    // 4 cards is under this room's minimum of 10: cancelled and refunded.
    await until('refund', (x) => x.round.number === ready.round.number && x.round.status === 'CANCELLED', 15_000);
    expect(await bankroll()).toBe(afterJoin + 3000n);
    expect(await mainBalance(p.user.id)).toBe(10_000n);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });

  it('lets staff control it per room and records every change and bankroll movement', async () => {
    await http.patch('/api/admin/rooms/plain').set(auth(staff)).send({ automatedEnabled: true }).expect(400); // needs a count
    await http.patch('/api/admin/rooms/plain').set(auth(staff)).send({ automatedEnabled: true, automatedPlayers: 400 }).expect(400);
    // Never more cards than a real player may hold (4 here), and always cards left for real players.
    await http.patch('/api/admin/rooms/plain').set(auth(staff)).send({ automatedEnabled: true, automatedPlayers: 5, automatedMaxCards: 5 }).expect(400);
    await http.patch('/api/admin/rooms/plain').set(auth(staff)).send({ automatedEnabled: true, automatedPlayers: 100, automatedMaxCards: 4 }).expect(400);
    await enable('plain', 20);
    await disable('plain');
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

  it('validates simultaneous room edits against the latest settings', async () => {
    await db.room.create({
      data: {
        id: 'concurrent-edits', name: 'Concurrent edits', isActive: false, cardPool: 400,
        stakeMinor: 1000n, maxCardsPerPlayer: 4, automatedEnabled: true, automatedPlayers: 60,
      },
    });
    const patch = (data: object) => http.patch('/api/admin/rooms/concurrent-edits').set(auth(staff)).send(data);
    const results = await Promise.all([patch({ cardPool: 200 }), patch({ automatedMaxCards: 4 })]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
    const room = await db.room.findUniqueOrThrow({ where: { id: 'concurrent-edits' } });
    expect(room.automatedPlayers * room.automatedMaxCards).toBeLessThan(room.cardPool);
  });
});
