# CR-2026-08-14: ภาพรวม redesign — cash-out windows + Vendor v1

## What

Two changes, shipped together because the second is what makes ตามร้านค้า
possible in the first:

1. **ภาพรวม (approver overview) rebuild.** Replaces every all-time aggregate
   on the page with day/week/month **cash-out windows**, adds a
   drill-down-to-requests grammar over the whole screen, and enforces a
   single denominator per window. Rides the existing `GET
   /api/bundles/stats` endpoint — no new route.
2. **Vendor v1.** A first-class `Vendor` row, matched from the receipt's free-text
   `merchant` field, created lazily on save. Backs a new ตามร้านค้า breakdown
   card and an autocomplete on the receipt form. No merge/rename UI — see
   Follow-ups.

### The basis, stated once

Everything on the redesigned page is **CASH-OUT**: a bundle counts in a window
iff `status = PAID` and `paidAt` falls inside it, evaluated in **Asia/Bangkok**,
weeks starting **Monday**. There is no second denominator anywhere on this
screen — every breakdown card's `coverage.windowTotal` is required to equal
the active ladder tile's total, byte for byte. That equality is the fix for
the failure mode the design director rejected in the current page: today's
เดือนนี้ ladder figure and today's หมวดหมู่ breakdown are computed from two
different queries with two different scopes (one cash-out, one all-time), so
they silently disagree and nobody notices which one is "right."

### The ladder

Three windows — วันนี้ / สัปดาห์นี้ / เดือนนี้ — ship on **every** request
regardless of which one is selected, so switching the active tile repaints
instantly from cached data; only the breakdowns below it refetch. Each tile
carries a delta against its like-for-like prior window (`เทียบ 1 – 14 ก.ค. ▼
12%`), computed server-side so the client never re-derives a percent, a
"more than 5×" phrasing, or a "no data to compare" state.

### Drill-down-to-requests grammar

Every tile, bar, and row on the page — ladder, queue, alerts, breakdowns,
speed, decisions, owed, activity — opens the **same** drill panel, and every
drill resolves to real bundle ids from the response's own `bundles`
dictionary. Two things this rules out, on purpose:

- **No client-side re-summing.** A drill header's total is always the
  server-computed aggregate for that group, never a sum of the rows visibly
  rendered (which may be truncated to the id cap).
- **No new navigation surface.** A row in a drill panel calls the same
  `onOpenBundle(id)` the rest of the approver console already uses — desktop
  selects the bundle inside the existing inbox split-view, phone pushes the
  existing bundle-review route. There is no new screen and no new URL; the
  whole redesign is additive to one existing endpoint's response shape.

### Four numbers that will visibly change on launch day

These are the ones an approver who used yesterday's ภาพรวม will notice
immediately. None of them are bugs in the new page — they are the old page's
numbers being replaced by ones with an honest, stated scope.

1. **หมวดหมู่ / สาขา totals rescope from all-time-all-status to
   paid-in-window.** Today's `byCategory` / `byProperty` sum every receipt
   on every bundle ever created, in any status (draft, pending, rejected —
   all of it). The new `byCategory` / `byVendor` / `bySubmitter` / `byProperty`
   sum only receipts on bundles that were actually **paid inside the
   selected window**. Expect the visible numbers to drop sharply and to reset
   with each window change — that is the point; a category total that used
   to include money never actually paid out was never a real cash-out figure.
2. **ใบเสร็จลอย (loose receipts) goes org-wide and moves upward.** Today's
   `drafts` counts only the signed-in approver's own unbundled receipts. The
   replacement, `queue.orphanReceipts`, is **every** receipt across the whole
   org with `bundleId IS NULL`. This is a deliberate scope widening — the
   queue zone exists so any approver can see the whole backlog, not just
   their own corner of it — and the number on day one will likely be larger
   than anyone has seen on this page before.
3. **The 12-month trend chart is gone.** Its "is this a normal month?" job
   moves to the ladder's delta chip, which answers the same question against
   a like-for-like prior window instead of a shape drawn from a full year of
   history.
4. **The all-time `จ่ายเดือนนี้ · n คำขอสะสม` and all-time `ปฏิเสธ` KPIs are
   deleted.** They are superseded by the month ladder tile (cash-out,
   `paidAt`-based, this window only) and `decisions.rejected` (window-scoped,
   sourced from the reject audit event, not a running total).

The six fields most of the app actually reads today — `pending`, `approved`,
`paying`, `paid`, `rejected`, `drafts` on `BundleStats` — are unchanged in
type and meaning; only `byCategory`, `bySubmitter`, `byProperty`, and
`paidByMonth` are removed, and their sole consumer was the rewritten
`Overview.tsx`.

### The Bangkok-timezone fix

