# CR-2026-08-20 — Employee data out of git

**Status:** implemented (code); **prod action outstanding** (see §4)
**Author:** Claude (Opus 5), at the owner's direction
**Trigger:** a PII audit run while shipping the mandatory-destination change
(`e30d2e2`) found real personal data committed to this repo, which is **public**.

## 1. What was exposed

`thehfhotel/hf-finance` has been public since it was created (2026-04-26).
Committed to it:

| Data | Location | Public since |
|---|---|---|
| 21 employees: full Thai legal name + nickname + job title + **exact monthly salary** (฿3,000–14,000; ฿221,220/mo in total) | `src/sheets.ts` `EMPLOYEE_DEFAULTS` | 2026-05-09 |
| Per-employee lifetime **provident-fund balances**, keyed by nickname (23 spellings, 16 people) | `src/views/worksheet.ts` `SAVINGS_BALANCE` | 2026-05-09 |
| Two named employees' **termination payouts** with amounts and resignation dates | `src/views/worksheet.ts` code comment | 2026-06-04 |
| Five real bank account numbers, one beside its holder's real name in Thai and romanized | `kbiz-bot/` sources, tests and docblocks | 2026-08-12 |
| Two real account numbers + a real name in **commit messages** (`553d316`, `b87b027`) | commit metadata | 2026-04-26 |

The provident-fund map was additionally the worst placed of these: it sat
inside the `WORKSHEET_HTML` template string, i.e. it was **client-side JS
served to every browser** that loaded `/worksheet`.

This contradicted a rule the repo already stated for bank data
(`kbiz-bot/CLAUDE.md`): real payee data lives only in
`transfer-other.config.json` on the host, masked last-4 everywhere else. The
rule was only ever enforced on *published* artifacts — manifests, Slack — and
never on committed source, which is how salary literals walked straight past it.

## 2. Decision

Extend the existing "real values live on the host, never in the repo" rule from
bank accounts to **all** employee personal data, and enforce it in the one place
the data enters the program: a loader.

The account numbers, adjacent real names, and the two commit messages are
handled by a separate git-history rewrite. This CR covers the employee data and
the code change that makes the repo able to run without it.

Rejected alternatives:

- **Pseudonymise in place.** The worksheet's whole purpose is showing a named
  person their own payroll line; pseudonyms make it useless.
- **Encrypt in-repo.** Moves the problem to key handling and still ships the
  ciphertext to a public repo forever.
- **Make the repo private instead.** Recommended and declined by the owner
  (2026-08-20); they chose to stay public and rewrite. Noted here because it
  remains the only measure that also closes GitHub's 35 `refs/pull/*` refs,
  which a force-push cannot reach.

## 3. What changed

- **New** `src/roster-data.ts` — `loadEmployeeDefaults()` and
  `loadSavingsBalance()`, reading `data/employee-defaults.json` and
  `data/savings-balance.json` (`data/` is already gitignored). Paths override
  with `EMPLOYEE_DEFAULTS_PATH` / `SAVINGS_BALANCE_PATH`. Values are validated
  per field, so a malformed file degrades rather than injecting junk.
- `src/sheets.ts` — the 21-entry literal becomes
  `const EMPLOYEE_DEFAULTS = loadEmployeeDefaults()`.
- `src/views/worksheet.ts` — the literal becomes
  `${JSON.stringify(loadSavingsBalance())}`, injected server-side at module
  load. The template already interpolated, so no route or signature changed.
  The named termination-payout comment is genericized.
- **New** `data-examples/` — committed placeholder files documenting both
  shapes, plus a README.

**A missing file is deliberately not fatal.** Both consumers already treated a
missing entry as "no default" and fell through, so a host without these files
gets blank nickname/position/salary suggestions and blank fund balances, and
still boots — the safe direction for a payroll tool. Because that is silent,
each loader logs a warning once at startup.

Verified: root `bun test` 525 pass / 0 fail; the worksheet renders a
byte-identical `SAVINGS_BALANCE` map when the file is present, and `{}` with a
warning when it is absent.

## 4. Prod action outstanding

`./data:/app/data` is already a bind mount for both payroll services, so no
compose change is needed. The loaders run at **module load**, so the container
must be restarted to pick the files up.

On evergreen, in `/home/deploy/payroll-production/data/`, place
`employee-defaults.json` and `savings-balance.json` (shapes per
`data-examples/`), then restart the payroll service.

Until that is done, prod behaves as described above: defaults and fund
balances are blank, with a warning in the container log. Nothing else is
affected — no crash, no data loss, no effect on transfers.

The real values were extracted from the pre-change source and are held outside
the repo for the handoff; they are not in this commit, and must not be added to
it.
