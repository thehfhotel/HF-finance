# CLAUDE.md

This file is read by Claude Code when working in this repository.

## What this is

**reimbursement-v2** — an internal hotel-ops expense reimbursement app for HF Hotel
& HF Ville. Replaces a Notion-based workflow. Two roles:

- **Employee** — submits receipts (photo + amount + category + property), bundles
  them, sends a request for review.
- **Approver / Manager** — reviews bundles in an inbox, approves or rejects, then
  attaches a bank-transfer slip + reference to mark as paid.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Bun 1.3+ |
| Backend | Elysia + Prisma + Postgres |
| Frontend | Vite + React 18 + TypeScript |
| Auth | Cloudflare Access (`Cf-Access-Jwt-Assertion` → app-issued HS256 JWT) + HF-ID NFC card login |
| Workspace | Bun workspaces (`apps/*`, `packages/*`) |
| Container | Docker (api + nginx-fronted SPA) |
| Deploy | GitHub Actions → SSH → evergreen Ubuntu host |

## Layout

```
apps/
  api/       Bun + Elysia REST API
    src/     routes/, auth.ts, jwt.ts, db.ts, serializers.ts
    prisma/  schema, migrations, seed
  web/       Vite + React + TS frontend
    src/     screens/, components/, lib/
packages/
  shared/    API contract types (Receipt, Bundle, Property, Role, etc.)
deploy/      nginx vhost reference
.github/
  workflows/ deploy.yml — build images, ssh deploy
Dockerfile.api, Dockerfile.web, docker-compose.production.yml
```

## Conventions

- **Thai-first UI**. All user-visible strings in Thai. Categories, statuses, button
  labels — never English.
- **Currency** is Thai Baht ฿, formatted with comma grouping (`฿1,234.56`).
- **Property** is a per-receipt dimension: `'hf-hotel'` | `'hf-ville'`. Default
  `hf-hotel`.
- **JWT-only auth** in production. Dev mode honors `X-Dev-User-Id` header for
  faster iteration without a Cloudflare round-trip (gated by `NODE_ENV !== 'production'`).
- **Identity mapping**: no self-signup — admin manages `badge` + `email` on the
  User row. On login, the verified identity resolves by `email` exact match
  first, else via the synthetic `<badge>@emp.thehfhotel.org` address → `badge`
  match. No match → fail-closed 403.
- **No tests yet** — Phase 6 territory. Don't add a test framework without asking.

## Important commands

```bash
bun install                    # install all workspace deps
bun run dev:api                # start the API on :3001
bun run dev:web                # start the frontend on :5173
bun run typecheck              # typecheck all workspaces
bun run db:up                  # start dev Postgres in Docker
bun run db:migrate             # apply prisma migrations (dev DB)
bun run db:seed                # seed sample users + receipts + bundles
```

## Where things live

- **API contract types**: `packages/shared/src/index.ts`. Both apps import from
  `@reimbursement/shared`.
- **Theme**: `apps/web/src/lib/theme.ts` (`getTheme(dark, accent)`).
- **Routing** (state-based, not URL-based for in-app screens): `apps/web/src/lib/router.ts`.
- **Mock data for seed**: `apps/api/prisma/seed.ts`.
- **Deploy workflow**: `.github/workflows/deploy.yml`.

## Things to avoid

- Don't proactively create new doc files. Update existing ones (this file,
  `DEPLOYMENT.md`, `PORTS.md`, `SECURITY.md`) instead.
- Don't commit secrets. `.env` and `.env*.local` are gitignored.
- Don't use `prisma migrate dev` in non-interactive contexts; it requires a TTY.
  Use `prisma db push --accept-data-loss` for the dev DB and hand-write migration
  SQL files for tracking, marking applied with `prisma migrate resolve --applied`.
- Don't commit the Notion export folder (`Private & Shared 2/`). It's gitignored
  and contains 1.2k receipt photos + business data. The CSV importer (Phase 5)
  will read from it locally and push to the prod DB once over SSH.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (thehfhotel/reimbursement-v2) via the `gh` CLI; external PRs are NOT a triage/request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), created on first use. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` (lazy-created by /grill-with-docs) + `docs/adr/`. See `docs/agents/domain.md`.
