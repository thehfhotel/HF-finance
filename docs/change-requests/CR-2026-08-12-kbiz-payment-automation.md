# CR-2026-08-12: Pay a reimbursement through KBIZ

Implements the API half of [ADR 0001](../adr/0001-kbiz-transfer-automation.md).
An approver hits **จ่ายผ่าน KBIZ** on an approved request, `kbiz-bot` (payroll
repo, evergreen) drives the bank, and the e-slip files itself back onto the
bundle. The human phone-tap in the K BIZ app is still required and is never
bypassed.

## What changed

### Lifecycle

```
DRAFT → PENDING → APPROVED → [จ่ายผ่าน KBIZ] → PAYING ──success──▶ PAID
                     ▲                            │
                     ├────────── confirmed-failed ┤
                     │                            │
              [ยังไม่โอน / retry]          unconfirmed ── or no result at all
                     │                            ▼
                     └──────────── PAYING + paymentError  (needs verification)
                                          └─ [แนบสลิป] POST /pay ──▶ PAID
```

`PAYING` **with** `paymentError` is the needs-verification state; `PAYING`
**without** one is simply in flight at the bank and belongs to the bot — but
only for as long as the bot is actually answering. A payment nobody ever
reports on is stranded, and has its own way out; see "Stranded payments" below.

### Schema (`apps/api/prisma/schema.prisma`)

- `enum BundleStatus += PAYING` (ordered between `APPROVED` and `PAID`).
- `Bundle.paymentIntentId String? @unique` — the queue filename, stamped by the
  atomic claim. Unique, so the database itself refuses to let one intent own two
  bundles.
- `Bundle.paymentError String?` — set while `PAYING` = needs verification; set
  while `APPROVED` = a confirmed-failed attempt, safe to retry.
- `Bundle.payingSince DateTime?` — when the atomic claim flipped the bundle to
  `PAYING`, cleared on every exit. The clock the stranded-payment watchdog and
  the console's override actions read.
- `model AppSetting { key @id, value Json, updatedAt }` → table `app_settings`,
  the runtime store for the KBIZ category mapping and payee handles.

Migrations: `apps/api/prisma/migrations/20260812000000_kbiz_payment_automation/`
and `…/20260812130000_bundle_paying_since/`, hand-written per `CLAUDE.md` and
**not applied to any database yet**. The api
container's entrypoint runs `prisma migrate deploy` on every start, so it lands
by itself on the first deploy after this merges. Postgres quirk handled in the
file: `ALTER TYPE … ADD VALUE` may run inside the migration transaction, but the
new label must not be *used* in it — nothing in this migration references
`'PAYING'`, so it is safe as one unit. Any future migration that needs to write
`PAYING` rows must be a separate file.

### New endpoints

| Endpoint | Who | Does |
|---|---|---|
| `POST /api/bundles/:id/pay-via-kbiz` | approver | Claims an `APPROVED` bundle, writes the voucher + intent |
| `POST /api/bundles/:id/payment-retry` | approver | `PAYING` → `APPROVED`, drops the stuck intent id. Body `{ force?: boolean }` |
| `GET /api/admin/kbiz-settings` | approver | `{ mapping, payees, configured }` |
| `PUT /api/admin/kbiz-settings` | approver | Validates ids + user ids, writes the two `AppSetting` rows |

`POST /api/bundles/:id/pay` (manual e-slip) now also accepts a `PAYING` bundle
that carries a `paymentError` — that is how an ambiguous payment is resolved
forward — and, with a `force` form field, a `PAYING` bundle with no error at all
(the stranded case). It clears `paymentIntentId`/`paymentError`/`payingSince`
and audits `manualResolution: true` plus `forced`.

`GET /api/bundles` / `:id` now serialize `paymentIntentId`, `paymentError`,
`payingSince` and a server-computed `kbizPayable`; `GET /api/bundles/stats`
gained a `paying` bucket. The payee setting is read **once per request**, never
per bundle.

### Order of operations (the money-safety core)

1. Everything that can refuse refuses first — feature off (503), no payee handle
   (409), nothing to pay (409) — while the bundle is untouched.
2. `updateMany({ where: { id, status: 'APPROVED' }, data: { status: 'PAYING',
   paymentIntentId, paymentError: null } })`. That `WHERE` **is** the double-pay
   guard: two concurrent clicks, one match, one 409.
