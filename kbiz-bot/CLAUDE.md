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

## The contract

Types come from the monorepo's shared package:
`../reimbursement/packages/shared/src/index.ts` (`@reimbursement/shared` via
tsconfig paths). The Dockerfile COPYs that dir into the image — keep the
relative layout intact. A contract change rebuilds this image (CI paths filter
includes `reimbursement/packages/shared/**`).

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

## Testing

`bun test` must pass from BOTH `kbiz-bot/` and the repo root (CI runs the root
context without kbiz-bot's node_modules — no test import may reach playwright;
keep the pure-core/driver file split). `bunx tsc --noEmit -p tsconfig.json`
strict. No live-KBIZ test runs without the operator watching.
