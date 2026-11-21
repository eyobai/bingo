#!/usr/bin/env bash
# Nightly database backup. Keeps the last 14 days in deploy/backups/.
# Installed by DEPLOY.md step 9 as a cron job. Run by hand any time:  bash deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p backups
file="backups/bingo-$(date +%Y-%m-%d-%H%M).sql.gz"
docker compose exec -T db pg_dump -U bingo -d bingo --no-owner | gzip > "$file"
# A backup that is suspiciously small means something went wrong.
if [ "$(stat -c%s "$file")" -lt 1000 ]; then
  echo "Backup $file is too small; check the database." >&2
  exit 1
fi
find backups -name 'bingo-*.sql.gz' -mtime +14 -delete
echo "Saved $file"
