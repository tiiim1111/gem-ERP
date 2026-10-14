#!/usr/bin/env bash
# GEM-ENI on-premise update — pull, rebuild, restart, verify.
#
#   /opt/gemeni/scripts/update-gemeni.sh
#
# Safe to run any time: it stops before touching containers if the pull fails,
# and database migrations run automatically when the api container boots.
#
# Env overrides: REPO_DIR, ENV_FILE, SKIP_PULL=1 (deploy local edits as-is).
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${ENV_FILE:-$REPO_DIR/.env.prod}"
COMPOSE=(docker compose -f "$REPO_DIR/docker-compose.prod.yml" --env-file "$ENV_FILE")

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found." >&2
  exit 1
fi

cd "$REPO_DIR"

if [[ "${SKIP_PULL:-}" != "1" ]]; then
  echo "[1/4] Fetching changes..."
  BEFORE="$(git rev-parse HEAD)"
  git pull --ff-only
  AFTER="$(git rev-parse HEAD)"
  if [[ "$BEFORE" == "$AFTER" ]]; then
    echo "      Already up to date — rebuilding anyway to pick up any local edits."
  else
    echo "      Deploying:"
    git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/        /'
  fi
else
  echo "[1/4] Skipping pull (SKIP_PULL=1)."
fi

echo "[2/4] Building and starting (first build takes a few minutes)..."
"${COMPOSE[@]}" up -d --build

echo "[3/4] Waiting for the app to answer..."
# The proxy is the only public entrance, so that is what gets checked.
for attempt in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T proxy wget -q --spider http://127.0.0.1/login 2>/dev/null; then
    echo "      Up after ${attempt} check(s)."
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "      STILL DOWN after 3 minutes. Check: ${COMPOSE[*]} logs web --tail 40" >&2
    "${COMPOSE[@]}" ps
    exit 1
  fi
  sleep 3
done

echo "[4/4] Status"
"${COMPOSE[@]}" ps --format "table {{.Service}}\t{{.Status}}"

ORIGIN="$(grep -E '^WEB_ORIGIN=' "$ENV_FILE" | head -1 | cut -d= -f2- | cut -d, -f1)"
echo
echo "Update complete. Open ${ORIGIN:-the app} and hard-refresh (Ctrl+Shift+R)."
