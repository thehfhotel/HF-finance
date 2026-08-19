# 0001 — Reimbursement-triggered KBIZ transfer automation

- **Status:** Accepted (design) — not yet implemented
- **Date:** 2026-08-11
- **Deciders:** Winut (owner/approver), with design interview
- **Scope:** reimbursement (this repo) + `kbiz-bot` (lives in the `thehfhotel/payroll`
  repo, runs on evergreen). Bank-driving code stays in `kbiz-bot`; this ADR is
  authored here because the bulk of the change is reimbursement-side and this is
  where the payment lifecycle lives.

## Context

Today a reimbursement is paid in three manual steps: an approver hits **Approve**
(`PENDING`→`APPROVED`), does the KBIZ bank transfer **by hand**, then hits **Pay**
(`/bundles/:id/pay`) — typing the transfer reference and uploading the e-slip —
which sets `PAID` (`transferRef`, `transferProofPath`, `transferAmount` =
Σ receipts, `paidAt`, audit `pay`).

We are automating the manual middle: the approver clicks **Pay via KBIZ**, a bot
runs the KBIZ transfer, and the e-slip files itself back into the bundle.

The bot (`kbiz-bot`) already exists and runs on evergreen as a headless
Playwright `process-queue --watch` service inside the payroll stack. It holds the
sole KBIZ credentials and the single warm browser session — KBIZ punishes a
second concurrent login, so that instance stays single. `kbiz-bot` **stays inside
the payroll repo** (payroll is stable; extracting it would be pure ceremony for
real prod risk — see "Alternatives"). A `transfer-other` flow (single ad-hoc
transfer) was already drafted in `kbiz-bot`; this ADR changes how the destination
account is chosen and how outcomes are reported.

**Hard constraint — money safety.** No double-pay; no machine auto-retry of a
transfer whose outcome is ambiguous; the human phone-tap in the K BIZ app is
always required and is never bypassed.

## Decision

An approver-triggered, queue-mediated, pull-reconciled payment pipeline. Nine
decisions, each resolved in the design interview:

### 1. Trigger — a deliberate admin action, separate from approval
Approval stays exactly as it is and **never moves money**. A new admin-only
action **"Pay via KBIZ"** on `APPROVED` bundles writes the payment intent.
Employees / the office kiosk *submit* requests; **admins** approve and pay.

### 2. State model + double-pay guard
Add one bundle status **`PAYING`** and a **`paymentIntentId`** field. "Pay via
KBIZ" performs an **atomic** `UPDATE … WHERE status = 'APPROVED'` that flips the
bundle to `PAYING` and stamps the intent id. That `WHERE` clause *is* the
double-pay guard: of two concurrent clicks exactly one update matches a row, the
other affects zero rows and is rejected — two intents can never exist for one
bundle. (Chosen over a dedicated `Payment` table: lighter, reuses status
machinery, and the atomic guard is race-proof. Audit history rides the existing
`AuditEvent` table.)

### 3. Four-way outcome; ambiguity is never auto-resolved
The bot classifies every attempt (grown from three to four in Amendment 7,
2026-08-19 — see below):
- **success** — e-slip / reference seen → `PAYING`→`PAID`, slip filed.
- **confirmed-failed** — KBIZ errored, transfer never armed → `PAYING`→`APPROVED`,
  safe to retry, error shown.
- **push-expired** — KBIZ's own expiry modal: the ~6 min phone-approval window
  closed with no tap → `PAYING`→`APPROVED`, safe to retry, error shown. Added
  2026-08-19: before this it fell through into `unconfirmed`, even though the
  bank had already proven the transaction moved ฿0 — see Amendment 7.
- **unconfirmed** — timeout / crash / can't tell (the tap may have landed as the
  bot gave up) → bundle **stays `PAYING`, flagged "needs verification"**, Pay
  button disabled, human alerted. **Never auto-retried, never auto-paid.**
  Releasing it back to `APPROVED` now requires `force` (Amendment 7 item 5) —
  the approver must assert they checked K BIZ's ประวัติทำรายการ first; there
  is no non-forced release path for this row any more.

