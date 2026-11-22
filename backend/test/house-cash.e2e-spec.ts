import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AccountType, PrismaClient, TxType } from '@prisma/client';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { AppModule, loadConfig } from '../src/app.module';
import { completeLines, generateCardSet } from '../src/bingo/cards';
import { ballOrder, hashSeed } from '../src/bingo/fair';
import { GameService, HOUSE_CASH_ROOM_ID } from '../src/bingo/game.service';
import { APP_CONFIG } from '../src/config/config';
import { LedgerService } from '../src/ledger/ledger.service';
import { setupApp } from '../src/main';

describe('House Cash (integration)', () => {
  const db = new PrismaClient();
  const config = loadConfig();
  const route = `/api/rooms/${HOUSE_CASH_ROOM_ID}`;
  const bankRoute = '/api/admin/house-bankroll';
  const houseCards = [99, 100];
  let app: INestApplication | undefined;
  let game: GameService;
  let http: ReturnType<typeof request>;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const login = async (telegramId: number, firstName: string) =>
    (await http.post('/api/auth/dev').send({ telegramId, firstName }).expect(200)).body;
  const state = async () => (await http.get(`${route}/state`).expect(200)).body;
  const buy = (token: string, cardNo: number, acceptHousePlayers = true) =>
    http.post(`${route}/cards`).set(auth(token)).send({ cardNos: [cardNo], acceptHousePlayers });
  const fund = (token: string, amountBirr: string, bankReference: string) =>
    http.post(`${bankRoute}/funding`).set(auth(token)).send({ amountBirr, bankReference });
  const systemBalance = (type: AccountType) => app!.get(LedgerService).systemBalance(type);
  const wallet = async (token: string) => (await http.get('/api/me/wallet').set(auth(token)).expect(200)).body.balances;

  async function start(enabled = true) {
    await app?.close();
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...config, houseCashRoomEnabled: enabled, money: { ...config.money, welcomeBonusMinor: 0n } })
      .compile();
    app = module.createNestApplication();
    setupApp(app);
    await app.init();
    game = app.get(GameService);
    http = request(app.getHttpServer());
  }

  async function creditWallet(userId: string, amount: bigint) {
    const ledger = app!.get(LedgerService);
    await ledger.withTx(async (tx) => {
      const clearing = await ledger.systemAccount(AccountType.PAYMENT_CLEARING, tx);
      const { main } = await ledger.userAccounts(userId, tx);
      await ledger.post({
        type: TxType.DEPOSIT, description: 'Integration test deposit',
        lines: [{ accountId: clearing.id, amountMinor: -amount }, { accountId: main.id, amountMinor: amount }],
      }, tx);
    });
  }

  async function closeSelection() {
    const live = game['live'].get(HOUSE_CASH_ROOM_ID)!;
    clearTimeout(live.timer);
    await game['closeSelection'](live);
    clearTimeout(live.timer);
    return live;
  }

  function winnerFixture(winner: 'human' | 'house' | 'tie', roundNumber: number) {
    const layouts = generateCardSet(100, config.cardSetSeed);
    const whenWon = (order: number[], cardNo: number) => {
      const called = new Set<number>();
      return order.findIndex((n) => {
        called.add(n);
        return completeLines(layouts[cardNo - 1], called).length > 0;
      });
    };
    for (let i = 0; i < 100; i++) {
      const seed = i.toString(16).padStart(64, '0');
      const order = ballOrder(seed, roundNumber);
      const houseWins = houseCards.map((card) => whenWon(order, card));
      if (houseWins[0] === houseWins[1]) continue;
      const house = Math.min(...houseWins);
      for (let card = 1; card < houseCards[0]; card++) {
        const human = whenWon(order, card);
        if (winner === 'tie' ? human === house : winner === 'human' ? human < house : human > house) {
          return { seed, order, card, winningHouseCard: houseCards[houseWins.indexOf(house)] };
        }
      }
    }
    throw new Error(`No ${winner} winner fixture`);
  }

  beforeAll(async () => {
    const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
    if (!dbName.endsWith('_test')) throw new Error(`Refusing to wipe "${dbName}": test database names must end in _test`);
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await db.$executeRawUnsafe('CREATE SCHEMA public');
    execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });
  });

  beforeEach(async () => {
    await db.$executeRaw`TRUNCATE rooms, users, ledger_accounts, ledger_transactions RESTART IDENTITY CASCADE`;
    await db.room.createMany({ data: [
      { id: 'classic', name: 'Classic', stakeMinor: 1000n, cardPool: 100 },
      { id: HOUSE_CASH_ROOM_ID, name: 'House Cash', stakeMinor: 1000n, cardPool: 100 },
    ] });
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });
  afterAll(() => db.$disconnect());

  it('hides the room when disabled and does not accept funding', async () => {
    await start(false);
    await http.get(`${route}/state`).expect(404);
    const staff = await login(1, 'Staff');
    await fund(staff.token, '20', 'BANK-001').expect(409);
    const { rooms } = (await http.get('/api/rooms').expect(200)).body;
    expect(rooms).toMatchObject([{ id: 'classic', houseCash: false, samplePlayers: 0, round: { needPlayers: 2 } }]);
  });

  it('requires staff funding and explicit acknowledgment, debits house stakes once, and refunds both sources on cancellation', async () => {
    await start();
    const staff = await login(1, 'Staff');
    const player = await login(10, 'Player');
    const second = await login(11, 'Second');
    await creditWallet(player.user.id, 5000n);
    await creditWallet(second.user.id, 1000n);
    expect((await state()).room).toMatchObject({ houseCash: true, entriesPaused: true, houseCards, stake: { birr: '10' } });
    expect((await db.room.findUniqueOrThrow({ where: { id: HOUSE_CASH_ROOM_ID } })).isActive).toBe(false);
    await fund(player.token, '20', 'BANK-001').expect(403);
    await fund(staff.token, '0', 'BANK-001').expect(400);
    await fund(staff.token, '19', 'BANK-001').expect(200);
    expect((await buy(player.token, 1).expect(409)).body.code).toBe('HOUSE_ROOM_PAUSED');
    expect(await db.card.count()).toBe(0);
    expect(await systemBalance(AccountType.GAME_POT)).toBe(0n);
    expect((await wallet(player.token)).main.minor).toBe('5000');
    expect((await buy(player.token, 1, false).expect(400)).body.code).toBe('HOUSE_TERMS_REQUIRED');
    await fund(staff.token, '1', 'bank-002').expect(200);
    const duplicate = await fund(staff.token, '1', 'BANK-002').expect(200);
    expect(duplicate.body.balance.minor).toBe('2000');
    await fund(staff.token, '2', 'BANK-002').expect(409);
    expect((await state()).room.entriesPaused).toBe(false);
    await http.patch(`/api/admin/rooms/${HOUSE_CASH_ROOM_ID}`).set(auth(staff.token)).send({ stakeBirr: 20 }).expect(404);
    await buy(player.token, houseCards[0]).expect(409);
    await Promise.all([buy(player.token, 1).expect(200), buy(second.token, 2).expect(200)]);
    const open = await state();
    expect(open.round).toMatchObject({ cardsSold: 4, players: 2, taken: [1, 2, ...houseCards] });
    expect(open.round.prize.minor).toBe('3200');
    expect(await systemBalance(AccountType.HOUSE_BANKROLL)).toBe(0n);
    expect(await systemBalance(AccountType.GAME_POT)).toBe(4000n);
    await http.delete(`${route}/cards/1`).set(auth(player.token)).expect(200);
    await http.delete(`${route}/cards/2`).set(auth(second.token)).expect(200);
    const live = await closeSelection();
    expect(live.round.status).toBe('CANCELLED');
    expect(await systemBalance(AccountType.HOUSE_BANKROLL)).toBe(2000n);
    expect(await systemBalance(AccountType.GAME_POT)).toBe(0n);
    expect((await wallet(player.token)).main.minor).toBe('5000');
    expect((await wallet(second.token)).main.minor).toBe('1000');
    expect(await app!.get(LedgerService).trialBalance()).toBe(0n);
  });

  it.each(['human', 'house', 'tie'] as const)('settles a %s result after resume with the original cards and draw', async (winner) => {
    await db.room.update({ where: { id: HOUSE_CASH_ROOM_ID }, data: { houseCutBps: 2000 } });
    const round = await db.round.create({ data: {
      roomId: HOUSE_CASH_ROOM_ID, stakeMinor: 1000n, houseCutBps: 2000, serverSeed: '', seedHash: '',
      selectEndsAt: new Date(Date.now() + 60_000),
    } });
    const fixture = winnerFixture(winner, round.number);
    await db.round.update({ where: { id: round.id }, data: { serverSeed: fixture.seed, seedHash: hashSeed(fixture.seed) } });
    await start();
    const staff = await login(1, 'Staff');
    const player = await login(10, 'Player');
    await creditWallet(player.user.id, 1000n);
    await fund(staff.token, '20', 'BANK-001').expect(200);
    await buy(player.token, fixture.card).expect(200);
    expect((await state()).round.serverSeed).toBeNull();
    // Turning off entry must not abandon money in a funded round.
    await start(false);
    expect((await state()).room.entriesPaused).toBe(true);
    await buy(player.token, fixture.card + 1).expect(409);
    let live = await closeSelection();
    expect(live.round.status).toBe('DRAWING');
    if (winner === 'tie') {
      await game['drawNext'](live);
      await start(false);
      live = game['live'].get(HOUSE_CASH_ROOM_ID)!;
      clearTimeout(live.timer);
      expect(live.round.calls).toEqual(fixture.order.slice(0, 1));
    }
    for (let i = 0; i < 75 && live.round.status === 'DRAWING'; i++) {
      await game['drawNext'](live);
      clearTimeout(live.timer);
    }
    const done = await state();
    const prize = winner === 'tie' ? 1200n : 2400n;
    const humanPrize = winner === 'house' ? 0n : prize;
    const housePrize = winner === 'human' ? 0n : prize;
    expect(done.round).toMatchObject({ status: 'FINISHED', seedHash: hashSeed(fixture.seed), serverSeed: fixture.seed });
    expect(done.round.calls).toEqual(fixture.order.slice(0, done.round.calls.length));
    expect(done.result.winners.map((w: { cardNo: number; sampleNo?: number }) => [w.cardNo, w.sampleNo])).toEqual([
      ...(humanPrize ? [[fixture.card, undefined]] : []),
      ...(housePrize ? [[fixture.winningHouseCard, fixture.winningHouseCard - 98]] : []),
    ]);
    const stored = await db.round.findUniqueOrThrow({ where: { id: round.id }, include: { winners: true } });
    expect(stored).toMatchObject({ houseCards, houseStakeMinor: 2000n, housePrizeMinor: housePrize, houseWinningCards: housePrize ? [fixture.winningHouseCard] : [] });
    expect(stored.winners.map((w) => w.prizeMinor)).toEqual(humanPrize ? [humanPrize] : []);
    expect(await systemBalance(AccountType.HOUSE_BANKROLL)).toBe(housePrize);
    expect(await systemBalance(AccountType.GAME_POT)).toBe(0n);
    expect((await wallet(player.token)).main.minor).toBe(humanPrize.toString());
    expect(await db.user.count()).toBe(2);
    const summary = (await http.get('/api/admin/summary').set(auth(staff.token)).expect(200)).body;
    expect(summary).toMatchObject({ housePlayerStakes: { minor: '2000' }, housePlayerPrizes: { minor: housePrize.toString() }, ledgerCheck: { minor: '0' } });
    await game['openRound'](live.room);
    await http.get(`${route}/state`).expect(404);
  });
});
