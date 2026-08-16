# CLAUDE.md

This file is read by Claude Code when working in this repository.

> **Monorepo note (2026-08-12):** this app now lives at `reimbursement/`
> inside the finance monorepo (`thehfhotel/hf-finance`) — subtree-merged with
> full history. Deploys run from the ROOT `.github/workflows/
> deploy-reimbursement.yml`; images are `ghcr.io/thehfhotel/
> payroll-reimbursement-{api,web}`. The old `thehfhotel/reimbursement-v2`
> repo is archived history. Read the root `CLAUDE.md` for the monorepo map.

## What this is

**reimbursement-v2** — an internal hotel-ops expense reimbursement app for HF Hotel
& HF Ville. Replaces a Notion-based workflow. Two roles:

- **Employee** — submits receipts (photo + amount + category + property), bundles
  them, sends a request for review.
- **Approver / Manager** — reviews bundles in an inbox, approves or rejects, then
  pays: either **"จ่ายผ่าน KBIZ"** (automated — writes a payment intent to a shared
  queue; the `kbiz-bot` in the payroll repo drives the bank transfer, the approver
  taps approve in the K BIZ phone app, and the e-slip files itself back) or the
  manual fallback (attach a bank-transfer slip + reference). Bundle statuses:
  `draft → pending → approved → paying → paid | rejected`; `paying` with
  `paymentError` set = needs human verification, never auto-resolved. See
  `docs/adr/0001-kbiz-transfer-automation.md`.

Company accounting (daily income + expenses, monthly P&L) is **out of scope** for
this app — that lives in a separate app, income.thehfhotel.org. Don't add a
company-ledger/admin-role feature here again (see PR #28 / its removal in
`docs/change-requests/CR-2026-07-29-remove-expense-ledger.md`).

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
Dockerfile.api, Dockerfile.web, docker-compose.production.yml
```

Deploy workflows live at the MONOREPO ROOT, not under `reimbursement/`
(there is no `.github/` in this subtree — see the banner above).

## Conventions

- **Thai-first UI**. All user-visible strings in Thai. Categories, statuses, button
  labels — never English.
- **Currency** is Thai Baht ฿, formatted with comma grouping (`฿1,234.56`).
- **Property** is a per-receipt dimension: `'hf-hotel'` | `'hf-ville'`. Default
  `hf-hotel`.
- **JWT-only auth** in production. Dev mode honors `X-Dev-User-Id` header for
  faster iteration without a Cloudflare round-trip (gated by `NODE_ENV !== 'production'`).
- **Identity mapping**: HF-ID owns identity, this app owns roles.
  - **Signed HF-ID assertion** (NFC card tap, kiosk QR scan): once the assertion
    verifies and carries the `reimbursement` grant, the employee is upserted on
    `badge` — created as `EMPLOYEE`, and thereafter only `name` is refreshed, so
    a role set here survives every later login. No second employee list to keep.
  - **Cloudflare Access via HF ID (LINE)**: the identity arrives as the synthetic
    `<badge>@emp.thehfhotel.org` address. Resolves by `email`, then by `badge`,
    and otherwise provisions on that badge — Cloudflare's `HF ID grant:
    reimbursement` policy already required the grant, so a missing row is only
    bookkeeping.
  - **Cloudflare Access via Google** (managers): resolves by `email` exact match
    only. A Google address can never match the synthetic domain, so this path
    still fails closed with a 403 on no match.
  - See `docs/change-requests/CR-2026-08-10-hfid-owns-identity.md`.
- **Tests: `bun test`** (added 2026-08-16, see
  `docs/change-requests/CR-2026-08-16-ios-share-to-receipt.md`). Bun's built-in
  runner — no framework dependency. `bun run test` at the app root, files in
  `apps/api/test/`. Coverage is deliberately narrow, not a blanket suite: it
  covers the share-inbox credential path and the pure helpers around it.
  - **DB-backed tests skip unless `TEST_DATABASE_URL` is set**, so a machine
    without Postgres still gets a green, meaningful run. Both CI workflows
    provide a `postgres` service, and the DEPLOY gate (`deploy-reimbursement.yml`'s
    `contract` job) runs them — the share token is accepted from the open
    internet, so revocation and ownership are release-blocking, not advisory.
  - Point it at a throwaway database; the suite creates and deletes users.
    `TEST_DATABASE_URL=postgresql://…/reimbursement_test bun run test`
  - Adding tests for the rest of the app is still open ground — but the
    framework question is settled, so just write them.