### 4. Payee — a KBIZ saved account, selected by nickname
KBIZ holds vetted **saved accounts with nicknames**. The bot **selects the saved
account by nickname**; it never types a bank/account number, so a mis-keyed
account is impossible by construction. **KBIZ owns the account numbers.** The
bot's config maps payee → nickname (today: `Revew → "Revew"`); reimbursement
stores zero bank data. The bot verifies the nickname and cross-checks the
account name KBIZ resolves before confirming. Because the bot has exactly one
saved account it is allowed to pay, it can only ever pay Revew **or refuse** — it
cannot misroute. Expanding later = save the new account in KBIZ once + add one
nickname line.

### 5. Operators
Employees (Revew) / office kiosk → submit reimbursement *requests* (unchanged).
Admins → approve + trigger the KBIZ payment. General vendor transfers initiated
by Revew/kiosk are a **future** surface (out of scope).

### 6. Slip return — pull
Reimbursement-api **polls** the shared dir (~5 s), sees its intent reach a
terminal state (the bot already writes results back into the intent JSON via
`patchRequest`), copies the slip into its own uploads (so `transferProofPath`
lands behind the same CF-identity gate as a manual slip), and marks the bundle.
Chosen over push because reimbursement-api must mount the shared dir anyway to
*write* intents — reading results back adds zero network surface.

### 7. Unconfirmed resolution — the human's phone e-slip, not scraping
The approver is **always** on their phone for the tap, so they always know the
outcome and **have the e-slip** even when the bot missed it. So we build **no**
KBIZ-history scraping. A stuck (`PAYING`-needs-verification) bundle offers two
human actions:
- **โอนแล้ว / Mark transferred** — attach the phone e-slip + reference → `PAID`.
  This reuses the existing manual `/pay`, extended to also accept a
  `PAYING`-needs-verification bundle (not only `APPROVED`).
- **ยังไม่โอน / Retry** — release to `APPROVED`, Pay via KBIZ again (new
  `paymentIntentId`; the old stuck intent is archived).

The bot's slip-capture is a convenience for the happy path; the human's phone
e-slip is the reliable fallback. `confirmed-failed` retries freely (nothing
moved); `unconfirmed` is resolved only by the human explicitly choosing one of
the two buttons above.

### 8. Audit artifacts — required title, Thai memo, Thai voucher
- **Required title.** Reuse the existing `bundle.name` (already `String`,
  `minLength:1` at the API). Both builders (mobile + desktop) currently fall back
  to a throwaway `คำขอ <date>` when the name is blank — **drop that fallback** so
  the title is a deliberate required input (submit disabled until filled). No new
  column, no migration; existing bundles keep their names.
- **Memo** (บันทึกช่วยจำ, ≤100 chars): `<title> #<shortId>` — one space, no
  "คำขอ" word, no "·". Title truncated (…) to keep the whole string ≤100, `#ref`
  always preserved. e.g. `ค่าเดินทางไปประชุม #A3F9`.
- **Attachment** — a Thai payment voucher (ใบสรุปการจ่ายคืน): payee, คำขอ #ref,
  วันที่จ่าย, a table of ใบเสร็จ (วันที่ · หมวด · สถานที่ · จำนวนเงิน), **ยอดรวม**,
  ผู้อนุมัติ + วันที่อนุมัติ. **Text-only, no receipt photos** (keeps it small;
  photos live in the app). Reimbursement renders it as **HTML** (it's a Thai web
  app — perfect Thai shaping); the **bot converts that HTML to PDF with its
  Chromium** before attaching (sidesteps Thai-font shaping bugs in headless PDF
  libs, reuses the browser the bot already has).

### 9. Alerting on payments needing attention
On any non-success outcome, reimbursement fires **all three**: the **HF One
portal bell** (`notifyPortal`, admin audience — `การจ่ายต้องตรวจสอบ` /
`การจ่ายไม่สำเร็จ`), an **in-app flag** on the bundle, and **Slack** (reuse the
payroll `SLACK_WEBHOOK_URL` for now).