Every timestamp column is `TIMESTAMP(3)` with no time zone, stamped by a
UTC container clock. Today's monthly breakdown does a **naive** `date_trunc`
on that column, which means every payment between 00:00 and 06:59 Bangkok
time has always been filed under the *previous* calendar day/month. The new
queries do the double cast (`… AT TIME ZONE 'UTC' AT TIME ZONE
'Asia/Bangkok'`) everywhere a Bangkok wall-clock boundary matters. Consequence
worth flagging to whoever reviews launch-day numbers: a handful of historic
early-morning payments will appear to move between calendar days/months
compared to any total pulled from the old query — that is the bug being
fixed, not new data drift.

### One request, gated

The whole page still rides `GET /api/bundles/stats`; no new params were added
to the plain `GET /bundles` list. The analytics block is a new optional
`overview` field on the existing response, present **only** when the request
carries `?window=day|week|month` — the two boot calls `App.tsx` already makes
never send it, so they stay exactly as cheap as they are today, verified by
diffing a no-params response before and after this change. `overview` is
**approver-only**: a non-approver sending `?window=` gets `403`, because
`queue.orphanReceipts.byUser` is other people's receipts and bundles have
never been scoped that way to non-approvers before.

`?property=hf-hotel|hf-ville` re-scopes §3 onward but **not** the queue or
alert zones, which stay org-wide and live regardless of the property filter —
those two carry the `ตอนนี้` badge precisely to signal "this ignores your
filters." Property itself is a **receipt**-level column, not a bundle field:
a bundle whose receipts span both properties reports different totals under
each property chip, and its bundle-level amount (unfiltered) is always
available alongside the property-sliced amount so a drill row can show
"จาก ฿8,920 ทั้งคำขอ" when the two differ.

### Section order (unchanged between desktop and phone)

แถบเตือน → ต้องจัดการตอนนี้ → เงินจ่ายออกจริง (ladder + property pills) →
จ่ายออกรายวัน → เงินไปไหน → เกิดอะไรขึ้นในงวดนี้ → ความเร็วในการทำงาน →
ผลการตัดสิน → ใครยังรอเงินอยู่ → ความเคลื่อนไหวล่าสุด. No segmented control, no
tab bar, no duplicate KPI row — the three ladder tiles are the page's only
period control.

## Why

The old page had no single answer to "how much did we pay out this month?"
— the ladder-equivalent figure and every breakdown below it were separate
queries with separate, silently mismatched scopes (some all-time, some
current-month, one self-scoped to the viewer). A design review rejected
that outright: two same-named numbers with two different denominators on one
screen is the exact failure this rebuild exists to close. The
one-window-one-denominator rule (every breakdown's `coverage.windowTotal`
equals the active ladder total) is the mechanical fix; the drill-down grammar
is what lets an approver actually trust a number by tracing it to the
requests behind it instead of taking the aggregate on faith.

Vendor v1 exists because "เงินไปไหน" is incomplete without "ที่ไหน" —
merchant was always free text, so the same shop appears as a dozen spelling
variants and can't be grouped, ranked, or autocompleted. The fix is a
matched, first-class `Vendor` row rather than teaching the reporting layer to
fuzzy-group raw strings at query time.

## Vendor v1

### Model

A new `Vendor` table (`id`, `name`, `normalizedName` unique, `createdAt`) and
a nullable `Receipt.vendorId` foreign key, `onDelete: SetNull`. `merchant` is
never dropped — it stays the receipt's own record of what was typed;
`vendorId` is a derived pointer that a future merge/rename tool could safely
repoint without touching the receipt.

### Matching — normalized once, in the database

Vendors are matched on `normalizedName`: lowercased, whitespace-collapsed,
trimmed. That rule lives in exactly one place, a Postgres function
(`vendor_normalize()`), and is **not** re-implemented in TypeScript anywhere
— a hand-mirrored JS version and the SQL version would eventually disagree on
an edge case (Unicode whitespace variants, for one), and the lazy upsert and
the one-time backfill have to agree on every string bit-for-bit or the
backfill creates duplicate vendors the running app will never reuse.

### Lazy upsert

Every receipt POST/PATCH that touches `merchant` resolves it to a `vendorId`
through a single `INSERT … ON CONFLICT (normalizedName) DO UPDATE … RETURNING
id` statement — one round trip, no read-then-write race, no TypeScript-side
normalization. A blank or whitespace-only merchant resolves to `null` and
creates no vendor row; that receipt keeps grouping by its raw (empty) string
in ตามร้านค้า rather than being forced into a bucket.

### Backfill

