import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { LedgerService } from '../src/ledger/ledger.service';
import { setupApp } from '../src/main';

const sms = (amount: string, ref: string, to = 'ABEBE KEBEDE') =>
  `Dear x You have transferred ETB ${amount} to ${to} (2519****0000) on 20/11/2026 12:30:58. Your transaction number is ${ref}. The service fee is ETB 1.74.`;

describe('promo codes (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const db = new PrismaClient();
  const login = async (telegramId: number, firstName: string) =>
    (await http.post('/api/auth/dev').send({ telegramId, firstName }).expect(200)).body.token as string;
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const play = async (t: string) => (await http.get('/api/me/wallet').set(auth(t)).expect(200)).body.balances.play.birr as string;

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe "${dbName}"`);
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
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

  it('creates, redeems once per player, respects limits, expiry, deposit rule and switch-off', async () => {
    const staff = await login(1, 'Staff');
    const a = await login(501, 'Abel');
    const b = await login(502, 'Bethel');
    const c = await login(503, 'Chala');

    // Players cannot create codes.
    await http.post('/api/admin/promos').set(auth(a)).send({ amountBirr: 10, requiresDeposit: false }).expect(403);
    const welcome = (await http.post('/api/admin/promos').set(auth(staff)).send({ code: ' welcome 50 ', amountBirr: 50, maxUses: 2, requiresDeposit: false }).expect(201)).body;
    expect(welcome).toMatchObject({ code: 'WELCOME50', amount: { birr: '50' }, state: 'ACTIVE' });
    await http.post('/api/admin/promos').set(auth(staff)).send({ code: 'welcome50', amountBirr: 5, requiresDeposit: false }).expect(409);
    const random = (await http.post('/api/admin/promos').set(auth(staff)).send({ amountBirr: 5, requiresDeposit: false }).expect(201)).body;
    expect(random.code).toMatch(/^[A-Z0-9]{8}$/);

    const before = await play(a); // includes the welcome gift from registering
    const r = (await http.post('/api/me/promo').set(auth(a)).send({ code: 'Welcome50' }).expect(200)).body;
    expect(r.amount.birr).toBe('50');
    expect(Number(await play(a)) - Number(before)).toBe(50);
    expect((await http.post('/api/me/promo').set(auth(a)).send({ code: 'WELCOME50' }).expect(409)).body.code).toBe('PROMO_ALREADY_USED');
    await http.post('/api/me/promo').set(auth(b)).send({ code: 'WELCOME50' }).expect(200);
    expect((await http.post('/api/me/promo').set(auth(c)).send({ code: 'WELCOME50' }).expect(410)).body.code).toBe('PROMO_USED_UP');
    expect((await http.post('/api/me/promo').set(auth(c)).send({ code: 'NOPE123' }).expect(404)).body.code).toBe('PROMO_NOT_FOUND');

    // Deposit-only code.
    const loyal = (await http.post('/api/admin/promos').set(auth(staff)).send({ code: 'LOYAL', amountBirr: 20, requiresDeposit: true }).expect(201)).body;
    expect((await http.post('/api/me/promo').set(auth(c)).send({ code: 'loyal' }).expect(403)).body.code).toBe('PROMO_NEEDS_DEPOSIT');

    // Switched off, and expired.
    await http.patch(`/api/admin/promos/${loyal.id}`).set(auth(staff)).send({ isActive: false }).expect(200);
    const exp = (await http.post('/api/admin/promos').set(auth(staff)).send({ code: 'SOON', amountBirr: 5, requiresDeposit: false, expiresAt: new Date(Date.now() + 1500).toISOString() }).expect(201)).body;
    await new Promise((res) => setTimeout(res, 1700));
    expect((await http.post('/api/me/promo').set(auth(c)).send({ code: 'SOON' }).expect(410)).body.code).toBe('PROMO_EXPIRED');
    expect((await http.post('/api/me/promo').set(auth(c)).send({ code: 'LOYAL' }).expect(410)).body.code).toBe('PROMO_OFF');

    // Many players at once never exceed the limit.
    const limited = (await http.post('/api/admin/promos').set(auth(staff)).send({ code: 'RUSH', amountBirr: 5, maxUses: 3, requiresDeposit: false }).expect(201)).body;
    const tokens = await Promise.all(Array.from({ length: 8 }, (_, i) => login(600 + i, `Rush ${i}`)));
    const results = await Promise.all(tokens.map((t) => http.post('/api/me/promo').set(auth(t)).send({ code: 'RUSH' })));
    expect(results.filter((x) => x.status === 200)).toHaveLength(3);
    const list = (await http.get('/api/admin/promos').set(auth(staff)).expect(200)).body;
    expect(list.find((p: any) => p.id === limited.id)).toMatchObject({ usedCount: 3, state: 'USED_UP' });
    expect(list.find((p: any) => p.id === exp.id).state).toBe('EXPIRED');
    expect((await http.get(`/api/admin/promos/${welcome.id}/redemptions`).set(auth(staff)).expect(200)).body).toHaveLength(2);

    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });

  it('switches a code to depositors only, and removes unused bonus from players who never deposited', async () => {
    const staff = await login(1, 'Staff');
    const gift = (await http.post('/api/admin/promos').set(auth(staff)).send({ code: 'GIFT10', amountBirr: 10, requiresDeposit: false }).expect(201)).body;
    const noDeposit = await login(701, 'Dawit');
    const depositor = await login(702, 'Eleni');
    const pending = await login(703, 'Fikir');
    for (const t of [noDeposit, depositor, pending]) await http.post('/api/me/promo').set(auth(t)).send({ code: 'GIFT10' }).expect(200);
    // Eleni deposits (approved); Fikir's deposit is still waiting for approval.
    const d = await http.post('/api/payments/deposits').set(auth(depositor)).send({ method: 'TELEBIRR', smsText: sms('200.00', 'BONUSTEST01') }).expect(201);
    await http.post(`/api/admin/deposits/${d.body.id}/approve`).set(auth(staff)).send({}).expect(200);
    await http.post('/api/payments/deposits').set(auth(pending)).send({ method: 'TELEBIRR', smsText: sms('200.00', 'BONUSTEST02') }).expect(201);

    // From now on the code is for depositors only.
    await http.patch(`/api/admin/promos/${gift.id}`).set(auth(staff)).send({ requiresDeposit: true }).expect(200);
    const late = await login(704, 'Genet');
    expect((await http.post('/api/me/promo').set(auth(late)).send({ code: 'GIFT10' }).expect(403)).body.code).toBe('PROMO_NEEDS_DEPOSIT');

    // Preview lists Dawit (and earlier test players without a deposit), never Eleni or Fikir.
    const preview = (await http.get('/api/admin/bonus/non-depositors').set(auth(staff)).expect(200)).body;
    const names = preview.top.map((p: any) => p.name);
    expect(names).toContain('Dawit');
    expect(names).not.toContain('Eleni');
    expect(names).not.toContain('Fikir');
    expect(Number(preview.total.birr)).toBeGreaterThan(0);
    const players = await http.get('/api/admin/bonus/non-depositors').set(auth(noDeposit)).expect(403);
    expect(players.status).toBe(403);

    const eleniPlay = await play(depositor);
    const fikirPlay = await play(pending);
    await http.post('/api/admin/bonus/clear-non-depositors').set(auth(staff)).send({ expectedPlayers: preview.players + 50, reason: 'test' }).expect(409);
    const done = (await http.post('/api/admin/bonus/clear-non-depositors').set(auth(staff)).send({ expectedPlayers: preview.players, reason: 'Bonus for depositors only' }).expect(200)).body;
    expect(done).toMatchObject({ players: preview.players, total: preview.total });
    expect(await play(noDeposit)).toBe('0');
    expect(await play(depositor)).toBe(eleniPlay);
    expect(await play(pending)).toBe(fikirPlay);
    expect((await http.get('/api/admin/bonus/non-depositors').set(auth(staff)).expect(200)).body.players).toBe(0);

    const history = (await http.get('/api/me/wallet').set(auth(noDeposit)).expect(200)).body;
    expect(JSON.stringify(history)).toContain('Unused bonus removed');
    const audit = (await http.get('/api/admin/audit').set(auth(staff)).expect(200)).body;
    expect(audit.find((e: any) => e.action === 'BONUS_CLEARED_NON_DEPOSITORS')).toMatchObject({ after: { players: preview.players, reason: 'Bonus for depositors only' } });
    expect(audit.find((e: any) => e.action === 'PROMO_DEPOSIT_RULE')).toMatchObject({ targetId: 'GIFT10', after: { requiresDeposit: true } });
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });
});