## Architecture

### Bundle lifecycle
```
DRAFT → PENDING → APPROVED → [Pay via KBIZ] → PAYING ──success──▶ PAID
                     ▲                           │
                     │                    confirmed-failed
                     └───────────────────────────┘
                                                 │
                                          unconfirmed
                                                 ▼
                                   PAYING (needs verification)
                                     ├─ Mark transferred (+e-slip) ─▶ PAID
                                     └─ Retry ─▶ APPROVED
```

### Shared queue directory (decision 8/Q8: neutral host path)
`/srv/kbiz-queue/` on evergreen, bind-mounted into `kbiz-bot`, `payroll-form`,
and `reimbursement-api`:
```
/srv/kbiz-queue/
  queue/       <paymentIntentId>.json    intents + bot-written results
  vouchers/    <paymentIntentId>.html    reimbursement writes; bot renders→PDF
  slips/       <paymentIntentId>.<ext>   bot writes captured e-slip
```
The bot's data dir is de-coupled from its `resolve("..","data")` assumption via
`KBIZ_QUEUE_DIR` / `KBIZ_SLIPS_DIR` / `KBIZ_SHARED_DIR` env vars (defaults preserve
current behavior) — though the production switch-over uses nested binds and leaves
them unset (see the CR).

### Intent contract (`queue/<paymentIntentId>.json`)
Written by reimbursement:
```jsonc
{
  "id": "<paymentIntentId>",        // unique per attempt; also the filename
  "app": "reimbursement",
  "type": "transfer-other",
  "status": "approved",             // process-queue picks up "approved"
  "bundleId": "<id>",
  "payeeNickname": "Revew",         // bot's config resolves nickname→saved acct
  "payeeName": "เรวิว",             // cross-checked against KBIZ resolved name
  "amount": 1234.50,                // = Σ receipts (server-computed)
  "memo": "ค่าเดินทางไปประชุม #A3F9",
  "voucherFile": "vouchers/<paymentIntentId>.html"
}
```
Written back by the bot (via existing `patchRequest`):
```jsonc
{
  "status": "done",                        // done | failed | needs-review
  "outcome": "success",                    // success | confirmed-failed | unconfirmed | push-expired
  "reference": "0123456789",
  "slipFile": "slips/<paymentIntentId>.png"
}
```

### Money-safety invariants
1. **One intent per bundle** — atomic `WHERE status='APPROVED'` flip (decision 2).
2. **Crash-safe** — the bot marks the item `running` **before** arming the phone
   push; the `--watch` loop only ever re-picks `approved` items, so a crashed
   mid-flight transfer is never auto-re-run. A `running`/`needs-review`
   `transfer-other` item is surfaced for a human, never resumed.
3. **Ambiguity is human-resolved** — `unconfirmed` never auto-anything; the phone
   e-slip is the source of truth (decision 7).
4. **Cannot misroute** — the bot has one saved account it may pay; wrong-payee →
   refuse, never a different account (decision 4).
5. **Phone tap always required** — the bot arms; the human releases.

## Consequences

**Positive**
- The approver never types an account number or a reference again on the happy
  path; the slip files itself.
- Double-pay is structurally prevented (atomic guard) and mis-routing is
  impossible (single saved account, verified by nickname + resolved name).
- Reuses existing machinery: bundle status flow, `AuditEvent`, `/pay` upload,
  `notifyPortal`, the bot's `patchRequest` result-writing and Slack webhook.
- No new bank data in reimbursement; no schema migration for the title.

**Negative / accepted**
- A new `PAYING` status + `paymentIntentId` (+ a `paymentError`/needs-verification
  marker) — small schema addition; the UI's status tabs/serializers must handle
  `PAYING`.
- Reimbursement-api gains a poll loop and a bind-mount of a shared host dir
  (cross-stack filesystem coupling, accepted with the "shared queue dir" choice).
- The `unconfirmed` path still leans on the human honestly checking their K BIZ
  app before retrying — mitigated by "attach the e-slip you already have"
  instead of a blind retry.