## Important commands

```bash
bun install                    # install all workspace deps
bun run dev:api                # start the API on :3001
bun run dev:web                # start the frontend on :5173
bun run typecheck              # typecheck all workspaces
bun run test                   # bun test (DB tests skip without TEST_DATABASE_URL)
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
- **Deploy workflow**: `.github/workflows/deploy-reimbursement.yml` (build →
  SSH-deploy) and `.github/workflows/reimbursement-ci.yml` (typecheck + PR
  image smoke) — both at the MONOREPO ROOT, not in `reimbursement/`. Do not
  confuse with the root's own `.github/workflows/deploy.yml`, which is the
  unrelated payroll-form + kbiz-bot pipeline.
- **KBIZ payment pipeline** (apps/api): `kbiz.ts` (queue-dir config + intent
  writes, dark when `KBIZ_QUEUE_DIR` unset/unprovisioned), `kbiz-poller.ts`
  (result reconciliation + stranded-payment watchdog), `voucher.ts` (Thai
  payment-voucher HTML), `settings.ts` (`app_settings` key-value: category
  mapping + payee handles), `money.ts`. Admin UI: `/admin/kbiz`
  (`apps/web/src/screens/approver/AdminKbiz.tsx`). Env: `KBIZ_QUEUE_DIR`,
  `KBIZ_POLL_MS`, `KBIZ_STALE_MS`, `SLACK_WEBHOOK_URL`. The bank-driving half
  lives in the payroll repo (`kbiz-bot/`); the contract is `KbizPaymentIntent`
  in `packages/shared`.
- **ภาพรวม (approver overview) analytics**: `apps/api/src/stats/` — window
  boundary CTEs + prev-window clamping (`windows.ts`), Thai caption/delta
  formatting (`thai-dates.ts`), and the ~10-query assembly
  (`overview.ts::buildOverviewStats`) behind `GET /api/bundles/stats
  ?window=`. Frontend lives at `apps/web/src/screens/approver/overview/`. See
  `docs/change-requests/CR-2026-08-14-overview-analytics-vendors.md`.
- **Share inbox** (phone → receipt, CR-2026-08-16): `ReceiptInbox` is a QUEUE,
  not a half-Receipt — `Receipt` keeps every invariant it had. Producers:
  `routes/inbox.ts` (`POST /api/inbox/quick`, iOS Shortcut, share-token auth)
  and `routes/share_target.ts` (`POST /api/share-target`, Android Web Share
  Target, Cloudflare Access auth → `303` back into the SPA). Consumer: the
  employee, via `screens/employee/ShareInbox.tsx` → the ordinary upload form
  with `inboxId`. Credentials: `share_tokens.ts` (DB) + `share_token_crypto.ts`
  (pure, testable without a database) — opaque tokens stored SHA-256-hashed,
  never JWTs. File handling: `uploads.ts::saveSharedFile` guarantees
  `photoPath` is always `<img>`-renderable, rasterizing PDF/HEIC via
  ImageMagick + **Ghostscript** (both installed in `Dockerfile.api`, which also
  re-enables the PDF coder Debian's ImageMagick policy disables).
  Cloudflare side lives in hf-erp: `infra/cloudflare/gate-share-upload.ts`.
  Phone pairing: `GET /api/me/share-setup` (`share_setup.ts`, pure + unit
  tested) serves the CF Access **service-token** pair — env
  `CF_SHARE_CLIENT_ID` / `CF_SHARE_CLIENT_SECRET`, optional and
  **both-or-neither** — to already-authenticated employees, so nobody carries
  credentials between devices. That pair proves "an HF device", never "this
  person"; the per-employee `hfr_` token is the identity half and the only
  revocable one.
- **Vendor matching**: `apps/api/src/vendors.ts` (lazy upsert on receipt
  save) + `apps/api/src/routes/vendors.ts` (`GET /api/vendors` autocomplete).
  Matching is owned entirely by the `vendor_normalize()` Postgres function —
  no TypeScript code re-implements or mirrors that normalization.

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

Issues live in GitHub Issues (thehfhotel/hf-finance) via the `gh` CLI; external PRs are NOT a triage/request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), created on first use. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` (lazy-created by /grill-with-docs) + `docs/adr/`. See `docs/agents/domain.md`.
