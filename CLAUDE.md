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
  `reimbursement/packages/shared/**` change rebuilds the bot too). `test`
  also runs on `pull_request` (kbiz-bot typecheck + the root shared-contract
  suite); `build-*`/`deploy` explicitly exclude `pull_request` (push and
  manual `workflow_dispatch` still build/deploy).
- `.github/workflows/deploy-reimbursement.yml` — reimbursement api + web
  images (`ghcr.io/thehfhotel/payroll-reimbursement-{api,web}`) →
  `/home/reimbursement-v2/production`. Triggered only by `reimbursement/**`.
  `deploy` needs both `build` and a `contract` job that runs the SAME root
  `bun test` deploy.yml's `test` job runs — a broken KBIZ contract blocks
  BOTH pipelines' deploys, not just whichever one's CI happened to catch it.
- `.github/workflows/reimbursement-ci.yml` — reimbursement typecheck on PRs.

Nothing on evergreen moved in the consolidation: same compose projects, same
containers, same volumes, same deploy dirs. Only the deploy SOURCE changed.

**Both deploy workflows share ONE concurrency group** (`deploy-evergreen`),
not two — they used to be independent groups, which let a payroll rollout and
a reimbursement rollout run `docker compose up` concurrently against the same
shared `/home/deploy/kbiz-queue` dir. Now they queue against each other.

**Secrets shared across both deploy workflows** (same names, same repo,
intentionally): `READER_RESOLVE_SECRET`, `HF_ID_BASE_URL`, `HF_ID_ISSUER`
(one central HF-ID service both stacks authenticate card-taps against) and
`SLACK_WEBHOOK_URL` (one Slack webhook). Rotating any of these means
redeploying BOTH stacks (a push here AND a push touching `reimbursement/**`)
or the two apps silently disagree on the value until both redeploy.
`deploy-reimbursement.yml`'s job sets `environment: production`; if that
GitHub Environment is ever given its own environment-scoped copy of one of
these names, it would shadow the repo-level secret for reimbursement ONLY —
don't add environment-scoped overrides for these four without updating this
note.

**`KBIZ_QUEUE_HOST_DIR` is a hardcoded literal, not a secret**, in both
`docker-compose.yml` (root) and `deploy-reimbursement.yml`:
`/home/deploy/kbiz-queue`. It used to be secret-configurable in
`deploy-reimbursement.yml` only, which meant a single GH secret could move
reimbursement's half of the shared queue while payroll/kbiz-bot's half
(which has no equivalent secret wired through `deploy.yml`'s jq payload)
stayed put — a silent split with no failing check anywhere. If this path
ever needs to change, change the literal in both workflows in the same
commit.

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

Issues live in GitHub Issues (thehfhotel/HF-finance) via the `gh` CLI; external
PRs are NOT a triage/request surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical defaults (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`), created on first use. See
`docs/agents/triage-labels.md`.

### Domain docs

Multi-app repo: each app keeps its own docs (`reimbursement/docs/adr/`,
`reimbursement/docs/change-requests/`). See `docs/agents/domain.md`.