- The bot's `transfer-other` flow must change from *typing* bank+account to
  *selecting a saved account by nickname* (a probe run pins that selector).

## Alternatives considered

- **Extract `kbiz-bot` into its own repo** — rejected. Payroll is stable and the
  bot already runs on evergreen; "shared" is achieved by the shared queue dir +
  a `transfer-other` intent handler, not by the repo boundary. Extraction is
  risky prod surgery (new pipeline, second SSH key, duplicated KBIZ secrets,
  warm-session volume migration) for no functional gain.
- **Approval auto-fires the transfer** — rejected. Collapses a routine approval
  and an irreversible payment into one click.
- **Dedicated `Payment` table** — rejected for v1. The `PAYING` status +
  `paymentIntentId` + `AuditEvent` cover idempotency, recovery, and history with
  less machinery.
- **Push (bot → reimbursement endpoint)** for slip return — rejected. Pull adds
  no new ingress since the shared dir is already mounted.
- **KBIZ-history auto-check** to resolve `unconfirmed` — rejected for v1. The
  human has the phone e-slip; scraping history is real work for a case the human
  already knows the answer to. On the v2 list.

## Out of scope (future)

- General vendor transfers initiated by Revew / the office kiosk (a separate
  operator surface).
- Multi-recipient / payee management (today: one saved account, one nickname).
- KBIZ-history auto-verification of `unconfirmed` payments.
- Receipt thumbnails in the voucher.

## Implementation work items

**reimbursement (this repo)**
- Schema: `BundleStatus += PAYING`; `Bundle.paymentIntentId String?`;
  `Bundle.paymentError String?` (set = needs-verification). Hand-authored
  migration SQL (per CLAUDE.md, no `migrate dev`).
- `POST /bundles/:id/pay-via-kbiz`: admin-only; atomic `APPROVED`→`PAYING` +
  stamp intent id; render voucher HTML → `vouchers/`; write intent → `queue/`.
- Poller: ingest terminal intents from `queue/`; copy slip → uploads →
  `transferProofPath`; set `transferRef`; `PAYING`→`PAID` (audit `pay`) or handle
  `confirmed-failed`/`unconfirmed`; fire `notifyPortal` + Slack on non-success.
- Extend `POST /bundles/:id/pay` to also accept a `PAYING`-needs-verification
  bundle (manual e-slip resolution).
- `POST /bundles/:id/payment-retry`: `PAYING`-needs-verification → `APPROVED`,
  archive the old intent.
- Web: required title in both builders (drop the auto-name fallback); `PAYING`
  state in status tabs/serializers + the "Pay via KBIZ", "Mark transferred",
  "Retry" actions and the needs-verification flag.
- Deploy: mount `/srv/kbiz-queue` into `reimbursement-api`; env for the queue
  path + Slack.

**kbiz-bot (payroll repo)**
- `process-queue.ts`: add the `transfer-other` case → `runTransferOtherFlow`.
- `transfer-other-flow.ts`: select a **saved account by nickname** (not typed
  bank+account); render the voucher HTML→PDF and attach; formalize the
  **success / confirmed-failed / unconfirmed** outcome in the result.
- De-couple the data dir via `KBIZ_QUEUE_DIR` / `KBIZ_SLIPS_DIR` / `KBIZ_SHARED_DIR` (default = today).
- Probe the saved-accounts selector on the live `fundtranfer-other` page to pin
  selectors before first real run.
- Deploy: move the queue to `/srv/kbiz-queue`; mount it into `kbiz-bot` +
  `payroll-form`.

