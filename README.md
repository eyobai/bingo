# Bingo

Live 75-ball bingo played inside Telegram: a bot for sign-up, deposits and staff approvals, and a
Telegram Mini App for the game. Players pick up to 4 numbered cards during a countdown, balls are called
every few seconds, and the first card to complete a row, column or diagonal wins the pot (stakes minus the
house share). Cards that finish on the same ball share it.

```
backend/   NestJS + PostgreSQL (Prisma) + socket.io + grammY bot
miniapp/   React + Vite + Tailwind, opened from the bot's "Play" button
admin/     React + Vite + Tailwind staff dashboard, served at /admin/
```

## Shortcuts from the top folder

From the `bingo` folder itself:

| Command | Does |
| --- | --- |
| `npm run install:all` | Installs backend, game screen and dashboard |
| `npm run build` | Builds the game screen and the dashboard |
| `npm start` | Starts the server (same as `npm run start:dev` in `backend`) |
| `npm test` | Runs all backend tests |

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

Tests:

```bash
cd backend
npm test                        # game rules, sign-in check, SMS parsing
npm run test:e2e                # full rounds against a real database (bingo_test; wiped on each run)
```

`test:e2e` uses `TEST_DATABASE_URL` (default `postgresql://postgres@localhost:5433/bingo_test?host=/tmp`) and
refuses to run against a database whose name does not end in `_test`.

## Run the bot from your own computer

The server can run on your computer and serve players through Telegram. The bot connects out to Telegram
(long polling), so it needs no public address. The game screen needs an `https` address, which a free tunnel
gives your computer. The server delivers the game screen itself, so there is one program and one tunnel.

