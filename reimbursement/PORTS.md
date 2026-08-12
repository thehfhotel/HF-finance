# Ports

| Port | Service | Where |
|---|---|---|
| 5173 | Frontend dev server (Vite) | local dev |
| 3001 | API dev server (Bun + Elysia) | local dev |
| 5433 | Postgres dev | local dev (Docker, mapped from 5432) |
| **5800** | `reimbursement-v2-web` host binding | evergreen prod (loopback-only) |
| 5432 | Postgres prod | inside `reimbursement_v2_internal` Docker network — no host binding |

## Production routing

Public traffic hits the asgard Cloudflare Tunnel, which routes
`reimbursement.thehfhotel.org` directly to host port `5800` on evergreen
(bound to `127.0.0.1` only — not reachable from the LAN). Inside that port
sits the web container's own nginx, which:

- Serves the SPA build (`try_files $uri /index.html`).
- Proxies `/api/*` and `/uploads/*` to the api container at `:3001` over the
  private `reimbursement_v2_internal` Docker network.

There's no host-level nginx. Apps in the fleet that need path routing or
WebSocket upgrades use a separate `shared-nginx` container, but
reimbursement-v2 doesn't need it.

## Why 5800

`asgard` tunnel ingress lists ports `:80, 1883, 3000, 3003, 3019, 4001,
4010, 5000, 5001, 5230, 5434, 6379, 8081, 8082, 8123, 8443, 9001, 19999,
30031, 9898` already in use. 5800 is unused on evergreen and outside that
set, with room nearby (`5801…5809`) for sister apps.

## Why 5433 in dev

The host's port 5432 is reserved for other Postgres instances on the same
machine. We use 5433 to avoid collision. Update `DATABASE_URL` in `.env` if
you change it.

## Changing the dev frontend port

```bash
bun run dev:web -- --port 5174
```

If you change it, also update `LINE_REDIRECT_URI` in `.env` and add the new
URL to the LINE Developers console.
