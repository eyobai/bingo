#!/usr/bin/env node
/**
 * LOCAL TESTING ONLY. Creates sample players and makes them pick cards every round, so you can play a
 * full round on your own computer.
 *
 * It only talks to the API through the developer sign-in (/api/auth/dev), which the server refuses
 * unless DEV_LOGIN=true, and DEV_LOGIN=true is refused when NODE_ENV=production. So this script cannot
 * add players to a real game. Sample players are named "Test 1", "Test 2", ...
 *
 *   node scripts/sim-players.mjs                      10 players, up to 4 cards each
 *   node scripts/sim-players.mjs --players 25 --max 2
 *
 * Options:
 *   --players N   how many sample players (default 10)
 *   --max N       most cards each one takes per round (default 4)
 *   --room ID     room to play in (default r10)
 *   --admin ID    Telegram id listed in ADMIN_TELEGRAM_IDS, used to approve their test deposits (default 1)
 *   --api URL     backend address (default http://localhost:3000)
 * Stop with Ctrl+C.
 */

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const API = (args.api ?? 'http://localhost:3000').replace(/\/$/, '') + '/api';
const PLAYERS = Number(args.players ?? 10);
const MAX = Number(args.max ?? 4);
const ROOM = args.room ?? 'r10';
const ADMIN_ID = Number(args.admin ?? 1);
const FIRST_ID = 900_001; // Telegram ids reserved for sample players

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

async function call(path, token, body, method) {
  const res = await fetch(API + path, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message ?? `HTTP ${res.status}`);
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function devLogin(telegramId, firstName) {
  try {
    return (await call('/auth/dev', null, { telegramId, firstName })).token;
  } catch (e) {
    if (e.status === 404) {
      console.error('The server refused the developer sign-in. Set DEV_LOGIN=true in backend/.env and restart it.');
      process.exit(1);
    }
    throw e;
  }
}

async function topUp(token, adminToken, receiverName, n) {
  const wallet = (await call('/me/wallet', token)).balances;
  const total = Number(wallet.main.minor) + Number(wallet.play.minor);
  if (total >= 10_000) return; // 100 birr or more: enough for now
  const ref = `SIM${Date.now().toString(36)}${n}`.toUpperCase().slice(0, 18);
  const sms = `Dear Test You have transferred ETB 500.00 to ${receiverName} (2519****0000) on 01/01/2026 12:00:00. Your transaction number is ${ref}.`;
  const deposit = await call('/payments/deposits', token, { method: 'TELEBIRR', smsText: sms });
  await call(`/admin/deposits/${deposit.id}/approve`, adminToken, {});
}

async function main() {
  try {
    await call('/health');
  } catch {
    console.error(`Cannot reach the backend at ${API}. Is "npm run start:dev" running?`);
    process.exit(1);
  }

  const adminToken = await devLogin(ADMIN_ID, 'Staff');
  const me = await call('/me', adminToken);
  if (me.user.role !== 'ADMIN') {
    console.error(`Telegram id ${ADMIN_ID} is not staff. Add it to ADMIN_TELEGRAM_IDS in backend/.env and restart.`);
    process.exit(1);
  }
  const options = await call('/payments/options', adminToken);
  const telebirr = options.methods.find((m) => m.method === 'TELEBIRR');
  if (!telebirr) {
    console.error('Set TELEBIRR_ACCOUNT and TELEBIRR_NAME in backend/.env so test deposits can be made.');
    process.exit(1);
  }
  const receiverName = (telebirr.accountName || 'TEST').toUpperCase();

  console.log(`Creating ${PLAYERS} sample players…`);
  const players = [];
  for (let i = 0; i < PLAYERS; i++) {
    const name = `Test ${i + 1}`;
    const token = await devLogin(FIRST_ID + i, name);
    await topUp(token, adminToken, receiverName, i);
    players.push({ name, token, n: i });
  }
  console.log(`Ready. They will pick 1–${MAX} cards in every round of room ${ROOM}. Stop with Ctrl+C.\n`);

  let lastRound = null;
  for (;;) {
    let state;
    try {
      state = await call(`/rooms/${ROOM}/state`);
    } catch (e) {
      console.error(`Room ${ROOM}: ${e.message}`);
      await sleep(3000);
      continue;
    }
    const { round } = state;
    if (round.status === 'FINISHED' && state.result && lastRound === `${round.id}:play`) {
      lastRound = `${round.id}:done`;
      const names = state.result.winners.map((w) => `${w.name} (#${w.cardNo})`).join(', ');
      console.log(`Round #${round.number} won by ${names}: ${state.result.prizePerWinner.birr} birr each.\n`);
    }
    if (round.status === 'SELECTING' && lastRound !== `${round.id}:play`) {
      const msLeft = new Date(round.selectEndsAt).getTime() - new Date(state.serverTime).getTime();
      if (msLeft > 4000) {
        lastRound = `${round.id}:play`;
        void playRound(players, state, msLeft, adminToken, receiverName);
      }
    }
    await sleep(1000);
  }
}

/** Each sample player joins at a random moment in the first two thirds of the countdown. */
async function playRound(players, state, msLeft, adminToken, receiverName) {
  const pool = state.room.cardPool;
  const max = Math.min(MAX, state.room.maxCardsPerPlayer);
  let bought = 0;
  await Promise.all(
    players.map(async (p) => {
      await sleep(rand(300, Math.max(400, (msLeft * 2) / 3)));
      const want = rand(1, max);
      for (let tries = 0, got = 0; got < want && tries < want * 4; tries++) {
        try {
          await call(`/rooms/${ROOM}/cards`, p.token, { cardNos: [rand(1, pool)] });
          got++;
          bought++;
        } catch (e) {
          if (e.code === 'INSUFFICIENT_FUNDS') {
            await topUp(p.token, adminToken, receiverName, p.n).catch(() => undefined);
          } else if (e.code !== 'CARD_TAKEN') {
            break; // round started, limit reached…
          }
        }
      }
    }),
  );
  console.log(`Round #${state.round.number}: sample players took ${bought} cards.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
