#!/usr/bin/env bash
# Backs up everything the app stores: the database, bill photos and guest ID photos.
# Run from the repo root (or from cron, see HOSTING.md):  deploy/backup.sh
# Writes backups/misfits-YYYY-MM-DD-HHMM.tar.gz (or into BACKUP_DIR) and keeps the last KEEP_DAYS days.
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP_DAYS="${KEEP_DAYS:-30}"
OUT="${BACKUP_DIR:-$(pwd)/backups}"
STAMP="$(date +%F-%H%M)"
COMPOSE="docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml"
SERVER="$($COMPOSE ps -q server)"
[ -n "$SERVER" ] || { echo "The server container isn't running" >&2; exit 1; }
mkdir -p "$OUT"

# A consistent copy of the live database (safe while the app is running).
$COMPOSE exec -T server node -e '
  const Database = require("better-sqlite3");
  new Database(process.env.DB_PATH, { readonly: true })
    .backup("/app/data/backup-snapshot.sqlite")
    .then(() => console.log("database copied"))
    .catch((e) => { console.error(e.message); process.exit(1); });'

# Pack the copy with the photo folders, straight from the data volume.
docker run --rm --volumes-from "$SERVER" -v "$OUT:/out" alpine:3.20 sh -c "
  cd /app/data &&
  tar czf /out/misfits-$STAMP.tar.gz backup-snapshot.sqlite \$(ls -d receipts guest-ids 2>/dev/null) &&
  rm -f backup-snapshot.sqlite"

find "$OUT" -name 'misfits-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup written: $OUT/misfits-$STAMP.tar.gz ($(du -h "$OUT/misfits-$STAMP.tar.gz" | cut -f1))"
