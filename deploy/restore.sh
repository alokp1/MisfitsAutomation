#!/usr/bin/env bash
# Restores a backup made by deploy/backup.sh, replacing the current data.
# Run from the repo root:  deploy/restore.sh backups/misfits-2026-10-17-0300.tar.gz
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?usage: deploy/restore.sh <backup .tar.gz>}"
[ -f "$FILE" ] || { echo "No such file: $FILE" >&2; exit 1; }
COMPOSE="docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml"
DIR="$(cd "$(dirname "$FILE")" && pwd)"
NAME="$(basename "$FILE")"

read -r -p "This replaces ALL current bookings, expenses and photos with $NAME. Type RESTORE to continue: " ok
[ "$ok" = RESTORE ] || { echo "Cancelled."; exit 1; }

SERVER="$($COMPOSE ps -aq server)"
[ -n "$SERVER" ] || { echo "Start the stack once first so the data volume exists" >&2; exit 1; }
$COMPOSE stop server

# Swap in the backup; the app user inside the container (uid of "app") must own the files.
docker run --rm --volumes-from "$SERVER" -v "$DIR:/in:ro" alpine:3.20 sh -c "
  set -e
  owner=\$(stat -c %u:%g /app/data)
  cd /app/data
  rm -rf data.sqlite data.sqlite-wal data.sqlite-shm receipts guest-ids
  tar xzf /in/$NAME
  mv backup-snapshot.sqlite data.sqlite
  chown -R \$owner /app/data"

$COMPOSE start server
echo "Restored $NAME."
