# Bingo

Live 75-ball bingo played inside Telegram: a bot for sign-up, deposits and staff approvals, and a
Telegram Mini App for the game. Players pick up to 4 numbered cards during a countdown, balls are called
every few seconds, and the first card to complete a row, column or diagonal wins the pot (stakes minus the
house share). Cards that finish on the same ball share it.

```
backend/   NestJS + PostgreSQL (Prisma) + socket.io + grammY bot
miniapp/   React + Vite + Tailwind, opened from the bot's "Play" button
```

## Run locally

Needs Node.js 22 and PostgreSQL 16. The easiest way to get the database is Docker:

```bash
docker compose up -d            # PostgreSQL on localhost:55432 (user postgres, password postgres, db bingo)
```

```bash
cd backend
cp .env.example .env            # set JWT_SECRET, DEV_LOGIN=true, ADMIN_TELEGRAM_IDS=1
npm install                     # also generates the database client (prisma generate)
npx prisma migrate deploy
npm run start:dev               # API on http://localhost:3000/api
```

```bash
cd miniapp
cp .env.example .env
npm install
npm run dev                     # http://localhost:5173 (proxies /api and /socket.io to :3000)
```

Outside Telegram the app shows a developer sign-in (only when `DEV_LOGIN=true` on the server and
`VITE_DEV_LOGIN=true` in the app). Each Telegram id is a separate player; ids listed in
`ADMIN_TELEGRAM_IDS` are staff.

### Sample players (local testing only)

A round needs at least 2 players. To play alone on your computer, start sample players in another terminal:

```bash
cd backend
npm run sim:players                          # 10 players, up to 4 cards each round
npm run sim:players -- --players 25 --max 2
```

They are named "Test 1", "Test 2"…, get test deposits approved automatically, and pick cards at random in
every round until you press Ctrl+C. The script signs in through the developer sign-in, which the server
refuses unless `DEV_LOGIN=true` (and that is refused in production), so it cannot add players to a real
game. It needs `ADMIN_TELEGRAM_IDS` to include 1 and `TELEBIRR_ACCOUNT`/`TELEBIRR_NAME` to be set.

Tests:

```bash
cd backend
npm test                        # game rules, sign-in check, SMS parsing
npm run test:e2e                # full rounds against a real database (bingo_test; wiped on each run)
```

`test:e2e` uses `TEST_DATABASE_URL` (default `postgresql://postgres@localhost:5433/bingo_test?host=/tmp`) and
refuses to run against a database whose name does not end in `_test`.

## Test inside Telegram from your computer

The bot uses long polling, so it works from your computer with no public address. The game screen is
different: Telegram only opens `https` addresses, so you expose the local dev server with a free tunnel.

