#!/usr/bin/env bash
#
# evergreen-setup.sh — idempotent first-time setup for the dedicated
# `reimbursement-v2` deploy user on evergreen.
#
# Each project on this host gets ITS OWN system user (not a shared
# `deploy` account), so two projects' CIs can't clobber each other's
# authorized_keys when GitHub Actions provisions them.
#
# Run on evergreen, as root or with sudo. Re-runnable.
#
# Usage:
#   sudo DEPLOY_SSH_PUBKEY='ssh-ed25519 AAAA…' bash evergreen-setup.sh
#

set -euo pipefail

DEPLOY_USER=reimbursement-v2
DEPLOY_HOME=/home/$DEPLOY_USER
APP_DIR=$DEPLOY_HOME/production

# ── Preflight ────────────────────────────────────────────────────────
if [ "$(id -u)" != "0" ]; then
  echo "::error::run as root (or with sudo)" >&2
  exit 1
fi

: "${DEPLOY_SSH_PUBKEY:?Set DEPLOY_SSH_PUBKEY to the public half of the GitHub Actions ed25519 key (single line, starts with ssh-ed25519)}"

if ! command -v docker >/dev/null 2>&1; then
  echo "::error::docker is not installed on this host" >&2
  exit 1
fi

# ── 1. User ──────────────────────────────────────────────────────────
if id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "✓ user $DEPLOY_USER already exists"
else
  echo "+ creating system user $DEPLOY_USER"
  useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
fi

# Lock the password so this account can ONLY log in via the SSH keys we
# explicitly authorize below — no password fallback ever, even if sshd is
# misconfigured later. Idempotent (passwd -l is a no-op if already locked).
passwd -l "$DEPLOY_USER" >/dev/null
echo "✓ password authentication disabled for $DEPLOY_USER"

# ── 2. docker group ──────────────────────────────────────────────────
if id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
  echo "✓ $DEPLOY_USER already in docker group"
else
  echo "+ adding $DEPLOY_USER to docker group"
  usermod -aG docker "$DEPLOY_USER"
fi

# ── 3. SSH authorized_keys ───────────────────────────────────────────
SSH_DIR=$DEPLOY_HOME/.ssh
AUTH_KEYS=$SSH_DIR/authorized_keys
mkdir -p "$SSH_DIR"
touch "$AUTH_KEYS"

if grep -qF -- "$DEPLOY_SSH_PUBKEY" "$AUTH_KEYS"; then
  echo "✓ pubkey already authorized"
else
  echo "+ authorizing pubkey"
  printf '%s\n' "$DEPLOY_SSH_PUBKEY" >> "$AUTH_KEYS"
fi

chown -R "$DEPLOY_USER:$DEPLOY_USER" "$SSH_DIR"
chmod 700 "$SSH_DIR"
chmod 600 "$AUTH_KEYS"

# ── 4. App directory ─────────────────────────────────────────────────
if [ -d "$APP_DIR" ]; then
  echo "✓ $APP_DIR already exists"
else
  echo "+ creating $APP_DIR"
  mkdir -p "$APP_DIR"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"

# ── 5. Print next steps ──────────────────────────────────────────────
cat <<EOF

──────────────────────────────────────────────────────────────────
✓ deploy user is ready.

  user:   $DEPLOY_USER
  home:   $DEPLOY_HOME
  dir:    $APP_DIR
  groups: $(id -Gn "$DEPLOY_USER")

Next steps (off this host):

  1. From your laptop, prove the key works (replace <key> with the
     GH Actions ed25519 PRIVATE key file):

       ssh -i <key> -o IdentitiesOnly=yes ${DEPLOY_USER}@evergreen.thehfhotel.org id

  2. Pin the host's SSH host key for the GH Actions known_hosts secret:

       ssh-keyscan -t ed25519 evergreen.thehfhotel.org

     Save the output as the GitHub repo secret SSH_KNOWN_HOSTS.

  3. Set the rest of the GitHub repo secrets — see DEPLOYMENT.md.

  4. Push to main — the deploy workflow takes it from here.
──────────────────────────────────────────────────────────────────
EOF
