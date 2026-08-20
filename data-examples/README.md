# data-examples

Shape references for the two files that hold real employee data and are
therefore **gitignored**, never committed:

| Real file (gitignored) | Example here | Holds |
|---|---|---|
| `data/employee-defaults.json` | `employee-defaults.json` | legal name → nickname / position / monthly salary |
| `data/savings-balance.json` | `savings-balance.json` | nickname → provident-fund balance carried into the cycle |

Loaded by `src/roster-data.ts`. Override the paths with `EMPLOYEE_DEFAULTS_PATH`
and `SAVINGS_BALANCE_PATH`.

**A missing file is not fatal, on purpose.** Nickname/position/salary defaults
and provident-fund balances go blank and the app still boots — the safe
direction for a payroll tool. Each loader logs a warning once at startup, so a
blank column is never a silent mystery.

These files used to be inline literals in `src/sheets.ts` and
`src/views/worksheet.ts`, which published 21 employees' salaries and their fund
balances to a public git history. Keep them out of the repo.