1. Create a test bot with [@BotFather](https://t.me/BotFather) and get your Telegram user id from
   [@userinfobot](https://t.me/userinfobot).
2. Start the tunnel (keep it running):
   ```bash
   cloudflared tunnel --url http://localhost:5173
   ```
   It prints an address like `https://something-words.trycloudflare.com`. (`ngrok http 5173` works too.)
3. In `backend/.env` set:
   ```
   BOT_TOKEN=<token from BotFather>
   BOT_USERNAME=<bot username without @>
   MINIAPP_URL=https://something-words.trycloudflare.com
   ADMIN_TELEGRAM_IDS=<your Telegram user id>
   TELEBIRR_ACCOUNT=<any number, for testing>
   TELEBIRR_NAME=<the name that appears in the SMS>
   ```
   and restart the backend. The log shows `Bot @yourbot is running`.
4. Open your bot in Telegram, send `/start`, tap **Play now**. The game opens inside Telegram and signs you
   in automatically.
5. To test a full round you need 2 players: ask a friend to `/start` the bot, or join from the browser with
   the developer sign-in (http://localhost:5173, any id other than yours).

The tunnel address changes every time you restart `cloudflared`; update `MINIAPP_URL` and restart the
backend when it does.

## Going live with Telegram

1. Create the bot with [@BotFather](https://t.me/BotFather) (`/newbot`). Put the token in `BOT_TOKEN` and the
   username in `BOT_USERNAME`.
2. Build the Mini App (`npm run build` in `miniapp/`, with `VITE_API_URL` set to the backend's public
   address and `VITE_DEV_LOGIN=false`) and host `miniapp/dist` on any https site. Put that address in
   `MINIAPP_URL`. The bot sets it as its menu button on start.
3. Run the backend somewhere it stays up (a VPS, Railway, Render…) with `NODE_ENV=production`. It uses long
   polling, so it needs no public webhook. Run **one** instance: the round timers live in the process.
4. Put your Telegram user id in `ADMIN_TELEGRAM_IDS`, restart, and send `/start` to the bot. You will now get
   every deposit and withdrawal with Approve / Reject buttons.
5. Set `TELEBIRR_ACCOUNT` / `TELEBIRR_NAME` (and CBE Birr if used) to the account players pay into.

## How money moves

All money is whole santim (`BIGINT`), never floating point. Every movement is a ledger transaction whose
lines sum to zero, and the database refuses a negative player balance. `GET /api/admin/summary` shows
`ledgerCheck`, which must always be `0`.

| Account | What it holds |
| --- | --- |
| Main wallet | Deposits and winnings. Withdrawable. |
| Play wallet | Bonuses (first deposit, invites, welcome). Buys cards, cannot be withdrawn. Spent first. |
| Withdrawal hold | Money waiting for staff to pay out. |
| Game pot | Stakes of rounds in progress. |
| House revenue | The house share of finished rounds. |
| Promotions | What bonuses and guaranteed-prize top-ups cost (goes negative). |
| Payment clearing | Money in/out through Telebirr and CBE Birr (goes negative as deposits arrive). |

**Deposits.** The player sends money to your account and pastes the confirmation SMS (in the bot after
`/deposit`, or in the app's Wallet tab). The server reads the amount, transaction number and receiver name,
refuses an SMS sent to someone else, and refuses a transaction number used before. The deposit waits as
*pending* until staff check the money arrived and tap **Approve**. The first approved deposit adds the
first-deposit bonus, and pays the invite reward to whoever invited the player.

**Withdrawals.** The amount leaves the main wallet at once (held). Staff send the money, then tap **Paid**;
or tap **Reject** and it returns to the wallet. One pending withdrawal per player.

## The game

- Rooms are rows in the `rooms` table (stake, card pool, countdown, ball speed, house share, minimum cards,
  guaranteed prize). Staff change them with `PATCH /api/admin/rooms/:id`; changes apply from the next round.
- A round with fewer than `minCards` cards, or fewer than 2 players, is cancelled and every card refunded.
- **Guaranteed prize.** If a room has one, the prize never goes below it: the house first gives up its share,
  then tops up from promotions. This is the honest way to make early rounds attractive: real players, real
  prize, paid for out of the marketing budget.
- **Fair draw.** Before any card is sold the server picks a secret and shows its SHA-256 (`seedHash`). The
  ball order is derived from that secret, so it cannot change after cards are bought. When the round ends,
  `GET /api/rounds/:number/fairness` publishes the secret so anyone can check it.
- Winners are found by the server after every ball, for every card, so nobody loses a win by not tapping in
  time. *Manual* mode in the app only changes who marks the card.

## API (all under `/api`)

| Method | Path | Who |
| --- | --- | --- |
| POST | `/auth/telegram` `{ initData }` | Mini App sign-in |
| POST | `/auth/dev` | Development only |
| GET | `/me`, `/me/wallet`, `/me/games` | Player |
| POST | `/me/language` | Player |
| GET | `/rooms`, `/rooms/:id/state`, `/cards?pool=N`, `/rounds/:n/fairness` | Public |
| GET | `/rooms/:id/my-cards` | Player |
| POST / DELETE | `/rooms/:id/cards`, `/rooms/:id/cards/:no` | Player (buy / give back) |
| GET / POST | `/payments/options`, `/payments/deposits`, `/payments/withdrawals` | Player |
| GET | `/admin/summary`, `/admin/deposits`, `/admin/withdrawals`, `/admin/rooms`, `/admin/rounds` | Staff |
| POST | `/admin/deposits/:id/approve` \| `reject`, `/admin/withdrawals/:id/paid` \| `reject` | Staff |
| PATCH | `/admin/rooms/:id` | Staff |

Live updates: socket.io at `/socket.io`. Connect with `auth: { token }`, emit `join { roomId }`, receive
`state` (room, round, taken cards, calls, result) and `wallet` (your balances).

## Not built yet

- Staff web dashboard (today: bot buttons + the admin API).
- Automatic deposit check against the Telebirr receipt page instead of manual approval.
- Daily play streak, weekly cashback and loyalty levels.
- More than one room in the app (the backend supports many; the app opens `r10`).

## Before taking real money

Real-money gaming in Ethiopia needs a licence from the national lottery regulator. Get legal advice and
the licence first, and keep at least `owedToPlayers` (from `/api/admin/summary`) in your payment accounts
at all times.
