# CLAUDE.md — kbiz-bot

The ONLY thing in the estate that logs into the bank. Headless Playwright
driver for KBIZ (KBank Business Online), running on evergreen as a
`process-queue.ts --watch` container in the payroll stack.

## Hard rules

- **The phone tap is the gate.** KBIZ's "Next" on fundtranfer-other IS the
  commit — clicking it sends the approval push to the K BIZ phone app. The bot
  arms; a human approves. Nothing here may bypass, retry-past, or simulate
  that approval, ever.
- **One warm session.** `withSession` opens a persistent Chromium profile
  (`browser-data/`). KBIZ punishes concurrent logins — never run two scripts
  at once, never log in from elsewhere while the bot works. Login auto-recovers
  with user/pass (no phone tap needed for login).
- **Ambiguity is never auto-resolved.** Outcomes are three-way: success /
  confirmed-failed (retryable) / unconfirmed (needs-review; a human checks the
  K BIZ app). A timeout or generic error page is NEVER "failed, safe to retry".
- **Full account numbers never leave this container.** The payee book
  (`transfer-other.config.json`, gitignored, mounted read-only from
  `/home/deploy/kbiz-bot/` in prod) holds them; everything published to the
  shared queue (manifests, errors, Slack) is masked to last-4.
- **One live approval push in the estate, ever.** KBIZ's approval push lives
  SERVER-SIDE at the bank, not in our browser session — a crash or session
  death after the Next click leaves it tappable for minutes, and a naive
  batch loop would happily arm the next one on top of it (two incidents,
  2026-08-12 + 2026-08-13; see the ADR's Amendment 6). `arm-gate.ts` (pure
  decision) + `arm-lock.ts` (durable state) enforce the invariant across
  `transfer-other` AND `transfer-payroll` alike — `process-queue.ts` defers
  (never skips or forces) a batch item that would arm a second push, and
  `transfer-other.ts --confirm` refuses outright under a live lock. **The
  state file** is `<KBIZ_STATE_DIR>/kbiz-arm-lock.json` (default `../data`,
  i.e. `/app/data` in the container) — written conservatively BEFORE the
  arming click (covering the form-fill window a crash could land in), never
  deleted (`state: "released"` is how a lock ends, so there is no ENOENT
  race), and released only when the flow proves the push is no longer live —
  never from a crash handler, since a crash cannot prove that. **The harness
  split** that makes this provable without a browser: `approval-wait.ts` and
  `arm-gate.ts` are pure — zero playwright/fs imports, a plain number for
  `now` — so `bun test` at the repo root, BEFORE kbiz-bot's node_modules even
  exist, proves the invariant; `arm-lock.ts` is fs-only; only
  `transfer-other-flow.ts` / `process-queue.ts` touch playwright. Never blur
  that split — a runtime playwright import in a pure or test file passes
  locally and breaks root CI.

## The contract

Types come from the monorepo's shared package:
`../reimbursement/packages/shared/src/index.ts` (`@reimbursement/shared`). A
contract change rebuilds this image (CI paths filter includes
`reimbursement/packages/shared/**`).

**That specifier resolves two different ways, and both are load-bearing:**

- **Dev, CI, `tsc`, `bun test`** — the `paths` entry in `kbiz-bot/tsconfig.json`.
- **The container** — a node_modules symlink the Dockerfile creates
  (`node_modules/@reimbursement/shared` → `/app/reimbursement/packages/shared`)
  plus that package's own `exports`/`main`. The image has **no tsconfig.json**:
  the repo-root `.dockerignore` excludes `kbiz-bot/*.json` and re-includes only
  `package.json`, so the file is not even in the build context. Deleting the
  symlink as "redundant" crashloops the bot at startup with
  `ERR_MODULE_NOT_FOUND` while CI stays green. So does repointing the shared
  package's `exports` at a `dist/` build output.

`kbiz-bot/test/shared-resolution.test.ts` pins both mechanisms to one file —
if you change the Dockerfile, the tsconfig mapping or the shared package's
entry fields, that test is the thing that tells you the other end moved.

**`tsx` reads its tsconfig from `process.cwd()`, not from the imported file's
directory** — so the bot must always be launched from `kbiz-bot/`.
`node --import tsx kbiz-bot/src/process-queue.ts` from the repo root fails; the
npm scripts and the Dockerfile's `WORKDIR /app/kbiz-bot` both get this right.

**CI does not run `tsc`** (`deploy.yml`'s `test` job is `bun test` only), so
"the contract is a compile error now" is only true for whoever runs
`npm run typecheck`. The drift check that actually runs is in
`test/shared-contract.test.ts`, which reads the shared source as text.

## Facts pinned against the live site (probed + live-verified 2026-08-12)

- The KBIZ session runs THAI (`login.jsp?lang=th`) so scraped account names
  are Thai. Bank matching must go through `aliasesForBank()` (EN↔TH) — never
  a bare substring.
- fundtranfer-other needs a 1600px viewport (1366 is a breakpoint edge where
  rows render non-visible).
- The saved-payee picker opens from `a.input-search-acc`; rows are `div.lists`
  with `<p>label</p><p>value</p>` pairs (labels: ชื่อย่อบัญชี / ชื่อบัญชี /
  ธนาคาร / เลขบัญชี), every row rendered twice (dedupe), numeric `a.pointer`
  pagination. Clicking a row's account link SELECTS the payee — a read-only
  scrape must never click it.
- Success is keyed on the slip page's tokens ("โอนเงินสำเร็จ", "Transaction
  ID", TRBS/TRTS refs) — the waiting screen also says "successfully", don't
  match bare "success". Failure-before-success ordering is deliberate and
  test-pinned.
- The memo field rejects special characters (sanitize to Thai/alnum/space).
  The rule is the contract's `sanitizeKbizMemo`, not a bot-local copy — the
  old `sanitizeMemo` in `transfer-other-flow.ts` is gone and is deliberately
  not re-exported (that module pulls playwright; root CI runs `bun test`
  without it). **One deliberate behavior delta** vs. the deleted local copy:
  shared appends `.trimEnd()` after the 100-char cap, so an input that
  sanitizes to >100 chars and gets cut mid-space now yields 99 chars, not 100
  with a trailing space. Unreachable on the money path (reimbursement builds
  every intent memo with `buildKbizMemo`, already capped + trimmed, and
  re-sanitizing is idempotent); reachable only via
  `npm run transfer-other -- --memo <101+ chars>`. If you are diffing prod memo
  behavior against git history, that is the difference.

## Testing

`bun test` must pass from BOTH `kbiz-bot/` and the repo root (CI runs the root
context without kbiz-bot's node_modules — no test import may reach playwright;
keep the pure-core/driver file split). `bunx tsc --noEmit -p tsconfig.json`
strict. No live-KBIZ test runs without the operator watching.