## Prerequisite (blocks first real run)
The `transfer-other` selectors are unverified against the live KBIZ page. Run the
probe against the **single evergreen session** (never a second login), pin the
saved-account selector, do a preview run, then one real `--confirm` payment.
```

## Amendments (2026-08-12)

The prerequisite above is **done** — the `transfer-other` flow was probed and run
against the live KBIZ page, and five things came back different from the design.
Where this section and the body above disagree, this section is what shipped.

**1 — The memo has no `#`.** Decision 8 specified `<title> #<shortId>`. KBIZ's
บันทึกช่วยจำ field rejects `#`, and every other special character with it:
verified live, only the Thai block, ASCII letters/digits and spaces survive. The
memo is therefore `"<title> <shortId>"` — one space, no `#`, no `·` — e.g.
`ค่าเดินทางไปประชุม 3FA9C1`. `buildKbizMemo` in `@reimbursement/shared` is the
single implementation: it sanitizes, then truncates the **title** so the 6-char
shortId always survives intact inside the 100-character limit.

**2 — The Next button IS the arming step.** The design assumed a preview screen
followed by a separate Confirm, with the phone push fired at Confirm. There is no
such Confirm: on the `fundtranfer-other` page, **Next** is what arms the transfer
and pushes the K BIZ app. A preview run must therefore stop *before* Next — that
button is the point of no return, and the bot marks its queue item `running`
before pressing it, so a crash mid-flight is never auto-re-run (money-safety
invariant 2 is unchanged, only the button it hangs on).

**3 — The expense category is admin-configurable data, not code.** KBIZ requires
an expense category per transfer, from its own fixed picker (`KBIZ_CATEGORIES`,
ids pinned from the live page — sparse and unordered, `12 Other` last; never
renumber them). Our receipt categories are free-form strings the hotel adds to,
so the mapping lives in the new `AppSetting` table (`kbiz.categoryMapping`),
editable at `/api/admin/kbiz-settings` without a deploy, seeded from
`DEFAULT_KBIZ_CATEGORY_MAPPING`. A bundle is one transfer and so gets exactly one
category: **dominant by amount** — the category holding the largest share of the
bundle's baht wins, unmapped receipt categories accumulate onto the default, and
an exact tie or an empty bundle resolves to the default, so the result never
depends on receipt ordering (`resolveKbizCategoryId`, pure and shared with the
UI preview).

**4 — The payee is a favourite, verified live.** The saved account is selected
from KBIZ's **favourites** by nickname — **`พี่วิว`** — and the account name KBIZ
resolves is cross-checked before the transfer is armed. Decision 4 stands
unchanged in substance: the bot never types an account number, and this app
stores none. The **custom-account path** (typing bank + account number) was also
built and verified live, as the escape hatch for a payee that is not yet saved;
it is not used by reimbursement, whose intents always carry a handle.

**5 — The intent's payee field is `payee: { handle }`.** The contract sketch
above shows `payeeNickname` + `payeeName`. What shipped in
`packages/shared/src/index.ts` (`KbizPaymentIntent`) is a single
`payee: { handle }` — an opaque bot-side handle that the bot's own gitignored
config resolves to a nickname or a custom account. Reimbursement no longer knows
or transmits which favourite is behind a handle, which keeps the "KBIZ owns the
account numbers" property even tighter than the sketch. The shipped intent also
carries `createdAt`, `kbizCategoryId`, and a `result` that may include `finalUrl`
+ `finishedAt`; `result.slipFile` is a **basename** under the shared `slips/`
dir, while `voucherFile` is a path **relative to the shared dir**
(`vouchers/<id>.html`). That asymmetry is intentional and both processes honour
it.

Implementation of the reimbursement side:
[CR-2026-08-12](../change-requests/CR-2026-08-12-kbiz-payment-automation.md).

**6 — One live approval push in the estate, ever.** Two incidents
(2026-08-12, 2026-08-13) showed the phone-tap gate (Amendment 2) is not
enough by itself: KBIZ's approval push lives SERVER-SIDE at the bank, not in
the bot's browser session, so any early exit of the post-Next wait loop —
session death, KBIZ's generic error page, an outright crash — leaves that
push tappable for minutes while a naive batch loop happily arms the next one
on top of it. Live-verified consequence: two outstanding pushes, one phone,
no banner distinguishing them (a push armed seconds after the previous tap
never surfaces at all), and an operator-visible "Retry" button pointed
straight at the same money.

