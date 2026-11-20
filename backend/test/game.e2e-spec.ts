import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { completeLines } from '../src/bingo/cards';
import { ballOrder, hashSeed } from '../src/bingo/fair';
import { LedgerService } from '../src/ledger/ledger.service';
import { setupApp } from '../src/main';

const sms = (amount: string, ref: string, to = 'ABEBE KEBEDE') =>
  `Dear x You have transferred ETB ${amount} to ${to} (2519****0000) on 20/11/2026 12:30:58. Your transaction number is ${ref}. The service fee is ETB 1.74.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('bingo platform (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const db = new PrismaClient();

  const login = async (telegramId: number, firstName: string, startParam?: string) => {
    const r = await http.post('/api/auth/dev').send({ telegramId, firstName, startParam }).expect(200);
    return { token: r.body.token as string, user: r.body.user };
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const balances = async (t: string) => (await http.get('/api/me/wallet').set(auth(t)).expect(200)).body.balances;

  async function deposit(player: string, admin: string, amount: string, ref: string) {
    const d = await http.post('/api/payments/deposits').set(auth(player)).send({ method: 'TELEBIRR', smsText: sms(amount, ref) }).expect(201);
    await http.post(`/api/admin/deposits/${d.body.id}/approve`).set(auth(admin)).send({}).expect(200);
  }

  async function waitFor(status: string[], roomId: string, timeoutMs = 30_000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const s = (await http.get(`/api/rooms/${roomId}/state`).expect(200)).body;
      if (status.includes(s.round.status)) return s;
      if (Date.now() > end) throw new Error(`Room ${roomId} stuck in ${s.round.status}`);
      await sleep(100);
    }
  }

  beforeAll(async () => {
    // Start from an empty schema. Refuses to touch any database whose name does not end in "_test".
    const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe "${dbName}": test database names must end in _test`);
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
    // A fast room: 3 s to pick cards, a ball every 40 ms.
    await db.room.create({
      data: { id: 't1', name: 'Test 10', stakeMinor: 1000n, cardPool: 100, selectSeconds: 3, callIntervalMs: 40, minCards: 2 },
    });
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

  it('plays a full round: deposits, bonuses, cards, draw, prize, withdrawal; books stay balanced', async () => {
    const admin = await login(1, 'Staff');
    expect(admin.user.role).toBe('ADMIN');
    const alice = await login(100, 'Alice');
    const bob = await login(200, 'Bob', `ref_${alice.user.referralCode}`);

    // Unreadable SMS, wrong receiver, too small.
    await http.post('/api/payments/deposits').set(auth(bob.token)).send({ method: 'TELEBIRR', smsText: 'hello there this is not an sms' }).expect(400);
    await http.post('/api/payments/deposits').set(auth(bob.token)).send({ method: 'TELEBIRR', smsText: sms('200.00', 'WRONG12345', 'SOMEONE ELSE') }).expect(400);
    await http.post('/api/payments/deposits').set(auth(bob.token)).send({ method: 'TELEBIRR', smsText: sms('50.00', 'SMALL12345') }).expect(400);

    await deposit(alice.token, admin.token, '200.00', 'AAAA111111');
    await deposit(bob.token, admin.token, '100.00', 'BBBB222222');
    // The same SMS cannot be used twice.
    await http.post('/api/payments/deposits').set(auth(bob.token)).send({ method: 'TELEBIRR', smsText: sms('100.00', 'bbbb222222') }).expect(409);

    // First-deposit bonus 20% to the play wallet; Alice also earns 10 birr for inviting Bob.
    expect(await balances(alice.token)).toMatchObject({ main: { birr: '200' }, play: { birr: '50' } });
    expect(await balances(bob.token)).toMatchObject({ main: { birr: '100' }, play: { birr: '20' } });

    const state = await waitFor(['SELECTING'], 't1');
    const roundNumber = state.round.number;

    // Alice takes cards 1-4 (bonus money first: 50 birr covers all four).
    await http.post('/api/rooms/t1/cards').set(auth(alice.token)).send({ cardNos: [1, 2, 3, 4] }).expect(200);
    expect(await balances(alice.token)).toMatchObject({ main: { birr: '200' }, play: { birr: '10' } });
    // A 5th card is over the limit; a taken card cannot be bought.
    await http.post('/api/rooms/t1/cards').set(auth(alice.token)).send({ cardNos: [5] }).expect(422);
    const taken = await http.post('/api/rooms/t1/cards').set(auth(bob.token)).send({ cardNos: [4, 9] }).expect(409);
    expect(taken.body.code).toBe('CARD_TAKEN');
    // Bob buys 3, returns 1.
    await http.post('/api/rooms/t1/cards').set(auth(bob.token)).send({ cardNos: [7, 8, 9] }).expect(200);
    const back = await http.delete('/api/rooms/t1/cards/9').set(auth(bob.token)).expect(200);
    expect(back.body.cards).toEqual([7, 8]);
    expect(await balances(bob.token)).toMatchObject({ main: { birr: '100' }, play: { birr: '0' } });

    const live = (await http.get('/api/rooms/t1/state').expect(200)).body;
    expect(live.round.taken).toEqual([1, 2, 3, 4, 7, 8]);
    expect(live.round.players).toBe(2);
    expect(live.round.prize.birr).toBe('48'); // 6 cards x 10 birr, minus 20%
    expect(live.round.serverSeed).toBeNull();

    // Let the round play out.
    const done = await waitFor(['FINISHED'], 't1');
    expect(done.round.number).toBe(roundNumber);
    expect(done.result.winners.length).toBeGreaterThanOrEqual(1);

    // Fairness: the published seed matches the hash shown before, and re-derives the balls called.
    const proof = (await http.get(`/api/rounds/${roundNumber}/fairness`).expect(200)).body;
    expect(hashSeed(proof.serverSeed)).toBe(proof.seedHash);
    expect(ballOrder(proof.serverSeed, roundNumber).slice(0, proof.calls.length)).toEqual(proof.calls);

    // The winners really had a full line on the last ball, and nobody had one a ball earlier.
    const cards = (await http.get('/api/cards?pool=100').expect(200)).body.cards as number[][];
    const called = new Set<number>(proof.calls);
    const before = new Set<number>(proof.calls.slice(0, -1));
    const sold = [1, 2, 3, 4, 7, 8];
    const expected = sold.filter((c) => completeLines(cards[c - 1], called).length);
    expect(done.result.winners.map((w: any) => w.cardNo).sort()).toEqual(expected.sort());
    expect(sold.filter((c) => completeLines(cards[c - 1], before).length)).toEqual([]);

    // Prize = 60 birr x 80%, shared; paid to the main wallet.
    const round = await db.round.findUniqueOrThrow({ where: { number: roundNumber } });
    expect(round.prizeMinor + round.houseCutMinor).toBe(6000n);
    const aliceAfter = await balances(alice.token);
    const bobAfter = await balances(bob.token);
    const won = (BigInt(aliceAfter.main.minor) - 20000n) + (BigInt(bobAfter.main.minor) - 10000n);
    expect(won).toBe(round.prizeMinor);

    // Withdrawal: held at once, then paid by staff.
    const w = await http
      .post('/api/payments/withdrawals')
      .set(auth(alice.token))
      .send({ method: 'TELEBIRR', accountNumber: '0911223344', accountName: 'Alice A', amountBirr: '150' })
      .expect(201);
    await http
      .post('/api/payments/withdrawals')
      .set(auth(alice.token))
      .send({ method: 'TELEBIRR', accountNumber: '0911223344', accountName: 'Alice A', amountBirr: '100' })
      .expect(409);
    expect((await balances(alice.token)).pendingWithdrawal.birr).toBe('150');
    await http.post(`/api/admin/withdrawals/${w.body.id}/paid`).set(auth(admin.token)).send({ note: 'TB123' }).expect(200);
    expect((await balances(alice.token)).pendingWithdrawal.birr).toBe('0');
    // Players cannot use staff routes.
    await http.get('/api/admin/summary').set(auth(alice.token)).expect(403);

    const summary = (await http.get('/api/admin/summary').set(auth(admin.token)).expect(200)).body;
    expect(summary.ledgerCheck.minor).toBe('0');
    expect(summary.rounds).toBe(1);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });

  it('cancels a round with a single player and refunds the cards', async () => {
    const carol = await login(300, 'Carol');
    const admin = await login(1, 'Staff');
    await deposit(carol.token, admin.token, '100.00', 'CCCC333333');
    const start = await balances(carol.token);
    await waitFor(['SELECTING'], 't1');
    await http.post('/api/rooms/t1/cards').set(auth(carol.token)).send({ cardNos: [10, 11] }).expect(200);
    const s = await waitFor(['CANCELLED'], 't1');
    expect(s.cancelled.reason).toBe('NOT_ENOUGH_PLAYERS');
    expect(await balances(carol.token)).toEqual(start);
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });
});
