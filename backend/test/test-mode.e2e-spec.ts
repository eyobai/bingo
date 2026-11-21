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
});
