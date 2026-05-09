#!/bin/bash
#
# /srv/run-deploy-payroll.sh — production deploy script for evergreen
#
# Mirror of new-hotel's /srv/run-deploy.sh, scoped to the payroll stack.
# Install at /srv/run-deploy-payroll.sh, owned root:root, mode 755.
# Triggered via SSH forced-command in /home/deploy/.ssh/authorized_keys —
# the workflow runs `ssh deploy@evergreen.thehfhotel.org < payload.json` and
# the matching key entry pins this script as the only thing that key can do.
#
# Reads JSON from stdin:
# {
#   "commit_sha": "abc123...",
#   "deploy_payload_b64": "<base64 tarball: docker-compose.yml>",
#   "ghcr": { "user": "...", "token": "..." },
#   "env": { "KBIZ_USERNAME": "...", "KBIZ_PASSWORD": "...", "SLACK_WEBHOOK_URL": "..." }
# }
#
# Logs to /var/log/deploy/deploy-payroll-<timestamp>.log.

set -euo pipefail

DEPLOY_DIR=/home/deploy/payroll-production
LOG_DIR=/var/log/deploy
LOCK_FILE="$LOG_DIR/.run-deploy-payroll.lock"

mkdir -p "$LOG_DIR" "$DEPLOY_DIR"
LOG_FILE="$LOG_DIR/deploy-payroll-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

# Mutex so two concurrent deploys can't interleave on $DEPLOY_DIR + compose state.
# Distinct lock from new-hotel — payroll and new-hotel deploys are independent.
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "::error::another payroll deploy is already running (lock: $LOCK_FILE)"; exit 1; }

echo "[deploy] start $(date -Iseconds) caller=${SSH_CONNECTION:-?}"

# --- read + validate JSON payload -------------------------------------------
# Cap at 4 MB. payroll's deploy payload is just docker-compose.yml (~1 KB).
MAX_BYTES=$((4 * 1024 * 1024))
PAYLOAD=$(head -c $((MAX_BYTES + 1)))
if [ "${#PAYLOAD}" -gt "$MAX_BYTES" ]; then
  echo "::error::payload exceeds ${MAX_BYTES} bytes — refusing"
  exit 1
fi

echo "$PAYLOAD" | jq -e 'has("commit_sha") and has("deploy_payload_b64") and has("ghcr") and has("env")' >/dev/null \
  || { echo "::error::malformed payload (missing fields)"; exit 1; }

COMMIT_SHA=$(echo "$PAYLOAD" | jq -r '.commit_sha')
echo "[deploy] commit: $COMMIT_SHA"

# --- ghcr.io login ----------------------------------------------------------
GHCR_USER=$(echo "$PAYLOAD" | jq -r '.ghcr.user')
GHCR_TOKEN=$(echo "$PAYLOAD" | jq -r '.ghcr.token')
[[ -n "$GHCR_USER" && -n "$GHCR_TOKEN" ]] \
  || { echo "::error::missing ghcr.user / ghcr.token in payload"; exit 1; }
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null \
  || { echo "::error::docker login ghcr.io failed"; exit 1; }
echo "[deploy] ghcr authenticated as $GHCR_USER"

# --- extract deploy artifacts -----------------------------------------------
echo "$PAYLOAD" | jq -r '.deploy_payload_b64' | base64 -d | tar -xz -C "$DEPLOY_DIR"
[[ -f "$DEPLOY_DIR/docker-compose.yml" ]] \
  || { echo "::error::tar extract incomplete (no docker-compose.yml)"; exit 1; }

cd "$DEPLOY_DIR"

# --- materialize .env from payload ------------------------------------------
# Subshell-scoped umask so .env is born 600. jq's @sh applies shell-safe
# single-quote escaping (handles passwords with special chars).
( umask 077 && echo "$PAYLOAD" | jq -r '.env | to_entries[] | "\(.key)=\(.value | @sh)"' > .env )
# PAYROLL_PORT isn't a secret; pin it here so the deploy is self-contained.
echo "PAYROLL_PORT=3002" >> .env
chmod 600 .env

# Required-env validation. SLACK_WEBHOOK_URL is intentionally optional —
# src/slack.ts treats an empty webhook as "no-op" rather than failing.
required=(KBIZ_USERNAME KBIZ_PASSWORD)
for var in "${required[@]}"; do
  grep -q "^${var}='..*'$" .env \
    || { echo "::error::env var $var missing or empty"; exit 1; }
done
echo "[deploy] artifacts staged at $DEPLOY_DIR, .env mode $(stat -c '%a' .env)"

# --- helpers ----------------------------------------------------------------

wait_healthy() {
  local container=$1
  local timeout=${2:-60}
  local elapsed=0 health
  while [ $elapsed -lt $timeout ]; do
    health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || echo "not_found")
    case "$health" in
      healthy|running) return 0 ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
  done
  echo "::error::$container unhealthy after ${timeout}s (last state: ${health:-unknown})"
  docker logs "$container" --tail 50 2>&1 || true
  return 1
}

# Mirrors new-hotel's helper — snap-docker on this host periodically returns
# ENETUNREACH on outbound TCP during container churn. Wrap registry ops.
retry_compose() {
  local attempt sleep_s
  for attempt in 1 2 3 4 5; do
    if docker compose "$@"; then
      return 0
    fi
    sleep_s=$((attempt * 5))
    echo "::warning::compose $* attempt $attempt failed, retrying in ${sleep_s}s"
    sleep $sleep_s
  done
  echo "::error::compose $* failed after 5 attempts"
  return 1
}

# --- deploy -----------------------------------------------------------------

retry_compose pull
docker compose up -d --remove-orphans

wait_healthy payroll-form 60
wait_healthy kbiz-bot 30

# HTTP health check (PAYROLL_PORT is bound on the host).
for i in $(seq 1 15); do
  if curl -fsS --max-time 3 http://localhost:3002/health >/dev/null; then
    echo "[deploy] payroll /health OK after ${i} attempt(s)"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "::error::payroll /health failed after 15 attempts"
    docker logs payroll-form --tail 50 || true
    exit 1
  fi
  sleep 2
done

echo "[deploy] complete"
docker compose ps

# --- post-deploy worker status ----------------------------------------------
KBIZ_STATUS=$(docker inspect --format='{{.State.Status}}' kbiz-bot 2>/dev/null || echo "not_found")
case "$KBIZ_STATUS" in
  running) echo "[deploy] kbiz-bot running" ;;
  *) echo "::warning::kbiz-bot in unexpected state: $KBIZ_STATUS"
     docker logs kbiz-bot --tail 50 2>&1 || true ;;
esac

# Free disk: drop dangling images now that the new tag is in use.
docker image prune -f >/dev/null 2>&1 || true

echo "[deploy] done $(date -Iseconds) commit=$COMMIT_SHA log=$LOG_FILE"

find "$LOG_DIR" -name 'deploy-payroll-*.log' -type f -mtime +90 -delete 2>/dev/null || true