1. Create the bot with [@BotFather](https://t.me/BotFather) and get your Telegram user id from
   [@userinfobot](https://t.me/userinfobot).
2. Build the game screen once (and again after every update):
   ```bash
   cd miniapp
   npm run build
   ```
3. Start a tunnel to the server's port and keep it running:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   It prints an address like `https://something-words.trycloudflare.com`.
   (Windows: `winget install --id Cloudflare.cloudflared`. `ngrok http 3000` works too.)
4. In `backend/.env` set:
   ```
   BOT_TOKEN=<token from BotFather>
   BOT_USERNAME=<bot username without @>
   MINIAPP_URL=https://something-words.trycloudflare.com
   ADMIN_TELEGRAM_IDS=<your Telegram user id>
   ```
5. Start the server (`npm run start:dev` in `backend`). The log shows `Serving the Mini App` and
   `Bot @yourbot is running`.
6. In Telegram send `/start` to your bot and tap **Play now**.

Players can use it while your computer, the server and the tunnel are running. A quick tunnel gets a new
address every time it starts: update `MINIAPP_URL` and restart the server when that happens. For an address
that never changes, use a free ngrok static domain or a named Cloudflare tunnel on your own domain.

## Going live

See **[DEPLOY.md](DEPLOY.md)** for running it on a DigitalOcean Droplet with your own domain, automatic https and
nightly backups.

## Going live with Telegram (other hosts)

1. Create the bot with [@BotFather](https://t.me/BotFather) (`/newbot`). Put the token in `BOT_TOKEN` and the
   username in `BOT_USERNAME`.
2. Build the Mini App (`npm run build` in `miniapp/`, with `VITE_API_URL` set to the backend's public
   address and `VITE_DEV_LOGIN=false`) and host `miniapp/dist` on any https site. Put that address in
   `MINIAPP_URL`. The 🎮 menu-keyboard button and the Play now buttons open it; the button next to the message
   box is Telegram's command Menu.
3. Run the backend somewhere it stays up (a VPS, Railway, Render…) with `NODE_ENV=production`. It uses long
   polling, so it needs no public webhook. Run **one** instance: the round timers live in the process.
4. Put your Telegram user id in `ADMIN_TELEGRAM_IDS`, restart, and send `/start` to the bot. You will now get
   every deposit and withdrawal with Approve / Reject buttons.
5. Set `TELEBIRR_ACCOUNT` / `TELEBIRR_NAME` (and CBE Birr if used) to the account players pay into.

## The bot

- **First /start**: choose አማርኛ, Afaan Oromoo or English (the Afaan Oromoo texts need a native speaker's review), then share the phone number with one button (only the player's own
  number is accepted). Registering gives the welcome gift (`WELCOME_BONUS_BIRR`, play wallet, once).
- **Playing needs a registered phone** (`REQUIRE_PHONE=true`, the default). Developer sign-in accounts get a
  made-up number automatically.
- **Menu keyboard** under the message box: Play, Language, Deposit, Withdraw, Balance, Invite friends, How to play.
  The same actions are in Telegram's Menu as `/play`, `/deposit`, `/withdraw`, `/balance`, `/invite`,
  `/instructions`, `/language`, `/menu`.
- **How to play** sends a "4 ways to win" picture (`backend/assets/rules-patterns.png`) and then the detailed rules.
- **Balance**: main, bonus, total, withdrawable and the minimum withdrawal.
- **Invite friends**: friends who deposited, friends still to deposit, total earned and progress toward
  `REFERRAL_MAX_FRIENDS` (default 30; after that, friends can still join but earn no reward).
- **Deposit**: choose Telebirr or CBE Birr, send money, paste the SMS.
- **Withdraw** step by step: amount → Telebirr or CBE Birr → phone number (or "use my number") → name → confirm.
- The "What can this bot do?" text and the command list are set in both languages when the server starts.
  The picture on that screen is set by hand in @BotFather (Edit Bot → Edit Description Picture).
- **Promo codes**: the 🎁 button or `/promo CODE` in the bot, or the box in the game's Wallet tab. Each player can
  use a code once; the bonus goes to the play wallet (buys cards, cannot be withdrawn) and is booked as a
  promotions cost. Limits are enforced under a row lock, so a code with 50 uses is never used 51 times.
- Staff: `/admin` (dashboard link), `/myid`, and Approve/Reject buttons on every deposit and withdrawal.

## Staff dashboard

Build it once (and again after updates): `cd admin && npm install && npm run build`. The server then serves it
at **`/admin/`** on the same address as the game (through the tunnel: `https://<tunnel>/admin/`). Staff can
also send `/admin` to the bot to get the link.

Sign-in: enter your Telegram id; the bot sends you a 6-digit code (valid 5 minutes). Only ids in
`ADMIN_TELEGRAM_IDS` (or accounts already marked staff) get a code. With the bot off, in development, the code
is written in the server window instead.

| Page | What you do there |
| --- | --- |
| Overview | Revenue, stakes, prizes, guarantee top-ups, deposits, withdrawals, players, money owed to players, books check, live room |
| Deposits | Waiting deposits with the SMS; approve (or approve a corrected amount) or reject with a reason |
| Withdrawals | Requests to pay; mark paid (with your transaction number) after sending, or reject (money returns) |
| Players | Search, balances, totals, wallet history; block/unblock; correct a balance with a reason |
| Rounds | Last 50 rounds: cards, stakes, prize, house share, top-up, winning cards |
| Messages | Promo message to every player through the bot: text, optional picture, optional "Play now" button. Send a test to yourself first; progress shows while it sends (about 20 a second). |
| Promo codes | Create codes (bonus in birr, how many players, end time, depositors only), switch them off, see who used each one |
| Game settings | Card price, house share, guaranteed prize, countdown, ball speed, cards per player, card numbers, minimum cards, on/off. Applies from the next round. |

For development with live reload: `npm run dev` in `admin/` (http://localhost:5174/admin/, proxies to :3000).

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

Set `PRACTICE_ROOM_ENABLED=true` in the backend `.env` (or `deploy/.env` on the server) and restart
the updated app to add **Practice** to the Games lobby. Signed-in players can pick free cards and
play against two labeled sample players. At least one real player must pick a card for a draw to start.
Practice rounds have no stakes or cash prizes and are excluded from paid-game history and staff
financial reports. Set the flag back to `false` and restart to hide the room.

**Automated players (off by default, per room).** Only where your licence allows house-funded automated
players competing for real cash. In **Admin → Settings**:

1. **House bankroll:** record each real bank transfer of operator cash with its bank reference
   (**Record funding**; **Record withdrawal** when you take money out). Recording updates the books; it does
   not move money. A reference can be used once. Keep this money separate from player funds.
2. **Room settings → House-funded automated players:** tick the box, set how many join each round and
   the most cards each may take (each picks 1 up to that at random; never more than a real player may hold).
   Applies from the room's next round.

How it works:

- **Disclosure before purchase.** Automated players are counted as players and always labelled
  ("7 waiting (7 🤖)" in the lobby, "12 players (7 🤖)" in the room), and the room shows a notice.
  Before a player's first card the Mini App asks them to confirm; the server refuses a purchase without that
  confirmation (`AUTOMATED_TERMS_REQUIRED`) and records it on the purchase.
- **Same stake, same pool, same chance.** When each countdown starts, each announced automated player buys 1 up to
  the room's maximum random free cards at the room's normal price, paid from the house bankroll. Every paid card is in the
  one prize pool and is checked against the same balls. Example: 50 automated + 10 real players at 10 ETB = a
  600 ETB pool; with a 20% house cut a sole real winner gets 480 ETB.
- **Prizes and refunds go back to their source.** Real winners are paid to their wallets, automated winners to
  the bankroll; a tie is split equally per winning card. A cancelled round refunds players to their wallets and
  automated stakes to the bankroll.
- **Short bankroll.** An automated player the bankroll cannot fully pay for gets fewer cards or is skipped
  (never paid from anywhere else); rounds
  show "N skipped (bankroll)" in **Admin → Rounds**.
- **Rounds run even without real players.** Automated players count toward the 2-player minimum and minimum
  cards, so a room with automated players keeps playing. A round with only automated players takes no house cut
  and no guaranteed-prize top-up: the whole pool returns to the bankroll (apart from a few santim of rounding
  when the split is uneven), so house revenue is never inflated by the house playing itself. Each such round
  still adds ledger entries (stakes in, prize back).
- **Audit trail.** Every room change (before → after, who, when) and every bankroll movement is listed at the
  bottom of **Admin → Settings**. Rounds store the announced, joined and skipped automated entries, their cards,
  stakes and prizes; the ledger has a separate posting for the automated entries of each round.

House Cash has been retired. The old `HOUSE_CASH_ROOM_ENABLED` setting no longer has any effect.
Any already funded round settles or refunds on upgrade, without taking new entries or funding.
Historical records and ledger balances are kept. **Admin → Overview** shows the remaining
operator balance and recent funding records for reconciliation. No funds are transferred automatically.

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

## Ball announcements (sound)

Each called ball is announced in Amharic ("ቢ አምስት" for B5) from 75 short MP3 clips in
`miniapp/public/sounds/am/`. Make them with Azure's Amharic male voice, or record your own; see
[miniapp/public/sounds/am/README.md](miniapp/public/sounds/am/README.md). Players can mute it with the speaker
button in the game bar. Without the clips the game is simply silent.

## Not built yet

- Automatic deposit check against the Telebirr receipt page instead of manual approval.
- Daily play streak, weekly cashback and loyalty levels.
- More than one room in the app (the backend supports many; the app opens `r10`).

## Before taking real money

Real-money gaming in Ethiopia needs a licence from the national lottery regulator. Get legal advice and
the licence first, and keep at least `owedToPlayers` (from `/api/admin/summary`) in your payment accounts
at all times.
