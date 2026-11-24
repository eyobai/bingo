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
import { crashX100, sha256 } from '../src/rocket/crash';

describe('Leyu Rocket (integration)', () => {
  const db = new PrismaClient();
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let staff: string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const login = async (telegramId: number, firstName: string) =>
    (await http.post('/api/auth/dev').send({ telegramId, firstName }).expect(200)).body as { token: string; user: { id: string } };
  const state = async () => (await http.get('/api/rocket/state').expect(200)).body;
  const balance = async (code: string) => (await db.ledgerAccount.findUnique({ where: { code } }))?.balanceMinor ?? 0n;

  async function until(pred: (s: any) => boolean, timeout = 40_000) {
    const end = Date.now() + timeout;
    for (;;) {
      const s = await state();
      if (pred(s)) return s;
      if (Date.now() > end) throw new Error(`Rocket stuck: ${JSON.stringify(s.round)}`);
      await sleep(80);
    }
  }

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe "${dbName}"`);
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
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

  it('is closed until staff switch it on', async () => {
    expect((await state()).enabled).toBe(false);
    const p = await login(7001, 'Abebe');
    const r = await http.post('/api/rocket/bet').set(auth(p.token)).send({ slot: 1, amount: '10' }).expect(409);
    expect(r.body.code).toBe('ROCKET_OFF');
  });

  it('takes bets, cashes out at the live multiplier, settles at the crash and keeps the books balanced', async () => {
    await http.patch('/api/admin/rocket/settings').set(auth(staff)).send({ maxBetBirr: 5, minBetBirr: 10 }).expect(400);
    await http
      .patch('/api/admin/rocket/settings')
      .set(auth(staff))
      .send({ enabled: true, houseEdgePercent: 3, minBetBirr: 10, maxBetBirr: 1000, maxX: 3, maxWinBirr: 100000, bettingSeconds: 5 })
      .expect(200);

    const p = await login(7002, 'Almaz');
    await http.post(`/api/admin/players/${p.user.id}/adjust`).set(auth(staff)).send({ wallet: 'main', amountBirr: '500', reason: 'test' }).expect(200);
    const main = `${AccountType.USER_MAIN}:${p.user.id}`;

    const open = await until((s) => s.enabled && s.round?.status === 'BETTING' && Date.parse(s.round.bettingEndsAt) - Date.parse(s.serverTime) > 2500);
    expect(open.round.crashX).toBeNull(); // secret until the crash
    expect(open.round.seedHash).toMatch(/^[0-9a-f]{64}$/);

    const bad = await http.post('/api/rocket/bet').set(auth(p.token)).send({ slot: 1, amount: '5' }).expect(400);
    expect(bad.body.code).toBe('BAD_STAKE');
    await http.post('/api/rocket/bet').set(auth(p.token)).send({ slot: 1, amount: '100' }).expect(200);
    const dup = await http.post('/api/rocket/bet').set(auth(p.token)).send({ slot: 1, amount: '100' }).expect(409);
    expect(dup.body.code).toBe('SLOT_USED');
    // Take bet 1 back (full refund), place it again, and a second bet with auto cash-out at 1.01×.
    await http.delete('/api/rocket/bet/1').set(auth(p.token)).expect(200);
    expect(await balance(main)).toBe(50_000n);
    await http.post('/api/rocket/bet').set(auth(p.token)).send({ slot: 1, amount: '100' }).expect(200);
    await http.post('/api/rocket/bet').set(auth(p.token)).send({ slot: 2, amount: '50', autoX: 1.01 }).expect(200);
    expect(await balance(main)).toBe(50_000n - 15_000n);
    const mine = (await http.get('/api/rocket/my').set(auth(p.token)).expect(200)).body;
    expect(mine.current.map((b: any) => b.slot).sort()).toEqual([1, 2]);
    expect((await state()).bets.map((b: any) => b.name)).toContain('A***z'); // names are masked

    // Flying: no more bets for this round; cash out bet 1 by hand.
    await until((s) => s.round?.number === open.round.number && s.round.status !== 'BETTING');
    const late = await http.post('/api/rocket/bet').set(auth(p.token)).send({ slot: 1, amount: '10' });
    expect([409]).toContain(late.status);
    await sleep(1500);
    const cash = await http.post('/api/rocket/cashout').set(auth(p.token)).send({ slot: 1 });

    const done = await until((s) => s.round?.number === open.round.number && s.round.status === 'CRASHED');
    const round = await db.rocketRound.findUniqueOrThrow({ where: { number: open.round.number }, include: { bets: true } });
    const b1 = round.bets.find((b) => b.slot === 1)!;
    const b2 = round.bets.find((b) => b.slot === 2)!;
    if (cash.status === 200) {
      expect(b1.status).toBe('CASHED');
      expect(b1.cashedX100!).toBeGreaterThanOrEqual(100);
      expect(b1.cashedX100!).toBeLessThan(round.crashX100);
      expect(b1.payoutMinor).toBe((10_000n * BigInt(b1.cashedX100!)) / 100n);
    } else {
      expect(b1.status).toBe('LOST'); // crashed before the cash-out
    }
    // Auto cash-out at 1.01× wins whenever the rocket got past 1.01×.
    if (round.crashX100 > 101) expect(b2).toMatchObject({ status: 'CASHED', cashedX100: 101, payoutMinor: 5050n });
    else expect(b2.status).toBe('LOST');

    // Money: wallet = start − stakes + wins; the house holds the difference; the books balance.
    const won = round.bets.reduce((s, b) => s + b.payoutMinor, 0n);
    expect(await balance(main)).toBe(50_000n - 15_000n + won);
    expect(await balance(`SYSTEM:${AccountType.ROCKET_HOUSE}`)).toBe(15_000n - won);
    expect(round).toMatchObject({ totalBetMinor: 15_000n, totalPaidMinor: won });
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);

    // Provably fair: the revealed seed matches the hash shown before betting and gives the same crash point.
    expect(done.round.serverSeed).toBeTruthy();
    expect(sha256(done.round.serverSeed)).toBe(open.round.seedHash);
    const v = (await http.get(`/api/rocket/verify/${open.round.number}`).expect(200)).body;
    expect(crashX100(v.serverSeed, v.number, v.houseEdgeBps, 300)).toBe(Math.round(v.crashX * 100));
    expect(done.history[0]).toMatchObject({ number: open.round.number, x100: round.crashX100 });

    // Staff report and audit trail.
    const report = (await http.get('/api/admin/rocket').set(auth(staff)).expect(200)).body;
    expect(report.settings).toMatchObject({ enabled: true, houseEdgePercent: 3, maxX: 3 });
    expect(report.rounds.find((r: any) => r.number === open.round.number)).toMatchObject({ bets: 2 });
    const audit = (await http.get('/api/admin/audit').set(auth(staff)).expect(200)).body;
    expect(audit.some((e: any) => e.action === 'ROCKET_SETTINGS' && e.after.enabled === true)).toBe(true);
    await http.patch('/api/admin/rocket/settings').set(auth(staff)).send({ enabled: false }).expect(200);
  }, 120_000);
});
