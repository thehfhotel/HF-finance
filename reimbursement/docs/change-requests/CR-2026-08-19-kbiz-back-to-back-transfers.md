# CR-2026-08-19: KBIZ back-to-back transfer fix + duplicate-popup handling

Implements [ADR 0001, Amendment 7](../adr/0001-kbiz-transfer-automation.md#amendment-7-2026-08-19--the-back-to-back-root-cause-and-the-duplicate-popup).
Five engineers (IMPL-A through IMPL-E) implemented this in parallel on disjoint
files against a locked interface spec, all landing in one commit. This CR
records what changed and why; the full diagnosis and spec are the source of
record and are not duplicated here in full.

## What was asked

Three ad-hoc-transfer incidents (2026-08-12, 2026-08-13, 2026-08-18) kept
recurring even after ADR 0001 Amendment 6's one-push-at-a-time arm lock
shipped: a second KBIZ approval push, armed seconds after the operator's
previous tap, never surfaced on their phone. The bot waited out its own 6.5
min timeout and filed the transaction as English "may or may not have gone
through" — for a transaction the bank had already proven moved ฿0.

## Root cause (see the ADR amendment for the full evidence)

**Whether the K BIZ app was foreground on the operator's phone at the moment
of arming — not elapsed time.** All three failures armed 22-54 s after a tap
with the operator waiting inside K BIZ; all six successes armed with the app
backgrounded or closed. In the operator's manual reproduction (2026-08-19,
corrected: each of two sessions was one completed transfer plus one identical
initiation left deliberately uncompleted) the second push armed <1 min after
the previous tap and SURFACED on the phone with the app backgrounded. A
bank-side time cooldown is refuted by that sub-1-min surfacing — completion
was withheld by choice, not by the bank. A warm/exhausted browser session (H1) is refuted four
independent ways and was explicitly **not** built around (it would multiply
exposure to the announced June-2026 KBIZ QR-login enforcement).

A second, previously undiagnosed mechanism — KBIZ's own duplicate-transaction
popup — was found separately (user-verified 2026-08-19 via screenshot) and
folded into the same fix: it appears before the phone push on an exact
same-payee/same-amount duplicate, and it needs explicit, fail-closed handling
or the bot stalls on it silently, indistinguishable from the original bug.

**Follow-up, same day:** the operator captured the popup's real DOM live
(devtools `copy(document.body.outerHTML)`). It proved the first shipped
selector set inert — the dialog is Magnific Popup (`.mfp-content` >
`#popup-duplicate.white-popup-block`, no `.modal`/`[role=dialog]`), and the
action "buttons" are href-less `<a class="btn">` with the label in a nested
`<span>`, so both `getByRole("button")` and `getByRole("link")` matched
nothing. The structure is pinned in
`kbiz-bot/test/fixtures/kbiz-duplicate-popup.dom.html` (scrubbed) and
`kbiz-bot/src/probe-duplicate-popup-dom.ts` drives the real
`clickDialogButton` against it (4/6 RED pre-fix → 6/6 GREEN). Trigger
window, as far as verified: in BOTH manual sessions the popup fired on an
identical (same payee + same amount) re-initiation **~1 minute after that
session's completed transfer**. The two sessions were ~2.5 h apart, but each
popup referenced its own session's completed transfer, so only the
within-session (~1 min) window is proven; whether the bank's duplicate check
also spans hours or the whole day is unconfirmed.

## What changed

- **New fourth outcome, `push-expired`** (`success | confirmed-failed |
  unconfirmed | push-expired`), everywhere the vocabulary is declared:
  `kbiz-bot/src/lib/approval-wait.ts`, `reimbursement/packages/shared/src/index.ts`,
  `kbiz-bot/src/lib/shared-contract.ts` (drift pin), and every consumer in
  between. KBIZ's own expiry modal — previously invisible to every regex — is
  now recognised and filed honestly instead of falling through to
  `unconfirmed`.
- **Arming is verified, not claimed** (`kbiz-bot/src/lib/post-next.ts`, new):
  the flow polls for the bank's own "notification sent" panel before firing
  the TAP-NEEDED Slack ping or refining the arm lock's window.