3. **Only then** the voucher (`vouchers/<intentId>.html`) and the intent
   (`queue/<intentId>.json`, written to a dot-prefixed `.tmp` and renamed, so
   the bot's `*.json` glob can only ever see a complete file).

If step 3 fails and nothing reached `queue/`, the claim is released back to
`APPROVED`. If the intent file *is* there, the bundle deliberately stays
`PAYING` — the bot may already be driving the bank.

### Poller (`apps/api/src/kbiz-poller.ts`)

Started from `index.ts` only when the queue directory is mounted. Every
`KBIZ_POLL_MS` (default 5000) it reads `queue/*.json`, ignores everything that
is not `app: 'reimbursement'` + `type: 'transfer-other'` in a terminal status
(the directory is shared with payroll — other apps' files are never touched),
and settles the matching bundle:

- **success** → copy `slips/<basename>` into this app's uploads (basename
  validated, separators refused), then in one transaction `PAID` + `paidAt` +
  `transferRef` (bank reference, or the intent id) + `transferAmount` (Σ
  receipts, server-side) + `transferProofPath`, audit `pay` with
  `{ via: 'kbiz-bot', intentId, reference }`.
- **confirmed-failed** → `APPROVED`, intent id dropped, `paymentError` set,
  audit `payment-failed`, portal bell + Slack.
- **unconfirmed** → **stays `PAYING`**, `paymentError` set, audit
  `payment-unconfirmed`, portal bell + Slack. Never auto-resolved, ever.

A terminal intent the bot did not classify counts as `unconfirmed` unless its
queue status is `failed` (the contract's "nothing moved"). The intent file moves
to `queue/archive/` **only after the transaction commits** — a crash in between
just re-reads it next sweep and finds a bundle that is no longer `PAYING`, which
archives as a no-op. A result whose bundle was already resolved by a human is
archived without touching the database.

Each of the three commits is an `updateMany` guarded on `{ id, status: 'PAYING',
paymentIntentId }`, not a bare `update` by id: the bundle is read several awaits
before it is written, and a re-reconciled file (crash before archive) can race an
approver resolving the very same bundle by hand. Zero rows matched → the audit
event and the alert are skipped and the file is archived, instead of stamping
"needs verification" onto a payment somebody just closed.

### Stranded payments

The poller settles *results*. Silence is the outcome no result can report, and
there are three ordinary ways to get it: kbiz-bot is down / not deployed /
mounting a different path (the intent sits at `status: 'approved'` forever); the
bot is killed mid-flight (ADR invariant 2 — such an item is never resumed); or
this api process is rolled between the atomic claim and `writeIntent` (a `PAYING`
bundle with no queue file at all). In every case `paymentError` stays null, so
before this the bundle was unrecoverable: `/pay` and `/payment-retry` both
required a non-null error, and the only fix was editing Postgres by hand.

Three additions close it:

1. **`payingSince`**, stamped by the claim — including in the crash window,
   because it is written by the claim itself.
2. **A watchdog in the same sweep.** A bundle `PAYING` with no error for longer
   than `KBIZ_STALE_MS` is looked up in the queue. *Provably nothing armed* (no
   intent file, or one still at `status: 'approved'` — withdrawn into
   `queue/archive/` first so the bot can never start it): `paymentError` is set,
   which lights up the two existing human actions, audit `payment-stale`, portal
   bell + Slack. *The bot owns it and has gone quiet*: **alert only**, once per
   intent — flagging would offer "ยังไม่ได้โอน" for a transfer that may still be
   armed on somebody's phone, and inviting a second transfer is the one thing
   this pipeline must never do.
3. **Two human overrides**, offered by the console once a `paying` bundle passes
   `PAYMENT_STUCK_MS` (10 min, `apps/web/src/lib/stats.ts`):
   - **โอนไปแล้ว — แนบสลิปเอง** → `POST /pay` with `force`. The approver holds
     the phone e-slip; audited `manualResolution: true, forced: true`.
   - **ยังไม่ได้โอน — ปล่อยกลับ** → `POST /payment-retry`. No `force` needed when
     the queue proves nothing armed; with `force` (a danger-styled confirm that
     tells them to check K BIZ first) it also releases an intent the bot still
     owns. Audited with the observed `intentState`.

Manual payment therefore remains the fallback for **every** bundle, including a
stuck one — which is what the risk section below has always promised.

### Alerting

`notifySlack(text)` joins `notifyPortal` in `apps/api/src/notify.ts`: same
fire-and-forget, same dark-when-unconfigured posture. Non-success outcomes fire
both (`การจ่ายไม่สำเร็จ` / `การจ่ายต้องตรวจสอบ`, audience `managers`), plus the
in-app `paymentError` flag. A stranded payment fires the same pair
(`การจ่ายค้างนาน` when the bot still owns it), once per intent — a payment that
recovers on its own never pages anybody.

## Env vars

| Var | Where | Default | Meaning |
|---|---|---|---|
| `KBIZ_QUEUE_DIR` | api container | *(unset in dev)* | Shared queue dir. Unset, missing at runtime, **or without a `queue/` sub-directory** → feature dark: 503 on จ่ายผ่าน KBIZ, poller never starts. Compose sets `/kbiz-queue`. |
| `KBIZ_QUEUE_HOST_DIR` | host / `.env` | `/home/deploy/kbiz-queue` | Host side of the bind mount. |
| `KBIZ_POLL_MS` | api container | `5000` | Sweep interval (floor 1000). |
| `KBIZ_STALE_MS` | api container | `900000` | How long a bundle may be `PAYING` with no word from the bot before the watchdog flags/alerts (floor 60000). |
| `SLACK_WEBHOOK_URL` | api container | *(unset)* | Payment alerts. Unset → no Slack. |

Nothing here holds bank data. The intent carries a payee **handle**
(`payee: { handle }`) that the bot resolves against a saved, vetted KBIZ
account; account numbers live in KBIZ and in the bot's own gitignored
`transfer-other.config.json`, never in this repo or this database.

## Evergreen ops runbook

**1 — create the shared queue directory** (once, as root on evergreen):

```bash
sudo mkdir -p /home/deploy/kbiz-queue/{queue,queue/archive,vouchers,slips}
# The api container runs as the image's `bun` user, UID 1000 (Dockerfile.api).
# kbiz-bot must be able to read/write the same tree — give both write access,
# via a shared group if the bot's uid differs.
sudo chown -R 1000:1000 /home/deploy/kbiz-queue
sudo chmod -R 2775 /home/deploy/kbiz-queue
```

**This step is what turns the feature on.** The API gates on `<dir>/queue`
existing, not on the root: Docker *creates* a missing bind-mount source by
itself, so the root is worthless as a gate — without this check the feature
would switch itself on at the first deploy after merge, whether or not anyone
had provisioned anything, and write intents into a directory no bot is reading.
`queue/` is only ever created by hand here (or by kbiz-bot's own tree), never by
this app: `ensureSubdirs` refuses to run until it is there, and then adds only
`queue/archive/`, `vouchers/` and `slips/`. A typo'd path therefore leaves an
empty directory and a dark feature — 503 on จ่ายผ่าน KBIZ, no poller — rather
than a queue nobody reads. Ownership matters too: the api container runs as UID
1000, so a root-owned tree makes every write fail.

**2 — reimbursement side.** Already in `docker-compose.production.yml`: the api
service mounts `${KBIZ_QUEUE_HOST_DIR:-/home/deploy/kbiz-queue}:/kbiz-queue` and sets
`KBIZ_QUEUE_DIR=/kbiz-queue`. Nothing to do beyond deploying.

The bind deliberately keeps Docker's default `create_host_path`. Pinning it to
`false` would make a wrong (or not-yet-created) host path fail the **container
start** — which takes the entire reimbursement app down for a feature that is
supposed to fail dark, and would do exactly that on the first deploy of this CR
if step 1 has not been run yet. The `queue/` marker gives the same protection
where it belongs: the feature stays off, the app keeps serving.

**3 — payroll side (kbiz-bot).** **Nested binds — the only supported topology**
(payroll's `docker-compose.yml` has them drafted, commented out): bind the
shared sub-directories OVER the bot's existing data dir —
`/home/deploy/kbiz-queue/queue:/app/data/queue`, `…/slips:/app/data/slips`,
`…/vouchers:/app/data/vouchers` — plus the **same `queue` bind on the
`payroll` service**, and leave every `KBIZ_*` env var unset. Mind the order:
nested binds must be listed after their parent.

> Do NOT instead repoint the bot with `KBIZ_QUEUE_DIR` at a separate tree
> (the previously-drafted "whole tree" option): the bot watches exactly one
> queue dir, and payroll-form writes its own items to `/app/data/queue` — a
> repointed bot silently stops processing every payroll request, with no
> error anywhere. Nested binds move the physical location while every path
> both producers use stays the same. Accepted tradeoff: payroll queue items
> become readable by the reimbursement-api container (same host, same owner).
> Migrate the existing queue contents first: see payroll's `EVERGREEN.md`
> switch-over steps (`rsync data/queue/ → /home/deploy/kbiz-queue/queue/`).

**4 — secrets (GitHub → this repo).** Both optional; unset keeps the feature
dark rather than breaking a deploy:

- `SLACK_WEBHOOK_URL` — the payroll incoming webhook.
- `KBIZ_QUEUE_HOST_DIR` — only if the host path differs from `/home/deploy/kbiz-queue`.

**5 — configure payees + categories** at `/api/admin/kbiz-settings` (approver
session). `payees` maps `User.id` → the bot's payee handle; the handle must
already exist in the bot's config, and the account behind it must already be
saved and vetted inside KBIZ. `mapping` is the receipt-category → KBIZ-category
table; unmapped categories fall to `defaultCategoryId`.

**6 — verify.** `GET /api/admin/kbiz-settings` should report
`configured: true`; the api log line `[kbiz] watching the payment queue every
5000ms (stranded after 15m)` confirms the poller started. The other boot lines
say exactly what is wrong instead: `no KBIZ_QUEUE_DIR` (feature not wired up),
`… is not a directory` (the mount is gone), `… has no queue/ — run the CR
runbook step 1 on the host` (step 1 was skipped, or the host path is a typo and
Docker invented an empty directory for it).

## Risk / rollback

Fails dark at every level: no provisioned `queue/` → the feature does not exist
(and Docker inventing the mount point does not change that); no payee handle →
409 before anything is claimed; no Slack/portal token → no alert, no error.
Existing manual payment is unchanged and remains the fallback for every bundle,
including a stuck one — see "Stranded payments" for how a bundle nobody reports
on gets back to a human.

Rollback is deploying the previous image: `PAYING` is only reachable through the
new endpoint, so no bundle can be in it. A bundle already `PAYING` at rollback
time would need its status set back to `APPROVED` by hand (`paymentIntentId` and
`paymentError` cleared) after confirming in K BIZ whether the transfer landed.
The migration itself is additive and safe to leave in place.

Watch for: intents piling up in `queue/` (bot down — the watchdog now says so in
Slack after `KBIZ_STALE_MS`), anything sitting in `queue/archive/` with an
`unconfirmed` outcome (a human owes it a decision), `payment-stale` audit events
(a payment nobody reported on), and `[kbiz] refusing unsafe slip filename` in the
api log (the bot writing a slip name outside the agreed basename contract).

## Docs updated under this CR

- Root `CLAUDE.md`: the approver flow now describes "จ่ายผ่าน KBIZ", the
  `paying` status (+ needs-verification semantics), and a "Where things live"
  entry for the pipeline modules, admin screen, and env vars.
- `docs/adr/0001-kbiz-transfer-automation.md`: "Amendments (2026-08-12)"
  section + env-var names corrected to the implemented set
  (`KBIZ_QUEUE_DIR` / `KBIZ_SLIPS_DIR` / `KBIZ_SHARED_DIR`; there is no
  `KBIZ_DATA_DIR`).
- Overseer-pass corrections after cross-stream verification: the payroll-side
  mount topology is nested-binds ONLY (the earlier "whole tree" option would
  have silently stranded payroll's own queue — see step 3), the poller now
  alerts on an orphaned non-failure result instead of archiving it silently,
  imports the bot's screenshot as evidence on `unconfirmed`, the bot treats
  KBIZ's generic "เกิดข้อผิดพลาด" page as unconfirmed (never retryable), and a
  withdrawn queue file no longer aborts the bot's whole batch.

## Post-deploy correction (2026-08-12)

The shared tree lives at `/home/deploy/kbiz-queue` (payee book at
`/home/deploy/kbiz-bot/`), NOT `/srv/...` as first planned: evergreen runs
Docker as a **snap**, whose confined daemon cannot use bind sources outside
`/home` — `/srv` mounts fail container start with `error while creating mount
source path … read-only file system` even though the path exists. Both
2026-08-12 deploys tripped this and briefly took the stacks down; recovery was
relocating the tree + pointing `KBIZ_QUEUE_HOST_DIR` (env/secret) at the new
path. Compose/workflow defaults now say `/home/deploy/kbiz-queue`.
