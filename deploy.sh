#!/usr/bin/env bash
# Deploy payroll-form + kbiz-bot to evergreen.
#
# Assumes:
#   - SSH key auth to ${REMOTE} is set up (no password prompt).
#   - The repo is already cloned at ${APP_DIR} on the remote (see EVERGREEN.md).
#   - .env exists at ${APP_DIR}/.env on the remote.

set -euo pipefail

REMOTE="${REMOTE:-nut@evergreen}"
APP_DIR="${APP_DIR:-~/payroll}"
BRANCH="${BRANCH:-main}"

log() { printf "\033[36m→\033[0m %s\n" "$*"; }
ok()  { printf "\033[32m✓\033[0m %s\n" "$*"; }

if ! git diff-index --quiet HEAD --; then
  log "Local uncommitted changes detected. Showing status, then aborting:"
  git status --short
  echo
  echo "Commit or stash first, then re-run."
  exit 1
fi

log "Pushing ${BRANCH} to GitHub …"
git push origin "${BRANCH}"
ok "Pushed."

log "Deploying to ${REMOTE}:${APP_DIR} (branch: ${BRANCH}) …"
ssh "${REMOTE}" bash -se <<EOF
set -euo pipefail
cd ${APP_DIR}
echo "→ git pull"
git fetch origin
git checkout ${BRANCH}
git reset --hard origin/${BRANCH}

echo "→ docker compose build"
docker compose build

echo "→ docker compose up -d"
docker compose up -d

echo
echo "→ docker compose ps"
docker compose ps
EOF

ok "Deployed."
echo
echo "Tail logs with:    ssh ${REMOTE} 'cd ${APP_DIR} && docker compose logs -f'"
