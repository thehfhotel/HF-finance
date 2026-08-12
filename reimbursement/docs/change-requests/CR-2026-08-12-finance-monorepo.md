# CR-2026-08-12: Finance monorepo — reimbursement joins thehfhotel/payroll

Executes the queued consolidation (decision + rule recorded in ADR 0001's
amendments and the session notes of 2026-08-12): the money-out domain —
payroll-form, kbiz-bot, reimbursement — becomes one repo, because its
contracts are bespoke and co-evolve. Products, deploys and evergreen state
are UNCHANGED; only the deploy source moved.

## What changed

- `reimbursement/` subtree-merged into `thehfhotel/payroll` with full history
  (`git subtree add`, 170-commit lineage preserved).
- CI: root gains `deploy-reimbursement.yml` (path-scoped to
  `reimbursement/**`; images renamed to
  `ghcr.io/thehfhotel/payroll-reimbursement-{api,web}` so the payroll repo's
  GITHUB_TOKEN owns the packages) and `reimbursement-ci.yml` (typecheck).
  The subtree's own `.github/` was removed — workflows only run from root.
- Payroll's kbiz filter now includes `reimbursement/packages/shared/**` —
  a contract change rebuilds the bot image.
- kbiz-bot imports `@reimbursement/shared` directly (tsconfig paths +
  Dockerfile COPY of the shared source): the duplicated contract types are
  gone, and cross-repo drift is now a compile error.
- CLAUDE.md architecture: root = monorepo map + evergreen gotchas;
  `kbiz-bot/CLAUDE.md` = bank-driver rules + pinned live facts;
  this app's CLAUDE.md gains the monorepo banner.

## Secrets (payroll repo)

Reimbursement's pipeline needs, on `thehfhotel/payroll`:
`REIMB_SSH_PRIVATE_KEY` (NEW keypair — the old one is unrecoverable from GH;
public half appended to `/home/reimbursement-v2/.ssh/authorized_keys`),
`REIMB_SSH_KNOWN_HOSTS`, plus copies of: `JWT_SECRET`, `CF_ACCESS_AUD`,
`POSTGRES_PASSWORD`, `DATABASE_URL`, `READER_RESOLVE_SECRET`,
`NOTIFY_INGRESS_TOKEN`, `SLACK_WEBHOOK_URL`, `KIOSK_EMAILS` (values read from
the deployed `.env` on evergreen — never printed). Optional CF service-token
secrets are omitted: the bare cloudflared proxy works (payroll's own deploy
proves it).

## Cutover order

1. Branch fully green (typecheck, tests, review) — this CR's commit.
2. Secrets installed on the payroll repo + new SSH key on evergreen.
3. Merge → both pipelines run: payroll's (no-op for its apps) and
   reimbursement's (new image names → fresh packages → deploy → health check).
4. Verify live: containers healthy, app serving, a queue round-trip works.
5. Archive `thehfhotel/reimbursement-v2` (history + issues stay readable);
   local `~/reimbursement` clone becomes read-only reference — work happens
   in `~/payroll/reimbursement`.

## Rollback

Before step 3: delete the branch. After: revert the merge commit — the old
repo still exists unchanged and its pipeline still works until archived, so
re-pointing deploys back is one push. Evergreen state needs no rollback
(nothing there moved).