`kbiz-bot/src/lib/arm-gate.ts` (pure decision) and `arm-lock.ts` (durable fs
state) close this. A conservative lock is written to
`<KBIZ_STATE_DIR>/kbiz-arm-lock.json` (default `../data`, `/app/data` in the
container) **before** the arming click — covering the form-fill window a
crash could land in — and is refined once the click actually fires. It is
released only when the flow can prove the push is no longer live; a crash is
never treated as proof, so a crashed run holds the lock until its
conservative window (~10.5 min) elapses. The invariant covers `transfer-other`
AND `transfer-payroll` alike: `process-queue.ts` **defers** (never skips or
forces through) any batch item that would arm a second push — its queue-file
`result.error` is prefixed `HELD: ` and a masked-destination line goes to
Slack. **Correction (2026-08-19):** a deferred item is filed **terminal
`failed`**, not "retried on a later poll once the lock clears" as this
paragraph originally claimed — `process-queue.ts` never re-queues it;
reimbursement returns the bundle to `APPROVED` and a **human** has to click
"จ่ายผ่าน KBIZ" again (`kbiz-bot/README.md` already had this right; this ADR
did not). A human running `transfer-other -- --confirm` under a live lock is
refused outright with the lock's expiry printed.

A batch also stops arming back-to-back on an unconfirmed or
bank-confirmed-failed predecessor even once the lock itself is clear: only a
confirmed *success* (and, since Amendment 7, a bank-confirmed *push-expired*)
keeps the gap-then-arm path open, because the inter-transfer gap only means
anything once the previous push actually resolved. **Correction (2026-08-19):
this held only WITHIN one batch, not across polls, and this ADR overstated it
as an estate property.** The mechanism was `prev` — a per-batch, in-memory
variable (`process-queue.ts`) that resets to "none" on every poll — and the
durable lock could not carry the same fact across a poll boundary because
`parseArmLock`'s `state === "released"` branch discarded the released lock's
`updatedAt`/`resolution` outright. For the one-item-per-poll shape the estate
actually runs (an approver pays requests one at a time, each landing in its
own poll), that made the back-to-back guard dead code across the one boundary
that mattered. What makes the claim true now, estate-wide: `parseArmLock`
surfaces `releasedAt`/`resolution`/`intentId` on a released lock instead of
discarding them, and `decideArm` reads them for `prev = none`/`not-armed` —
see Amendment 7.

## Amendment 7 (2026-08-19) — the back-to-back root cause, and the duplicate popup

Three more ad-hoc-transfer incidents (2026-08-12, 2026-08-13, 2026-08-18 — nine
transfers total, three independent operator episodes) kept happening even with
Amendment 6's one-push-at-a-time lock in place, because the lock only ever
*deferred a second arm*; it never explained why the *first* retry after a
held item kept failing too, nor closed the cross-poll gap described just
above. Full diagnosis: `kbiz-back-to-back-diagnosis.md` (read-only estate
audit, 2026-08-19). Fix spec: `kbiz-fix-spec.md` (same date).

**Root cause: whether the K BIZ app was FOREGROUND on the operator's phone at
the moment of arming — not elapsed time.** The discriminating variable across
all nine transfers, plus the operator's own manual back-to-back reproduction,
is app-foreground state, not the gap since the previous tap:
- **All three failures** armed 22–54 s after the operator's previous tap,
  with the operator sitting **inside K BIZ**, waiting for the next push. No
  banner ever surfaced — not on the lock screen, not inside the app itself.
  nginx's own access log for the 08-18 run shows the operator's phone Safari
  went **silent for a 105 s hole that contains the exact arming instant**
  (`15:41:12`→`15:42:59`, arm at `15:41:23.9`) — consistent with some other
  app (most plausibly K BIZ, opened to wait) being foreground instead.
- **All six successes** armed with K BIZ backgrounded or closed. In the
  operator's manual reproduction (2026-08-19, corrected same day: two test
  sessions ~2.5 h apart, each = one completed transfer + one identical
  initiation that was deliberately never completed), the **second push armed
  under 1 minute after the previous tap and surfaced normally on the phone**
  with K BIZ backgrounded — it was left untapped by choice, so it never
  became a completed transfer. Surfacing is the datum: it **refutes
  bank-side time suppression of the second push outright** — if elapsed time
  were the mechanism, that push should have stayed invisible exactly like
  the three incidents' pushes did.
