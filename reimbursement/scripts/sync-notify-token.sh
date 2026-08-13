#!/usr/bin/env bash
#
# Copy hf-erp's notification ingress token into this repo's GitHub secrets, so
# reimbursement can push "new request for approval" into the portal's bell.
#
# The value is piped straight from the portal container into `gh secret set`.
# It is never printed, never written to a file, and never lands in your shell
# history — the only thing you see is whether it worked.
#
#   ./scripts/sync-notify-token.sh
#
# Re-runnable: rotating the portal's token is this script again, nothing else.

set -euo pipefail

REPO="${REPO:-thehfhotel/hf-finance}"
SECRET_NAME="NOTIFY_INGRESS_TOKEN"
REMOTE="${REMOTE:-evergreen}"
CONTAINER="${CONTAINER:-hf-erp-portal}"
SOURCE_VAR="${SOURCE_VAR:-NOTIFY_INGRESS_TOKEN}"

echo "→ reading ${SOURCE_VAR} from ${CONTAINER} on ${REMOTE}"

# Read once into a variable rather than piping twice, so the length check and
# the upload see the same value. `local`-less on purpose: this is the top level.
token="$(ssh -o ConnectTimeout=8 "$REMOTE" \
  "sudo docker exec ${CONTAINER} printenv ${SOURCE_VAR}" 2>/dev/null || true)"
token="${token%%$'\r'*}"   # strip a stray CR if the container echoes one
token="$(printf '%s' "$token" | tr -d '[:space:]')"

if [ -z "$token" ]; then
  echo "✖ ${SOURCE_VAR} came back empty."
  echo "  Check the container name (docker ps on ${REMOTE}) or whether the var"
  echo "  is set there. Nothing was uploaded."
  exit 1
fi

echo "  got a value, ${#token} chars (not shown)"

echo "→ setting ${SECRET_NAME} on ${REPO}"
printf '%s' "$token" | gh secret set "$SECRET_NAME" --repo "$REPO"

# gh exits 0 on success, but confirm the secret is actually listed — a typo in
# the repo name would otherwise look like success.
if gh secret list --repo "$REPO" | grep -q "^${SECRET_NAME}"; then
  echo "✔ ${SECRET_NAME} is set on ${REPO}"
  echo
  echo "It takes effect on the next deploy. To apply it now:"
  echo "  gh workflow run 'Reimbursement Build & Deploy' --repo ${REPO}"
else
  echo "✖ upload reported success but the secret is not listed — check ${REPO}"
  exit 1
fi
