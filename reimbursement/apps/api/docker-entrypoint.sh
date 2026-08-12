#!/bin/sh
# Reimbursement API container entrypoint.
#
# Runs Prisma migrations against the live database BEFORE handing control to
# the bun server. If migrations fail, we exit non-zero so the orchestrator
# (compose / restart policy) can surface the failure instead of letting a
# stale-schema server come up.

set -eu

cd /app/apps/api

if [ -z "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] DATABASE_URL is not set — refusing to start" >&2
    exit 1
fi

echo "[entrypoint] running prisma migrate deploy..."
# `migrate deploy` only applies committed migrations, never resets data.
# It exits 0 when there is nothing to apply, so it is safe to run on every
# container start.
bunx prisma migrate deploy --schema=prisma/schema.prisma

echo "[entrypoint] handing off to: $*"
exec "$@"
