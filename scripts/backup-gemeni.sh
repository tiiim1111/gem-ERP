#!/usr/bin/env bash
# GEM-ENI on-premise backup — Postgres dump + MinIO file mirror.
#
#   ./scripts/backup-gemeni.sh [destination-dir]
#
# Default destination: /var/backups/gemeni
# Keeps the last KEEP_DAYS days (default 30). Run it from the repo directory,
# or set REPO_DIR. Safe to run while the stack is live.
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DEST="${1:-/var/backups/gemeni}"
KEEP_DAYS="${KEEP_DAYS:-30}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.prod}"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Set ENV_FILE=/path/to/.env.prod" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

mkdir -p "$DEST"

echo "[1/3] Postgres dump..."
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-gemerp}" -d "${POSTGRES_DB:-gemerp}" --format=custom \
  > "$DEST/gemeni-db-$STAMP.dump"
echo "      $DEST/gemeni-db-$STAMP.dump ($(du -h "$DEST/gemeni-db-$STAMP.dump" | cut -f1))"

echo "[2/3] MinIO files (attachments + exports)..."
FILES_DIR="$DEST/files-$STAMP"
mkdir -p "$FILES_DIR"
# `name: gemeni` in docker-compose.prod.yml makes the network name predictable.
NETWORK="${COMPOSE_NETWORK:-gemeni_default}"
docker run --rm \
  --network "$NETWORK" \
  -v "$FILES_DIR:/backup" \
  --entrypoint /bin/sh quay.io/minio/mc:latest -c "
    mc alias set src http://minio:9000 '${S3_ACCESS_KEY}' '${S3_SECRET_KEY}' >/dev/null &&
    mc mirror --overwrite src/${S3_BUCKET:-gemerp-attachments} /backup >/dev/null &&
    echo '      mirrored'" \
  || echo "      WARNING: MinIO mirror failed (the database dump is still good)"
echo "      $FILES_DIR ($(du -sh "$FILES_DIR" | cut -f1))"

echo "[3/3] Pruning backups older than $KEEP_DAYS days..."
find "$DEST" -maxdepth 1 -name 'gemeni-db-*.dump' -mtime "+$KEEP_DAYS" -delete
find "$DEST" -maxdepth 1 -type d -name 'files-*' -mtime "+$KEEP_DAYS" -exec rm -rf {} +

echo "Backup complete: $DEST"
