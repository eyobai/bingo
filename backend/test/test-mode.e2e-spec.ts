import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LedgerService } from '../src/ledger/ledger.service';
import { setupApp } from '../src/main';

describe('test mode (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const db = new PrismaClient();
  const KEY = process.env.TEST_KEY!;

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe "${dbName}"`);
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
    await db.room.create({ data: { id: 't1', name: 'Test', stakeMinor: 1000n, cardPool: 100, selectSeconds: 30, callIntervalMs: 1000 } });
    await db.room.create({ data: { id: 't2', name: 'Fast', stakeMinor: 1000n, cardPool: 100, selectSeconds: 3, callIntervalMs: 40, sortOrder: 1 } });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    http = request(app.getHttpServer()) as any;
  });

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  it('needs the key, only allows test ids, funds only test players, and shows the flag', async () => {
    await http.post('/api/test/login').send({ telegramId: 900001, firstName: 'Test 1' }).expect(403);
    await http.post('/api/test/login').set('x-test-key', 'wrong-key-0123456789abc').send({ telegramId: 900001, firstName: 'Test 1' }).expect(403);
    // A real-looking id (e.g. the admin's) is refused, so nobody can sign in as a real account.
    await http.post('/api/test/login').set('x-test-key', KEY).send({ telegramId: 8720440881, firstName: 'Admin' }).expect(400);
    await http.post('/api/test/login').set('x-test-key', KEY).send({ telegramId: 1, firstName: 'Staff' }).expect(400);

    const token = (await http.post('/api/test/login').set('x-test-key', KEY).send({ telegramId: 900001, firstName: 'Test 1' }).expect(200)).body.token;
    const me = (await http.get('/api/me').set('Authorization', `Bearer ${token}`).expect(200)).body;
    expect(me.user.role).toBe('PLAYER');

    await http.post('/api/test/fund').set('x-test-key', KEY).set('Authorization', `Bearer ${token}`).expect(200);
    const wallet = (await http.get('/api/me/wallet').set('Authorization', `Bearer ${token}`).expect(200)).body.balances;
    expect(wallet.main.birr).toBe('500');
    // Test players can buy cards (they get a made-up phone number).
    await http.post('/api/rooms/t1/cards').set('Authorization', `Bearer ${token}`).send({ cardNos: [5] }).expect(200);

    // A non-test account cannot get test money even with the key.
    const real = (await http.post('/api/auth/dev').send({ telegramId: 4242, firstName: 'Real' })).body.token;
    await http.post('/api/test/fund').set('x-test-key', KEY).set('Authorization', `Bearer ${real}`).expect(403);

    expect((await http.get('/api/rooms/t1/state').expect(200)).body.testMode).toBe(true);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });

  it('shows test players to everyone and carries their winnings into the next prize', async () => {
    const login = async (telegramId: number, firstName: string) =>
      (await http.post('/api/test/login').set('x-test-key', KEY).send({ telegramId, firstName }).expect(200)).body.token as string;
    const fund = (t: string) => http.post('/api/test/fund').set('x-test-key', KEY).set('Authorization', `Bearer ${t}`).expect(200);
    const a = await login(900101, 'Test A');
    const b = await login(900102, 'Test B');
    await fund(a);
    await fund(b);
    const waitFor = async (status: string, round?: number) => {
      for (const end = Date.now() + 30_000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
        const st = (await http.get('/api/rooms/t2/state')).body;
        if (st.round.status === status && (round === undefined || st.round.number === round)) return st;
      }
      throw new Error(`room t2 never reached ${status}`);
    };

    // Round 1: only test players, so a test player wins and the whole prize is carried over.
    const r1 = await waitFor('SELECTING');
    await http.post('/api/rooms/t2/cards').set('Authorization', `Bearer ${a}`).send({ cardNos: [1, 2] }).expect(200);
    await http.post('/api/rooms/t2/cards').set('Authorization', `Bearer ${b}`).send({ cardNos: [3, 4] }).expect(200);
    const live = (await http.get('/api/rooms/t2/state')).body;
    expect(live.round).toMatchObject({ testPlayers: 2, testTaken: [1, 2, 3, 4] });
    const done1 = await waitFor('FINISHED', r1.round.number);
    expect(done1.result.winners.every((w: any) => w.test)).toBe(true);
    const round1 = await db.round.findUniqueOrThrow({ where: { number: r1.round.number } });
    expect(round1.carryOutMinor).toBe(round1.prizeMinor); // 40 birr x 80% = 32 birr carried
    expect(done1.result.carriedOver.minor).toBe(round1.prizeMinor.toString());

    // Round 2: a real player joins; the carried-over money is in the prize shown to everyone.
    const real = (await http.post('/api/auth/dev').send({ telegramId: 4343, firstName: 'Real' })).body.token;
    const staff = (await http.post('/api/auth/dev').send({ telegramId: 1, firstName: 'Staff' })).body.token;
    const realUser = (await http.get('/api/me').set('Authorization', `Bearer ${real}`)).body.user;
    await http.post(`/api/admin/players/${realUser.id}/adjust`).set('Authorization', `Bearer ${staff}`).send({ wallet: 'main', amountBirr: '100', reason: 'test' }).expect(200);
    const r2 = await waitFor('SELECTING');
    expect(r2.round.carriedIn.minor).toBe(round1.prizeMinor.toString());
    await http.post('/api/rooms/t2/cards').set('Authorization', `Bearer ${real}`).send({ cardNos: [10, 11] }).expect(200);
    await http.post('/api/rooms/t2/cards').set('Authorization', `Bearer ${a}`).send({ cardNos: [12] }).expect(200);
    const st2 = (await http.get('/api/rooms/t2/state')).body;
    // 3 cards x 10 birr x 80% = 24 birr, plus the carry-over.
    expect(BigInt(st2.round.prize.minor)).toBe(2400n + round1.prizeMinor);
    await waitFor('FINISHED', r2.round.number);
    const round2 = await db.round.findUniqueOrThrow({ where: { number: r2.round.number }, include: { winners: true } });
    expect(round2.carryInMinor).toBe(round1.prizeMinor);
    const realWins = round2.winners.filter((w) => w.userId === realUser.id).length;
    const testWins = round2.winners.length - realWins;
    expect(round2.carryOutMinor).toBe(round2.prizePerWinnerMinor * BigInt(testWins));
    const rollover = await db.ledgerAccount.findUniqueOrThrow({ where: { code: 'SYSTEM:ROLLOVER' } });
    expect(rollover.balanceMinor).toBe(round2.carryOutMinor);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });
});
