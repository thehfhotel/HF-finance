# CR-2026-07-29: Remove the company expense ledger (scope correction)

## What

Deletes the company expense ledger feature that shipped in `0.11.0` (#28,
`feat(ledger): company expense ledger — admin entry, month dashboard, P&L
report`) and everything it added:

- **UI** — the บันทึกบิล admin-entry wizard (photo → amount → P&L category →
  payment method → confirm), the รายจ่ายบริษัท month dashboard (per-line
  totals, recurring-bill completeness checklist, unpaid badges), and the
  printable งบกำไรขาดทุน P&L report screen. Routes `ledger`, `ledger-entry`,
  `ledger-report` are removed.
- **API** — `/api/expenses/*` and `/api/pl/*`.
- **Role** — `Role.ADMIN` is removed; the role union is now exactly
  `'employee' | 'approver'`.
- **Schema** — the `expenses` and `revenue_entries` tables, dropped by
  migration `20260729120000_remove_expense_ledger` (the inverse of
  `20260706113537_expense_ledger`, which created them).
- **Shared contract** (`packages/shared/src/index.ts`) — `Expense`,
  `RevenueEntry`, `PaymentMethod`, `MonthLedgerSummary`, `PlLine` /
  `PL_LINES` / `PL_LINE_BY_CODE`, and the `pl.ts` / `pl-history.ts` modules
  they lived in.

Everything reimbursement-related — Receipt, Bundle, User (badge + email),
categories, statuses, `AdminUser`, `CreateUserRequest`, the employee →
approver receipt/bundle/approve/pay flow — is untouched.

## Why

reimbursement.thehfhotel.org exists for employees to submit reimbursements
and approvers to approve/pay them. The company expense ledger (a monthly
bills checklist + P&L report + `ADMIN` role) is company accounting, not
reimbursement — it does not belong in this app. Company accounting already
has a home at income.thehfhotel.org. PR #28 added the ledger here anyway;
this CR is the scope correction.

## Evidence it was safe to remove

Production has never used the feature:

- `expenses` and `revenue_entries` both have **0 rows** (`n_tup_ins = 0` in
  `pg_stat_user_tables` — no row has ever been inserted, not even one that
  was later deleted).
- The single `ADMIN`-role user owns no rows in either table.

Because there is no live data, this is a clean feature extraction — no
backfill, no data migration, no export step.

## Docs modified

| Doc | Summary |
|---|---|
| `CHANGELOG.md` | New `[0.13.0] - 2026-07-29` entry under **Removed**: the ledger UI/API/schema/role, the reverting migration, the unused-in-prod evidence, and a pointer to this CR. |
| `CLAUDE.md` | "What this is" section gains an explicit scope-boundary sentence: company accounting is out of scope, lives at income.thehfhotel.org, with a note not to re-add a ledger/admin-role feature here (pointing at this CR). No layout/route/role text needed correcting — it already described the two-role (employee/approver) reimbursement flow only; the ledger was never documented there. |
| `README.md` | One-line scope note added under the intro paragraph: reimbursement only, company accounting lives at income.thehfhotel.org. |
| `SECURITY.md` | Reviewed, no change — already described `employee` / `approver` as the only roles and never mentioned the ledger. |
| `DEPLOYMENT.md` | Reviewed, no change — never mentioned the ledger, `ADMIN`, or the P&L report. |
| `docs/change-requests/CR-2026-07-29-remove-expense-ledger.md` (this file) | New. |

## Data migration

Prisma migration `20260729120000_remove_expense_ledger` drops the `expenses`
and `revenue_entries` tables and the `ADMIN` value from the `Role` enum. No
backfill required (see Evidence above). Applied alongside the code removal
in `apps/api`, `apps/web`, and `packages/shared` (owned by other agents in
this same change set).
