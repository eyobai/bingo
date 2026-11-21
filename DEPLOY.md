# Going live on a DigitalOcean Droplet

One Droplet runs everything: the database, the game server with the Telegram bot, the game screen and the
staff dashboard. Caddy in front gets a free `https` certificate for your domain and renews it by itself.

```
Players (Telegram) ──https──> Caddy :443 ──> app :3000 (API, bot, game, /admin) ──> PostgreSQL
```

You need: a DigitalOcean account, a domain name, your bot token, about 30 minutes.

---

## 1. Buy a domain

From Namecheap, Cloudflare, Porkbun or similar (about $10–15 a year). Example: `edilbingo.com`.
You will use a subdomain for the game, e.g. **`play.edilbingo.com`**.

## 2. Create the Droplet

In DigitalOcean: **Create → Droplets**

- **Region:** Frankfurt (FRA1) or Amsterdam (AMS3)
- **Image:** Ubuntu 24.04 LTS
- **Size:** Basic, Regular, **2 GB RAM / 1 CPU** (or bigger)
- **Authentication:** **SSH key** (safer than a password). On Windows, create one in PowerShell with
  `ssh-keygen -t ed25519` and paste the contents of `C:\Users\<you>\.ssh\id_ed25519.pub`.
- **Backups:** turn on **weekly backups**.
- **Hostname:** `bingo`

Copy the Droplet's **IPv4 address**.

## 3. Point the domain at the Droplet

At your domain provider, open the DNS settings and add:

| Type | Name / Host | Value | TTL |
| --- | --- | --- | --- |
| A | `play` | the Droplet's IPv4 address | Automatic / 300 |

It can take a few minutes to an hour to work. Check from PowerShell: `nslookup play.edilbingo.com`
should show the Droplet's IP.

## 4. Log in and prepare the server

From PowerShell on your computer:

```powershell
ssh root@<droplet-ip>
```

On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/eyobai/bingo/main/deploy/setup-server.sh -o setup-server.sh
bash setup-server.sh
```

This installs Docker, turns on the firewall (only SSH and web traffic), automatic security updates and swap.
If the repository is private, the download above fails; copy the script's contents from GitHub instead,
or clone first (step 5) and run `bash bingo/deploy/setup-server.sh`.

## 5. Get the code

If the repository is **public**:

```bash
git clone https://github.com/eyobai/bingo.git
```

If it is **private**, give the server read-only access with a deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_bingo -N ""
cat ~/.ssh/github_bingo.pub
```

On GitHub: repository **Settings → Deploy keys → Add deploy key**, paste it, leave "Allow write access" off.
Then:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_bingo\n' >> ~/.ssh/config
git clone git@github.com:eyobai/bingo.git
```

## 6. Production settings

```bash
cd ~/bingo/deploy
cp .env.example .env
openssl rand -hex 24    # copy this: POSTGRES_PASSWORD
openssl rand -hex 32    # copy this: JWT_SECRET
nano .env
```

Fill in at least: `DOMAIN` (e.g. `play.edilbingo.com`, no https://), `BRAND_NAME`, `POSTGRES_PASSWORD`,
`JWT_SECRET`, `BOT_TOKEN`, `BOT_USERNAME`, `ADMIN_TELEGRAM_IDS` (your real id, **not** `1`), and the Telebirr /
CBE Birr account numbers and names. Save with Ctrl+O, Enter, exit with Ctrl+X.

`deploy/.env` holds your secrets: it is never committed, and only root on the server can read it
(`chmod 600 .env`).

**Important:** a bot can only run in one place. **Stop the server on your laptop** before starting this one,
or use a different bot for testing on the laptop. Otherwise the two fight over the bot's messages.

## 7. Start

```bash
cd ~/bingo/deploy
docker compose up -d --build
```

The first build takes 5–10 minutes. Then:

```bash
docker compose ps            # db, app and caddy should be "running"; app "healthy" after ~1 minute
docker compose logs -f app   # Ctrl+C to stop watching
```

In the app log you should see `All migrations have been successfully applied`, `Serving ... at /admin`,
`Bot @yourbot is running`.

Check in a browser: `https://play.edilbingo.com/api/health` shows `{"ok":true}` with a padlock.

## 8. Telegram

Nothing to change in BotFather: the server sets the commands, description and menu by itself. In Telegram,
close and reopen the app, send `/start` to your bot and tap **🎮 Play**.

Staff dashboard: `https://play.edilbingo.com/admin/` (sign in with your Telegram id; the code arrives in the bot).

## 9. Nightly backups

```bash
chmod +x ~/bingo/deploy/backup.sh
mkdir -p ~/bingo/deploy/backups
(crontab -l 2>/dev/null; echo "15 3 * * * /root/bingo/deploy/backup.sh >> /root/bingo/deploy/backups/backup.log 2>&1") | crontab -
bash ~/bingo/deploy/backup.sh     # run once now to check
```

Backups go to `~/bingo/deploy/backups/` and are kept 14 days. A copy on the same server does not help if the
server is lost, so also download them now and then:

```powershell
scp root@<droplet-ip>:/root/bingo/deploy/backups/*.sql.gz .
```

Restore (replaces everything in the database; stop the app first):

```bash
cd ~/bingo/deploy
docker compose stop app
docker compose exec -T db psql -U bingo -d bingo -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
gunzip -c backups/<file>.sql.gz | docker compose exec -T db psql -U bingo -d bingo
docker compose start app
```

## Sample players (before launch only)

Nothing to set up: start sample players on the server any time (Ctrl+C stops them):

```bash
cd ~/bingo/deploy
docker compose exec app node scripts/sim-players.mjs --players 10 --max 2
```

While sample players are in a round, the game shows one line to everyone: **🤖 Sample players are also
playing**. A sample player's win is marked 🤖 and is not paid to anyone: it goes into the next round's prize.
Sample players only use accounts 900001–999999, and only someone who can run commands on the server can start
them (the key comes from `JWT_SECRET`).

### Before real players: start clean

```bash
cd ~/bingo/deploy
bash backup.sh                      # keep a copy of the test data, just in case
docker compose down
docker volume rm bingo_db-data      # deletes the database: all test players, rounds and money
docker compose up -d
```

The database is created fresh on start. Your settings, the https certificate and the bot are unaffected;
staff sign in again the same way.

## Everyday commands

All from `~/bingo/deploy`:

| Task | Command |
| --- | --- |
| Update to the latest code | `git pull && docker compose up -d --build` |
| See what's running | `docker compose ps` |
| Live logs | `docker compose logs -f app` |
| Restart the app | `docker compose restart app` |
| Stop everything | `docker compose down` (data is kept) |
| Change a setting | edit `.env`, then `docker compose up -d` |

Updates apply new database changes automatically when the app starts.

## Before real money

- Get the gaming licence first.
- Use a real `JWT_SECRET` and database password (step 6), and keep `deploy/.env` private.
- Check the Afaan Oromoo and Amharic texts with native speakers.
- Keep at least the "Owed to players now" amount (dashboard Overview) in your payment accounts.
- Download a backup regularly.
