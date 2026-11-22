import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import request from 'supertest';
import { AppModule, loadConfig } from '../src/app.module';
import { completeLines, generateCardSet } from '../src/bingo/cards';
import { ballOrder, hashSeed } from '../src/bingo/fair';
import { PRACTICE_ROOM_ID } from '../src/bingo/game.service';
import { APP_CONFIG } from '../src/config/config';
import { setupApp } from '../src/main';

describe('practice room (integration)', () => {
  const db = new PrismaClient();
  let app: INestApplication | undefined;
  let http: ReturnType<typeof request>;
  const route = `/api/rooms/${PRACTICE_ROOM_ID}`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (telegramId: number, firstName: string) =>
    (await http.post('/api/auth/dev').send({ telegramId, firstName }).expect(200)).body;
  const wallet = async (token: string) => (await http.get('/api/me/wallet').set(auth(token)).expect(200)).body;
  const state = async () => (await http.get(`${route}/state`).expect(200)).body;

  async function start(enabled: boolean) {
    const config = loadConfig();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...config, practiceRoomEnabled: enabled, money: { ...config.money, welcomeBonusMinor: 0n } })
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer());
  }

  async function until(predicate: (s: Awaited<ReturnType<typeof state>>) => boolean, timeout: number) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const s = await state();
      if (predicate(s)) return s;
      if (Date.now() >= deadline) throw new Error(`Unexpected practice state: ${JSON.stringify(s.round)}`);
      await sleep(100);
    }
  }

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe "${dbName}": test database names must end in _test`);
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
    await db.room.createMany({
      data: [
        { id: 'paid', name: 'Paid', stakeMinor: 1000n, cardPool: 100 },
        { id: PRACTICE_ROOM_ID, name: 'Practice', stakeMinor: 0n, cardPool: 100 },
      ],
    });
    const round = await db.round.create({
      data: {
        roomId: PRACTICE_ROOM_ID,
        stakeMinor: 0n,
        houseCutBps: 0,
        selectEndsAt: new Date(0),
        serverSeed: '',
        seedHash: '',
      },
    });
    // Pick a fixture where a sample card wins early, independently of the one human card left in play.
    const cards = generateCardSet(100, loadConfig().cardSetSeed);
    for (let i = 0; i < 10_000; i++) {
      const serverSeed = i.toString(16).padStart(64, '0');
      const firstCalls = new Set(ballOrder(serverSeed, round.number).slice(0, 12));
      if (!completeLines(cards[0], firstCalls).length && [98, 99].some((j) => completeLines(cards[j], firstCalls).length)) {
        await db.round.update({ where: { id: round.id }, data: { serverSeed, seedHash: hashSeed(serverSeed) } });
        return;
      }
    }
    throw new Error('No sample-winning test seed found');
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  afterAll(() => db.$disconnect());

  it('hides the room when disabled even if it already exists in the database', async () => {
    await start(false);
    await http.get(`${route}/state`).expect(404);
    const lobby = (await http.get('/api/rooms').expect(200)).body;
    expect(lobby.rooms.map((r: { id: string }) => r.id)).toEqual(['paid']);
  });

  it('waits for a human, plays a real draw with sample opponents and never touches wallets', async () => {
    await start(true);
    const ready = await until((s) => Date.parse(s.round.selectEndsAt) > Date.now(), 5000);
    expect(ready).toMatchObject({
      room: { practice: true, samplePlayers: 2, stake: { minor: '0' } },
      round: { status: 'SELECTING', players: 0, taken: [99, 100] },
    });
    const lobby = (await http.get('/api/rooms').expect(200)).body;
    expect(lobby.rooms).toMatchObject([
      { id: PRACTICE_ROOM_ID, samplePlayers: 2, round: { needPlayers: 1 } },
      { id: 'paid', practice: false, samplePlayers: 0, round: { needPlayers: 2 } },
    ]);

    const admin = await login(1, 'Staff');
    const alice = await login(11, 'Alice');
    const bob = await login(12, 'Bob');
    const wallets = await Promise.all([wallet(alice.token), wallet(bob.token)]);
    expect(wallets[0].balances.total.minor).toBe('0');
    const transactions = await db.ledgerTransaction.count();
    await http.post(`${route}/cards`).send({ cardNos: [1] }).expect(401);
    await http.post(`${route}/cards`).set(auth(alice.token)).send({ cardNos: [99] }).expect(409);
    await http.post(`${route}/cards`).set(auth(alice.token)).send({ cardNos: [1] }).expect(200);
    await http.post(`${route}/cards`).set(auth(bob.token)).send({ cardNos: [1] }).expect(409);
    await http.post(`${route}/cards`).set(auth(bob.token)).send({ cardNos: [2] }).expect(200);
    expect((await state()).round.players).toBe(2);
    await http.delete(`${route}/cards/2`).set(auth(bob.token)).expect(200);
    await http.patch(`/api/admin/rooms/${PRACTICE_ROOM_ID}`).set(auth(admin.token)).send({ stakeBirr: 10 }).expect(404);

    const done = await until((s) => s.round.status === 'FINISHED', 50_000);
    expect(done.round).toMatchObject({ number: ready.round.number, players: 1, taken: [1, 99, 100], prize: { minor: '0' } });
    expect(done.result.winners.length).toBeGreaterThan(0);
    for (const winner of done.result.winners) {
      expect(winner).toMatchObject({ name: `Sample player ${winner.cardNo - 98}`, sampleNo: winner.cardNo - 98 });
      expect(completeLines(winner.layout, new Set(done.round.calls))).toContain(winner.lineIndex);
    }
    expect(done.result.prizePerWinner.minor).toBe('0');
    expect(await db.user.count()).toBe(3);
    expect(await db.ledgerTransaction.count()).toBe(transactions);
    expect(await Promise.all([wallet(alice.token), wallet(bob.token)])).toEqual(wallets);
    expect((await http.get('/api/me/games').set(auth(alice.token)).expect(200)).body).toEqual([]);
    expect((await http.get('/api/admin/summary').set(auth(admin.token)).expect(200)).body).toMatchObject({ rounds: 0, cardsSold: 0 });
    expect((await http.get('/api/admin/rounds').set(auth(admin.token)).expect(200)).body.map((r: { roomId: string }) => r.roomId)).toEqual(['paid']);
  });
});