A one-time, **idempotent** migration step: one vendor per distinct normalized
merchant across every existing receipt (the display `name` takes the
*oldest* receipt's spelling — the earliest way the team actually wrote it,
not an arbitrary row), then every existing receipt is linked to its match.
Re-running both steps is a no-op — `ON CONFLICT DO NOTHING` on the unique
normalized name, and the link step only touches rows where `vendorId IS
NULL`.

### Autocomplete

`GET /api/vendors?q=&limit=` — authenticated, **no role gate** (every
employee types merchant names, so every employee gets suggestions), prefix
matches ranked above substring matches, most-used vendors returned when `q`
is empty. Wired onto the existing ร้านค้า field on both the employee upload
screen and its desktop equivalent as a popover, not a replacement — picking a
suggestion only fills the text field with the vendor's canonical spelling; it
never posts a `vendorId` directly, so there remains exactly one path to a
resolved vendor (the server, on save). A failed or slow suggestion request
never blocks a save; the field keeps working as free text either way.

### Stats grouping

A new `byVendor` breakdown card joins receipts to vendors, grouping key
`v:<vendorId>` when linked or `m:<normalized merchant>` as a fallback for
unlinked receipts (blank-merchant rows, and anything saved before this
ships that the backfill's `<>''` guard skipped). Same shape, same drill
behavior, same coverage/denominator rule as every other breakdown on the
page.

### Explicitly out of scope for v1 (follow-ups)

- Vendor admin screen — no way to browse, rename, or delete a vendor yet.
- Merge UI — two vendors that turn out to be the same shop (a rebrand, a
  second location typed differently enough to dodge normalization) cannot be
  combined; each stays its own row.
- Alias table — no many-spellings-to-one-vendor beyond what
  `vendor_normalize()` folds automatically.
- Fuzzy / trigram matching — only exact-after-normalization matches merge;
  "แม็คโคร" and "แมคโคร" (missing tone mark) remain two vendors.
- Renaming a vendor's canonical `name` after creation.
- Vendor-level budgets or spend limits.
- Any tooling to re-run the backfill against new data after the initial
  migration.

Each of these is a real, requested capability that got cut to ship v1 with a
correct, narrow foundation (one normalization rule, one lazy-upsert path)
rather than a merge/alias model designed under time pressure.

## Dev/ops notes

- **`prisma db push` does not create `vendor_normalize()`; `bun run db:seed`
  does.** The function is created by the hand-written migration SQL, and
  `db push` only diffs the Prisma schema — it does not run arbitrary
  `CREATE FUNCTION` statements. The seed applies the same
  `CREATE OR REPLACE FUNCTION` definition itself (`VENDOR_NORMALIZE_DDL` in
  `apps/api/prisma/seed.ts`, run alongside the two backfill statements), so
  the working sequence for a dev DB is `bun run db:up` → `bunx prisma db push
  --accept-data-loss` → `bun run db:seed`. **Seed after pushing:** a database
  that is pushed but never seeded has no function, and every vendor-aware
  query — the upsert, `GET /api/vendors`, and ตามร้านค้า — fails outright
  rather than silently degrading. No manual `psql` step is needed.
- **New indexes** land in the same hand-written migration as the `Vendor`
  table: `bundles(status, paidAt)` and `bundles(status, submittedAt)` for the
  cash-out and queue/flow scans, `bundles(submittedAt)` on its own because the
  flow query's intake arm carries no status beside it and the composite's
  leading column is therefore unusable, `bundles(approvedAt)` for speed metrics,
  and four `receipts(bundleId, …)` composites for category/vendor/property/
  orphan queries, plus `audit_events(type, createdAt)` for rejections and
  withdraws. Per the standing rule in this repo, this was hand-written under
  `apps/api/prisma/migrations/`, never via `prisma migrate dev`.
- **`HF Hotel` / `HF Ville`** remain the page's only non-Thai strings
  (`PROPERTY_LABELS`, unchanged by this work) alongside every other screen in
  the app. Flagging again here because the redesign surfaces the property
  pills more prominently than before; fixing it is a product decision
  upstream of this CR, not something folded into this change.

## Risk / rollback

Additive on every axis that matters for rollback: the `Vendor` table and
`Receipt.vendorId` are new, nullable, additive schema; the new indexes carry
no behavior change on their own; `overview` is a new optional response field
gated on a query param the two existing boot calls never send. Rolling back
to the previous image simply stops emitting `overview` and stops resolving
vendors on save — no data written by this change becomes invalid, and
`onDelete: SetNull` means a future rollback of the `Vendor` table itself
would not cascade into deleting receipts.

The one non-additive change is the **removal** of `byCategory`, `bySubmitter`,
`byProperty`, `paidByMonth` from `BundleStats` — a breaking change for any
external client of this endpoint. Verified before removal that the only
consumer in this codebase was the rewritten `Overview.tsx`; there is no
public API contract with an outside consumer for this endpoint.

Watch for, in the first week live: the ใบเสร็จลอย count landing much higher
than anyone expects (§ "Four numbers," item 2 — this is intended, not a bug
report to act on by itself) and any approver asking why a category total on
this page no longer matches a number they remember from before this shipped
(§ item 1 — same answer, different scope, on purpose).

## Review round: decisions recorded here rather than in code

Three design mandates could not be honoured as written. They are recorded as
accepted deviations so a later reader does not re-raise them as defects.

- **Mandate 38(a) — the ตามผู้เบิก `จ่ายแล้ว / รออนุมัติ / ปฏิเสธ` chip set is
  NOT shipped.** The mandate calls it the page's one deliberate scope escape,
  but the payload has no per-status id sets for a submitter, and every figure
  on this page is a cash-out figure by the basis stated at the top of this CR.
  Expressing it needs a contract change (`bySubmitter.rows[].statusSets`) plus
  the queries behind it, which is a release of its own. Waived for v1; the
  ตามผู้เบิก drill ships without a nested chip strip and its header claims no
  `ทุกสถานะ · ตอนนี้` scope it cannot deliver.
- **Mandate 38(b) — the ตามสาขา mini category list IS a control now.** Each row
  re-scopes the panel to that branch+category pair. The pair carries its own
  ids and per-bundle slices from the server rather than being intersected on
  the client, because intersecting `byCategory` with `byProperty` would hand a
  mixed-branch bundle's whole category spend to one branch.
- **Mandate 30 — the desktop platform split for queue tiles 1–3 is
  superseded.** It asks tiles 1–3 to swap the master-detail pane on desktop
  while tile 4 opens the drill. That contradicts mandate 29, which specifies
  nested age-band and approvedAt-sorted DRILLS for those same tiles, and it
  contradicts the approved mockup, whose desktop pane opens the drill for all
  four. The mockup and mandate 29 stand: every tile opens the drill on both
  platforms, and the drill's own `เปิดในกล่องอนุมัติ →` footer is the escape
  into the pane.

Three behaviours changed during review and are visible to an approver:

- **ผลการตัดสิน prints `—` under a branch chip.** Rejecting a bundle returns
  its receipts to the submitter, and property lives on the receipt — so a
  rejection cannot be attributed to a branch. `ปฏิเสธ` stays org-wide while
  `อนุมัติ` is branch-scoped, and a ratio over two different populations is
  worse than no ratio. The card says so in Thai and the reasons list still
  renders. Under `ทุกสาขา` nothing changes.
- **ตามผู้เบิก drill rows carry `จาก ฿X ทั้งคำขอ` under a branch chip.** All
  four เงินไปไหน dimensions are branch-sliced so all four add back to the same
  denominator. Under `ทุกสาขา` a submitter's slice IS the whole bundle and the
  annotation never appears, which is the state the mandates describe.
- **ใบเสร็จลอย prints `แสดง n จาก m ใบเสร็จ`** when an employee holds more
  loose receipts than the payload shipped, instead of expanding shorter than
  the group header promised.

## Plan/tree mismatches, recorded not fixed

- `apps/web/src/App.tsx` is listed as "modify" in the implementation contract's
  ownership table but is untouched. The required behaviour — the two boot
  `stats()` calls unchanged, plus a `(window, property)`-keyed overview fetch
  that only runs while the overview is mounted — is satisfied by
  `useOverviewStats` co-located in `ApproverOverview` instead.
- `apps/web/src/screens/employee/_shared.tsx` was modified though it is not in
  that table; it is inside the web engineer's `apps/web/**` boundary and hosts
  the shared `MerchantAutocomplete` both employee screens use.
- This CR's filename is `CR-2026-08-14-overview-analytics-vendors.md`, not the
  table's `CR-2026-08-14-overview-redesign-and-vendors.md`. The only
  cross-reference — `CLAUDE.md`'s "Where things live" bullet — points at the
  real filename, so nothing dangles.

## Docs updated under this CR

- `CLAUDE.md` (reimbursement): "Where things live" gains entries for
  `apps/api/src/stats/` (window boundaries, Thai date/caption formatting, and
  the `buildOverviewStats()` assembly) and `apps/api/src/vendors.ts` +
  `apps/web/src/screens/approver/overview/`, plus a one-line note that vendor
  matching is owned entirely by the `vendor_normalize()` SQL function, not by
  any TypeScript code.

## Notes

`CLAUDE.local.md` in this directory instructs following "rules in
`docs/AI-CODING-RULES.md`" — that file does not exist anywhere in this repo.
Flagging the dangling reference here rather than fixing it: creating that
file is outside this CR's scope, and this CR's own ownership boundary is
`docs/**` + `CLAUDE.md` only.
