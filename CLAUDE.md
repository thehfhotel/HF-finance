# CLAUDE.md

This file is read by Claude Code when working in this repository.

## What this is

**The finance monorepo** — HF Hotel & HF Ville's money-out domain, three apps
that share bespoke, co-evolving contracts (which is exactly why they live in
one repo; see the decision rule below):

| App | Where | What it does |
|---|---|---|
| **payroll-form** | `src/` (+ `test/`, root `Dockerfile`) | Payroll runs: beneficiary xlsx generation, KBIZ batch transfers, roster |
| **kbiz-bot** | `kbiz-bot/` | Headless Playwright driver for KBIZ (KBank Business Online) — the ONLY thing that logs into the bank. Serves payroll batches AND reimbursement's ad-hoc transfers via a file queue. Has its own `CLAUDE.md`. |
| **reimbursement** | `reimbursement/` | Expense reimbursement app (git subtree, full history, merged 2026-08-12). Has its own `CLAUDE.md` — read it when working there. |

**The shared contract** lives in `reimbursement/packages/shared/src/index.ts`
(`KbizPaymentIntent`, `KbizDestination`, `KbizFavorite`, category ids, memo
rules). kbiz-bot imports it directly — a contract change is a compile error on
both sides, never a runtime surprise. The apps meet at runtime through ONE
shared host directory on evergreen (`/home/deploy/kbiz-queue`, bind-mounted
into all three stacks) — intents, results, manifests, vouchers, slips.

**Repo-topology rule** (settled 2026-08-12, don't re-argue): merge repos when
contracts are bespoke and co-evolve; never merge the products; apps that talk
over stable protocols (OIDC → HF-ID, notify API → HF One portal) stay
federated. Accounting lives in income-ledger, NOT here.

## Deploys (three independent pipelines, one repo)

- `.github/workflows/deploy.yml` — payroll-form + kbiz-bot images →
  `/home/deploy/payroll-production` (paths-filtered; a
  `reimbursement/packages/shared/**` change rebuilds the bot too).
- `.github/workflows/deploy-reimbursement.yml` — reimbursement api + web
  images (`ghcr.io/thehfhotel/payroll-reimbursement-{api,web}`) →
  `/home/reimbursement-v2/production`. Triggered only by `reimbursement/**`.
- `.github/workflows/reimbursement-ci.yml` — reimbursement typecheck on PRs.

Nothing on evergreen moved in the consolidation: same compose projects, same
containers, same volumes, same deploy dirs. Only the deploy SOURCE changed.

**Evergreen gotchas** (learned the hard way): Docker there is a snap — bind
sources must live under `/home`, never `/srv`. Deploy dirs are NOT uniform:
payroll → `/home/deploy/payroll-production`, reimbursement →
`/home/reimbursement-v2/production` (a stale
`/home/deploy/reimbursement-v2-production` also exists — don't touch it).
The reimbursement api container runs as uid 1000; host dirs it writes need
`chown -R 1000:1000`.

## Working here

- Money-path changes (kbiz-bot flows, intent handling, payment endpoints) get
  adversarial review before merge. The phone-tap approval in the K BIZ app is
  a hard gate — nothing may bypass or auto-approve it.
- Root `bun test` runs payroll-form AND kbiz-bot suites (CI runs it without
  kbiz-bot's node_modules — test files must never import the browser stack;
  keep the pure-core/driver split).
- Real payee data (bank accounts) lives ONLY in
  `/home/deploy/kbiz-bot/transfer-other.config.json` on evergreen and is never
  committed. Masked (last-4) everywhere else.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (thehfhotel/payroll) via the `gh` CLI; external
PRs are NOT a triage/request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`), created on first use. See
`docs/agents/triage-labels.md`.

### Domain docs

Multi-app repo: each app keeps its own docs (`reimbursement/docs/adr/`,
`reimbursement/docs/change-requests/`). See `docs/agents/domain.md`.
