# reimbursement-v2

Internal hotel-ops expense reimbursement app for **HF Hotel** & **HF Ville**.
Employees submit receipts, the manager reviews and pays. Login is behind the
Cloudflare Access wall — Google for managers, HF ID for employees (also
usable via NFC staff-card tap) — then a silent token exchange.

Reimbursement only — company accounting (daily income + expenses, P&L) lives
in a separate app, income.thehfhotel.org.

## Stack

Bun · Elysia · Prisma · Postgres · Vite · React · TypeScript · Cloudflare
Access + NFC card login · Docker · GitHub Actions

## Run it locally

Requires [Bun](https://bun.sh) ≥ 1.3 and Docker.

```bash
bun install
bun run db:up           # Postgres on :5433 in Docker
bun run db:migrate      # apply schema
bun run db:seed         # sample users + receipts
cp .env.example .env    # fill in JWT_SECRET (Cloudflare Access + card login are optional locally)
bun run dev:api         # API on :3001
bun run dev:web         # frontend on :5173
```

Open <http://localhost:5173>. In dev, the tweaks panel on the right lets you
swap between seeded users without going through Cloudflare Access.

## Layout

- `apps/api` — Bun + Elysia REST API
- `apps/web` — Vite + React + TS SPA
- `packages/shared` — API contract types shared by both
- `Dockerfile.api`, `Dockerfile.web`, `docker-compose.production.yml` — prod images
- `.github/workflows/deploy-reimbursement.yml` (build → SSH-deploy) and
  `.github/workflows/reimbursement-ci.yml` (typecheck + PR image smoke) —
  both at the monorepo root (this app lives at `reimbursement/` inside
  `thehfhotel/hf-finance` (né payroll) since 2026-08-12), not under this directory
- `DEPLOYMENT.md` — first-deploy walkthrough (DNS, Cloudflare Access, secrets)
- `CLAUDE.md` — contributor guide for AI-assisted edits
- `SECURITY.md` — auth model and disclosure policy
- `PORTS.md` — local & prod port map

## Documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md) — deploy + ops
- [SECURITY.md](./SECURITY.md) — security model + reporting
- [PORTS.md](./PORTS.md) — port reference

## License

Internal project — no public license declared. Code is published for
operational transparency, not for reuse.