- **The balance ledger and the bank's own screens** prove all three
  "unconfirmed" runs moved exactly ฿0 — nothing was silently double-spent
  while this was undiagnosed, but the operator was told the ambiguous English
  "may or may not have gone through" for a transaction the bank had already
  provably voided.
- **Bell-badge evidence**: the notification badge on the operator's phone
  drained during 3 of 3 failed arming windows and 0 of 5 eligible success
  windows — consistent with the push arriving but never surfacing as a
  banner while K BIZ itself was the foreground app.

H1 (a warm/exhausted KBIZ **session** as the cause) is refuted four
independent ways in the diagnosis (a warm second push still gets the bank's
full ~6 min window; the window keeps ticking normally on a warm session; a
warm session produced a clean success; a same-session, 0.387 s-apart batch
pair still got the full window). **Do not build forced re-login/session-reset
per transfer** — it fixes nothing here and multiplies the estate's exposure
to the announced June-2026 QR-login enforcement, turning a "second transfer
fails" bug into "every transfer fails".

The fix closes the loop with four changes, wired end-to-end 2026-08-19:
1. **The bank's own expiry modal is now recognised** as a new outcome,
   `push-expired` (Decision 3 above), instead of silently falling through to
   `unconfirmed` — see `kbiz-bot/src/lib/approval-wait.ts`.
2. **Arming is verified, not claimed**: the flow polls for the bank's own
   "notification sent" panel before firing the TAP-NEEDED ping or refining the
   arm lock's window — see `kbiz-bot/src/lib/post-next.ts`.
3. **The tap cooldown (`TAP_COOLDOWN_MS`, unchanged at 90 s) finally runs, and
   runs cross-poll** — the cross-poll hole this amendment's corrected
   paragraph above describes is closed by `arm-gate.ts`'s `decideArm` reading
   the released lock's own `resolution`/`releasedAt`, not just `prev`. Every
   TAP-NEEDED ping (not only ones inside a >1-item batch — see
   `kbiz-bot/src/lib/transfer-other-queue.ts`'s `tapNeededMessage`) now warns
   the operator explicitly: keep K BIZ **closed** until the ping, because a
   push armed while the app is open in the foreground can raise no banner at
   all.
4. **The value of `TAP_COOLDOWN_MS` is unchanged** — the sub-1-min successful
   pair refutes a bank-side cooldown, so the number's only remaining job is
   giving the operator time to leave the K BIZ app after a tap, and 90 s
   (already reviewed, already shipped, never previously executed) sits above
   the entire observed failure band (max 54 s). The 55–620 s band remains
   unobserved; `hf-tasks/tasks/wave-5.md:376`'s owner-gated ฿1 supervised pair
   is the only route to revising it.
5. **Releasing an ambiguous (PAYING + `paymentError`) payment now requires
   `force`** (spec-review finding 9, added to this amendment 2026-08-19 fix
   round): `POST /:id/payment-retry` used to skip its whole queue-proof block
   whenever `paymentError` was non-null and release straight to APPROVED,
   audited as `forced: false` — the one bundle state that means "the bank
   genuinely never said what happened" (PAYING + error is, by construction,
   the poller's `unconfirmed` verdict; `confirmed-failed` and `push-expired`
   both resolve forward to APPROVED and never reach this endpoint) was the
   one this endpoint policed LEAST. The non-forced `'retry'` confirm kind is
   removed from both approver screens; there is now exactly one
   release-to-APPROVED dialog, the blunt `force: true` one, and the approver
   must assert they checked K BIZ's ประวัติทำรายการ before releasing. See
   Decision 3's `unconfirmed` row above and `apps/api/src/routes/bundles.ts`.