- **The cross-poll cooldown gap is closed**: `arm-gate.ts`'s `parseArmLock`
  used to discard a released lock's `resolution`/`updatedAt`; it now surfaces
  them, and `decideArm` reads them so a tap from *one poll ago* still gates
  the next arm, not just an arm within the same batch. `TAP_COOLDOWN_MS` (90 s,
  unchanged value, renamed from `INTER_TRANSFER_GAP_MS`) finally runs.
- **The duplicate-transaction popup** is detected and handled: auto-confirmed
  only when a queue/archive scan finds no prior attempt (any status) on the
  same bundle AND no prior attempt at the same destination + amount under a
  DIFFERENT bundle; refused (and filed `HELD:`, pre-arm) otherwise.
- **Every TAP-NEEDED ping** now says explicitly: keep K BIZ closed until the
  ping, because a push armed while the app is foreground can raise no banner.
- **The unconfirmed-retry double-pay gap is closed**: the `bundles.ts` retry
  endpoint now keys its `force` requirement on `paymentError !== null`
  (which, by construction, is the poller's `unconfirmed` verdict) instead of
  skipping the whole proof block whenever an error was set.

No new bundle status, no Prisma migration, no new `Bundle` column, no change
to `POST /:id/pay`, no auto-resolution of `unconfirmed` in either direction.
`push-expired` and `confirmed-failed` both land as `APPROVED` + `paymentError`
set (retryable, no force); `unconfirmed` stays `PAYING` + `paymentError` set
(force + blunt confirm dialog) — the existing `(status, paymentError)` pair
already discriminates every case, exactly as `schema.prisma:24` documents.

## Ownership (disjoint files, one locked interface)

| | scope |
|---|---|
| IMPL-A | `approval-wait.ts`, new `post-next.ts`, new `test/fixtures/*` (6 files) — the detector |
| IMPL-B | `arm-gate.ts`, `arm-lock.ts`, this ADR amendment, `kbiz-bot/README.md`, `kbiz-bot/CLAUDE.md` — the gate |
| IMPL-C | `process-queue.ts`, `transfer-other-queue.ts` — the queue |
| IMPL-D | `transfer-other-flow.ts`, `finalize-transfer.ts` — the flow |
| IMPL-E | `packages/shared/src/index.ts`, `kbiz-poller.ts`, new `kbiz-outcomes.ts`, `bundles.ts`, `Review.tsx`/`Desktop.tsx`, `shared-contract.ts`, new `apps/api/test/kbiz-poller.test.ts` — the app + cross-repo pin |

Full spec (interface lock, copy table, per-implementer worksheets, cross-checks):
`kbiz-fix-spec.md`. Full diagnosis (evidence, timelines, ruled-out hypotheses):
`kbiz-back-to-back-diagnosis.md`. Both were working documents outside this
repo during implementation; this CR + the ADR amendment are the durable
record.

## Fix round (2026-08-19, adversarial verification before commit)

An independent test gate, money-path review and spec-conformance review ran
against the five-implementer build above, before any commit. Every CONFIRMED
finding was fixed; the one PLAUSIBLE finding (a residual, unverifiable timing
assumption in `push-expired`'s safety chain) was investigated and is recorded
as an accepted, open risk in the ADR amendment rather than changed — see
"Known residual risk" there. Highlights (full findings + fixes are in the
session transcript, not duplicated here):

- **CI-blocking**: `apps/api/test/kbiz-poller.test.ts` originally imported
  `classifyOutcome`/`HANDLED_OUTCOMES` straight from `kbiz-poller.ts`, which
  imports `./db` → `@prisma/adapter-pg` at runtime — a dependency absent from
  root `bun test`'s no-workspace-install run. Extracted to a new
  dependency-free `apps/api/src/kbiz-outcomes.ts`; `kbiz-poller.ts`
  re-exports it unchanged.
- **Two double-pay gaps in the duplicate-popup guard**: `readPriorAttempts`
  dropped `running`/`approved` siblings (the statuses that most mean "may
  have paid") behind a terminal-status filter — removed. The guard was also
  bundle-scoped only, while KBIZ's own duplicate check is payee+amount-scoped
  — added a same-destination-+-amount check across bundles
  (`destinationSignature` in `transfer-other-queue.ts`).
- **A re-detected duplicate popup after the confirm click** fell through
  silently into the ordinary 6.5-min wait instead of being handled
  immediately — added an explicit branch in `transfer-other-flow.ts`.
- **Money-copy contradiction**: the "a scraped reference means money moved"
  suffix was appended to `confirmed-failed`'s text too, where a bank
  REJECTION page can legitimately carry a reference for the failed attempt —
  removed from that branch only (`finalize-transfer.ts`); the reference still
  rides on the result object.
- **Placeholder/undefined leaks in duplicate-popup copy**: `duplicateHeldText`
  / `duplicatePopupMessage` now branch on `reason` instead of substituting a
  placeholder string or interpolating an absent `detail`.
- **Cross-poll gate fail-open**: an unparseable `updatedAt` on a released lock
  now falls back to the lock file's own mtime instead of disabling the entire
  cross-poll cooldown; a `releasedAt` in the future (clock skew) now clamps
  to age 0 instead of overshooting the cooldown.
- **English-locale gaps, PARTIALLY fixed, pending a real English expiry
  dump**: `PUSH_EXPIRED_RE` gained an (inferred, pending live confirmation)
  English alternation and case-insensitivity to match its two same-day
  siblings; the duplicate dialog's own click-scope hint
  (`DUPLICATE_DIALOG_HINT`) is now bilingual to match the detector it was
  already paired with, and the button-name match tightened to `exact: true`
  at the same time (an English "Confirm" would otherwise substring-match this
  page's own "Confirm the transaction" button). What this does NOT close:
  `classifyFrame` checks `SESSION_DEAD_RE` before `PUSH_EXPIRED_RE`, and
  `SESSION_DEAD_RE` still matches bare `/expired/i` — so the single most
  likely real English expiry string, "This transaction has expired", still
  resolves to `session-dead` → `unconfirmed` + `pushMayBeLive: true`, not
  `push-expired`. Fail-closed (money review finding 4's scenario (b)
  verbatim, not a regression) and honestly flagged in
  `approval-wait.ts`'s own comment, but not the closed gap this bullet used
  to imply — narrowing `SESSION_DEAD_RE` needs a real English expiry dump to
  confirm the inferred wording against first (0 of 9 captured so far).
- **`reference` was dropped at the queue boundary on every failure path** —
  now carried through `mapFlowOutcomeToPatch`'s failure branches and
  `process-queue.ts`'s pass-through, matching the success arm.
- Plus: rounded `gapSeconds` in Slack copy (was printing fractional seconds
  like "59.197s"), removed a stale WHY-comment that contradicted the arm-time
  seam eight lines below it, and this ADR amendment now records the
  reimbursement-side force-gate change and the residual `push-expired` risk.

**Deliberately NOT changed, per ADR §6 / spec §6 "out of scope"**: a
`push-expired` bundle's activity-feed / `stats/overview.ts` visibility. It
already inherits the existing `payment-failed` ALERT kind (APPROVED + error)
correctly; a separate ACTIVITY-TIMELINE gap (spec review finding 10 — the
`payment-expired` audit type is not in `ACTIVITY_EVENTS`/`ACTIVITY_LABEL`, so
a bank-voided transfer leaves no visible trace in the ภาพรวม timeline) falls
under the same explicit "no `stats/overview.ts` work" boundary and is
recorded here rather than fixed, for a future change to pick up.

## Second fix round (2026-08-19, same day — a re-verification pass on top of the first)

A second adversarial verification pass ran against the fix round above and
found 6 residual LOW-severity defects, none blocking the money path. All 6
fixed here:

- **Stale pass count** in this doc's own Status line (438, left over from an
  intermediate count 432→438 that predated 18 more tests landing) — corrected
  to the actual 456.
- **ADR Amendment 7 item 5** pointed readers at "Decision 3's `unconfirmed`
  row **below**" when Decision 3 sits ~340 lines **above** it, and Decision 3
  itself never mentioned that releasing `unconfirmed` now needs `force` —
  fixed the cross-reference direction and added the `force` clause directly
  to Decision 3's `unconfirmed` bullet.
- **`clickDialogButton` (`transfer-other-flow.ts`) conflated "found no
  button" with "clicked, then the action threw"** — both returned a bare
  `false`, and the duplicate-popup confirm caller read that as `pushMayBeLive:
  false`, releasing the estate-wide arm lock on a click that may have already
  registered with the bank (a regression relative to the ORIGINAL pre-first-
  fix-round behavior, `pushMayBeLive: true`). Now a tri-state
  (`"clicked" | "not-found" | "click-failed"`), with a `clicked` flag set
  BEFORE each `.click()` call; the caller reports `pushMayBeLive: true` only
  for `"click-failed"`. Pinned with a structural guard in
  `finalize-transfer.test.ts` (the flow itself is not importable from a pure
  test — it pulls playwright).
- **`Math.round(gapMs / 1000)` (spec finding 7) landed with no test exercising
  a genuinely fractional `gapMs`** — the existing `pauseBeforeArmMessage`
  tests only ever passed a pre-rounded `gapSeconds: 90`, so reverting the
  rounding back to a bare `gapMs / 1000` would have stayed green. Added a
  cross-poll-remainder case (`gapMs: 59_197`, the exact shape
  `arm-gate.test.ts:731` already pins) plus a structural guard on
  `process-queue.ts`'s two call sites.
- **The double-pay fix (money finding 1, `readPriorAttempts`'s dropped status
  filter) shipped with no regression test** — `process-queue.ts` is
  unreachable from root CI, and nothing pinned the fix in
  `arm-gate.test.ts`'s existing "process-queue.ts wiring" describe block,
  the place this repo already pins the file's other untestable invariants.
  Added: re-introducing the terminal-status filter now fails that test.
- **"English-locale gaps FIXED" overstated what shipped** — see the "Fix
  round" bullet above, reworded to disclose that `SESSION_DEAD_RE` still
  wins over the new (inferred, unconfirmed) `PUSH_EXPIRED_RE` English
  alternation for the single most likely real string ("This transaction has
  expired"). Fail-closed, not a regression, and already honestly flagged in
  `approval-wait.ts`'s own comment — only this doc's summary overclaimed it.
  No code change; narrowing `SESSION_DEAD_RE` needs a real English expiry
  dump first.
- **The cross-bundle same-destination-+-amount check (money finding 2) had no
  time bound** — money review finding 2's own recommendation ("within the
  last N days") was never implemented, so a recurring same-payee/same-amount
  payment (monthly rent) would be `HELD:` on every occurrence, forever, with
  scan cost growing with the archive. Added `SAME_MONEY_WINDOW_MS` (14 days)
  in `transfer-other-queue.ts`, a `createdAt` field on `PriorAttempt` fed by
  `readPriorAttempts`, and an optional `now` on `decideDuplicateConfirm` —
  omitting `now` (or a candidate match with no parseable `createdAt`)
  preserves the old unbounded, fail-closed behavior. ADR Amendment 7 updated
  to disclose the bound and its rationale.

Root `bun test` after this round: 467 pass / 12 skip / 0 fail, 22 files
(unchanged file count — no new test files, only new `it`s in existing
suites; +11 over the 456 the first fix round ended on). `kbiz-bot` own
suite: 280 pass / 0 fail, 10 files. `kbiz-bot`/`reimbursement` typechecks
green. `reimbursement` suite unchanged at 127 pass / 12 skip / 0 fail (no
reimbursement-app code touched this round, docs only).

## Status

**BUILT 2026-08-19, two fix rounds applied same day** — all five implementers
landed, then an adversarial test/money/spec review ran and every CONFIRMED
finding was fixed (see "Fix round" above), then a second, independent
re-verification pass found and fixed 6 more LOW-severity residuals (see
"Second fix round" above). Root `bun test`: 467 pass / 12 skip / 0 fail, 22
files (`kbiz-bot` and `reimbursement` typechecks green). Not deployed by this
change (no git add/commit/push was performed as part of implementation —
deploy is a separate, explicit step).
