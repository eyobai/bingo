import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BotService } from '../src/bot/bot.service';
import { TEXTS, localPhone, menuActionFor } from '../src/bot/texts';
import { LedgerService } from '../src/ledger/ledger.service';
import { setupApp } from '../src/main';

/**
 * Drives the real bot handlers with fake Telegram updates. Every call the bot makes to Telegram is captured
 * instead of sent, so the conversation can be checked message by message.
 */
describe('Telegram bot (integration)', () => {
  let app: INestApplication;
  let bot: Bot;
  const db = new PrismaClient();
  const sent: { method: string; payload: any }[] = [];
  let updateId = 1;
  const PLAYER = 424242;

  const from = { id: PLAYER, is_bot: false, first_name: 'Selam', language_code: 'am' };
  const chat = { id: PLAYER, type: 'private' as const, first_name: 'Selam' };
  const text = (t: string): Update => ({ update_id: updateId++, message: { message_id: updateId, date: 0, chat, from, text: t, ...(t.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: t.split(' ')[0].length }] } : {}) } });
  const tap = (data: string): Update => ({
    update_id: updateId++,
    callback_query: { id: String(updateId), from, chat_instance: 'x', data, message: { message_id: 1, date: 0, chat, text: 'x' } as any },
  });
  const contact = (userId: number, phone: string): Update => ({
    update_id: updateId++,
    message: { message_id: updateId, date: 0, chat, from, contact: { phone_number: phone, first_name: 'Selam', user_id: userId } },
  });
  const say = async (u: Update) => {
    sent.length = 0;
    await bot.handleUpdate(u);
    return sent.filter((c) => ['sendMessage', 'editMessageText'].includes(c.method)).map((c) => c.payload.text as string);
  };
  const lastKeyboard = () => [...sent].reverse().find((c) => c.payload?.reply_markup)?.payload.reply_markup;

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

    bot = new Bot('123:TEST', { botInfo: { id: 1, is_bot: true, first_name: 'Bingo', username: 'testbingo_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as any });
    bot.api.config.use(async (_prev, method, payload) => {
      sent.push({ method, payload });
      return { ok: true, result: method === 'sendMessage' ? { message_id: 1, date: 0, chat } : true } as any;
    });
    const svc = app.get(BotService) as any;
    svc.bot = bot;
    svc.register(bot);
  });

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
  });

  it('knows menu buttons in both languages and reads Ethiopian phone numbers', () => {
    expect(menuActionFor(TEXTS.am.btnWithdraw)).toBe('withdraw');
    expect(menuActionFor(TEXTS.en.btnDeposit)).toBe('deposit');
    expect(menuActionFor('hello')).toBeNull();
    expect(localPhone('+251 911 22 33 44')).toBe('0911223344');
    expect(localPhone('0711223344')).toBe('0711223344');
    expect(localPhone('12345')).toBeNull();
  });

  it('registers a new player: language, phone, welcome gift, menu', async () => {
    let out = await say(text('/start'));
    expect(out[0]).toContain('Choose your language');

    out = await say(tap('lang:am'));
    expect(out).toContain(TEXTS.am.languageSet);
    expect(out.some((m) => m.includes('ስልክ ቁጥርዎን ያጋሩ'))).toBe(true);
    expect(lastKeyboard().keyboard[0][0].request_contact).toBe(true);

    // Playing is refused until the phone is shared.
    const user = await db.user.findUniqueOrThrow({ where: { telegramId: BigInt(PLAYER) } });
    expect(user.phone).toBeNull();
    out = await say(text(TEXTS.am.btnPlay));
    expect(out[0]).toBe(TEXTS.am.needPhone);

    // Someone else's contact card does not count.
    out = await say(contact(999, '+251911000000'));
    expect(out[0]).toBe(TEXTS.am.notYourContact);

    out = await say(contact(PLAYER, '+251911223344'));
    expect(out[0]).toContain(TEXTS.am.registered);
    expect(out[0]).toContain('20 ብር');
    const menu = lastKeyboard().keyboard.flat().map((b: any) => b.text);
    expect(menu).toEqual(expect.arrayContaining([TEXTS.am.btnPlay, TEXTS.am.btnDeposit, TEXTS.am.btnWithdraw, TEXTS.am.btnBalance]));
    expect((await db.user.findUniqueOrThrow({ where: { telegramId: BigInt(PLAYER) } })).phone).toBe('+251911223344');

    // Sharing again does not give a second gift.
    out = await say(contact(PLAYER, '+251911223344'));
    expect(out[0]).not.toContain('20 ብር');

    out = await say(text(TEXTS.am.btnBalance));
    expect(out[0]).toContain('20 ብር');
  });

  it('switches language and answers menu buttons', async () => {
    await say(text('/language'));
    let out = await say(tap('lang:en'));
    expect(out).toContain(TEXTS.en.languageSet);
    out = await say(text(TEXTS.en.btnInvite));
    expect(out[0]).toContain('https://t.me/testbingo_bot?start=ref_');
    out = await say(text(TEXTS.en.btnRules));
    expect(out[0]).toContain('How to play');
  });

  it('takes a deposit by SMS, then withdraws step by step', async () => {
    let out = await say(text(TEXTS.en.btnDeposit));
    expect(out[0]).toContain('Deposit');
    out = await say(tap('dep:TELEBIRR'));
    expect(out[0]).toContain('0911000000');
    out = await say(text('Dear Selam You have transferred ETB 300.00 to ABEBE KEBEDE (2519****0000) on 21/11/2026 10:00:00. Your transaction number is BOT0000001.'));
    expect(out[0]).toContain('300');

    // Staff approve through the API.
    const staff = (await request(app.getHttpServer()).post('/api/auth/dev').send({ telegramId: 1, firstName: 'Staff' })).body.token;
    const pending = await db.deposit.findFirstOrThrow({ where: { txRef: 'BOT0000001' } });
    await request(app.getHttpServer()).post(`/api/admin/deposits/${pending.id}/approve`).set('Authorization', `Bearer ${staff}`).send({}).expect(200);

    out = await say(text(TEXTS.en.btnWithdraw));
    expect(out[0]).toContain('300');
    out = await say(text('50'));
    expect(out[0]).toContain('between 100 and 300');
    out = await say(text('150'));
    expect(out[0]).toBe(TEXTS.en.withdrawMethod);
    out = await say(tap('wm:TELEBIRR'));
    expect(lastKeyboard().keyboard[0][0].text).toBe(TEXTS.en.useMyNumber('0911223344'));
    out = await say(text(TEXTS.en.useMyNumber('0911223344')));
    expect(out[0]).toBe(TEXTS.en.withdrawName);
    out = await say(text('Selam Bekele'));
    expect(out[0]).toContain('150');
    out = await say(tap('wc:yes'));
    expect(out.join('\n')).toContain('150');

    const w = await db.withdrawal.findFirstOrThrow({ where: { accountNumber: '0911223344' } });
    expect(w.amountMinor).toBe(15000n);
    expect(w.accountName).toBe('Selam Bekele');
    expect(await app.get(LedgerService).trialBalance()).toBe(0n);
  });

  it('sends a test broadcast to the staff member only', async () => {
    const server = app.getHttpServer();
    // Make staff id 424242 so the test send lands in this fake chat.
    await db.user.update({ where: { telegramId: BigInt(PLAYER) }, data: { role: 'ADMIN' } });
    const token = (await request(server).post('/api/auth/dev').send({ telegramId: PLAYER, firstName: 'Selam' })).body.token;
    sent.length = 0;
    const r = await request(server)
      .post('/api/admin/broadcast')
      .set('Authorization', `Bearer ${token}`)
      .send({ text: '50% bonus until 6 PM!', playButton: true, testOnly: true })
      .expect(200);
    expect(r.body).toMatchObject({ total: 1, sent: 1, test: true });
    expect(sent.find((c) => c.method === 'sendMessage')?.payload).toMatchObject({ chat_id: String(PLAYER), text: '50% bonus until 6 PM!' });
    // A picture of about 1 MB passes the size limits.
    const big = Buffer.alloc(1_000_000, 1).toString('base64');
    await request(server).post('/api/admin/broadcast').set('Authorization', `Bearer ${token}`).send({ text: 'pic', imageBase64: big, playButton: false, testOnly: true }).expect(200);
    expect(sent.some((c) => c.method === 'sendPhoto')).toBe(true);
  });
});