**Known residual risk, left open on purpose (money review finding 3,
2026-08-19 fix round).** `push-expired`'s safety chain — precedence after
`SUCCESS_RE`, the `!LIVE_PUSH_RE` corroborant, the `EXPIRY_CONFIRM_MS` grace,
and the `slip.reference` downgrade to `unconfirmed` — rests on one
unverified assumption, named explicitly in the diagnosis (§6, undetermined
item 4): whether KBIZ's expiry modal reflects the BANK's own verdict or a
CLIENT-SIDE countdown that can render before the bank has actually voided a
tap accepted in its final second. If the modal is client-side and the bank's
own slip page never renders in that browser session (no reference to catch
the downgrade on), a same-second tap could in theory produce a no-force
retry. This is accepted, not fixed, because: (a) the diagnosis could not
determine which is true without a live-verified adversarial test against the
bank in its final second, which is out of scope here; (b) the reference
downgrade is a real, tested guard, just not a proof against every timing;
(c) the alternative — holding EVERY `push-expired` at `needs-review` behind
`force` — would reintroduce the exact friction this amendment exists to
remove, for a window (the bank's literal last second) with zero observed
occurrences in the record. `hf-tasks/tasks/wave-5.md:376`'s owner-gated ฿1
supervised pair is the natural place to resolve this empirically.

**The duplicate-transaction popup (new, unrelated failure mode, same date).**
On an exact duplicate — same payee, same amount — KBIZ raises a web
confirmation dialog (`แจ้งเตือน` / "ท่านหรือบริษัทมีการทำรายการนี้ไปแล้ว
กรุณายืนยันที่จะทำรายการนี้อีกครั้งหรือไม่", ยกเลิก / ยืนยัน) **before** sending
the phone push, user-verified 2026-08-19 via screenshot. It appears in **0 of
the 9** production transfers audited for this amendment, but a retry of a
held item is exactly the shape that triggers it, so the bot has to handle it
rather than stall silently for the full ~6.5 min window. Policy (fail-closed),
hardened once more in the same-day fix round after adversarial review found
two more ways it could auto-confirm on top of a payment that already moved:
the bot presses ยืนยัน only when (a) a queue/archive scan finds **no prior
attempt AT ALL on this bundle** — ANY status, not only a terminal one, since
`running`/`approved` are MORE suspicious than `failed`, not less (money
review finding 1) — **and** (b) no OTHER bundle has a prior attempt at the
SAME destination + SAME amount **within the last 14 days** (money review
finding 2: KBIZ's own duplicate predicate is payee+amount, not bundle, so a
resubmitted receipt after an `unconfirmed` original — a brand-new bundle id —
would otherwise defeat the bundle-only guard entirely). KBIZ's own duplicate
check keys on a transaction that **actually went through**, so a popup plus
either kind of prior attempt is the bank saying that earlier attempt paid,
and confirming again would be the double-pay. A refusal aborts **pre-arm**
(no push exists yet — the popup precedes the push) and is filed `HELD:`,
same mechanism a gate defer already uses. See `decideDuplicateConfirm` in
`kbiz-bot/src/lib/transfer-other-queue.ts`.

**The 14-day window (`SAME_MONEY_WINDOW_MS`, money review finding 6, second
fix round) is bounded, not open-ended.** The (b) check first shipped scanning
the archive's ENTIRE lifetime with no bound at all — fail-closed (a false
positive only ever holds a legitimate payment, never lets a double-pay
through), but it meant a recurring same-payee/same-amount payment (monthly
rent, a fixed vendor retainer) would be `HELD:` on every single occurrence,
forever, with no way to clear it except renaming the payee or changing the
amount. 14 days is a deliberately generous, unevidenced operator-side
default — there is no live observation of KBIZ's own duplicate-detection
window (the popup remains 0 of 9 production arms) — chosen to comfortably
cover the realistic "bundle sticks at `unconfirmed`, gets resolved in K BIZ
over a day or two, receipt gets re-filed" recovery cycle this guard exists
to catch, while still expiring well before next month's recurring payment
falls due. A candidate match with no parseable `createdAt` (or a caller that
omits `now`) is still treated as inside the window — the bound relieves
friction, it never opens a gap.
