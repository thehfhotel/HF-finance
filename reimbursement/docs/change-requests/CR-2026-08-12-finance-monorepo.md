# CR-2026-08-12: Finance monorepo — reimbursement joins thehfhotel/HF-finance

Executes the queued consolidation (decision + rule recorded in ADR 0001's
amendments and the session notes of 2026-08-12): the money-out domain —
payroll-form, kbiz-bot, reimbursement — becomes one repo, because its
contracts are bespoke and co-evolve. Products, deploys and evergreen state
are UNCHANGED; only the deploy source moved.

## What changed

- `reimbursement/` subtree-merged into `thehfhotel/HF-finance` with full history
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

Reimbursement's pipeline needs, on `thehfhotel/HF-finance`:
`REIMB_SSH_PRIVATE_KEY` (NEW keypair — the old one is unrecoverable from GH;
public half appended to `/home/reimbursement-v2/.ssh/authorized_keys`),
`REIMB_SSH_KNOWN_HOSTS`, plus copies of: `JWT_SECRET`, `CF_ACCESS_AUD`,
`POSTGRES_PASSWORD`, `READER_RESOLVE_SECRET`, `NOTIFY_INGRESS_TOKEN`,
`SLACK_WEBHOOK_URL`, `KIOSK_EMAILS` (values read from the deployed `.env` on
evergreen — never printed). `DATABASE_URL` is NOT a secret to copy — the
workflow composes it inline from `POSTGRES_PASSWORD`; dropped from this list
(previously listed here in error). `KBIZ_QUEUE_HOST_DIR` is likewise not a
secret — see the audit-fixes section below. Optional CF service-token
secrets are omitted: the bare cloudflared proxy works (payroll's own deploy
proves it).

## Cutover order

1. Branch fully green (typecheck, tests, review) — this CR's commit.
2. Secrets installed on the payroll repo + new SSH key on evergreen.
3. **Mirror the last pre-cutover production sha into the new package names**
   so the documented rollback path (`DEPLOYMENT.md` → Rollback) has a target
   to roll back TO on the very first monorepo deploy:
   ```bash
   docker buildx imagetools create \
     -t ghcr.io/thehfhotel/payroll-reimbursement-api:sha-<last-good> \
     ghcr.io/thehfhotel/reimbursement-v2-api:sha-<last-good>
   docker buildx imagetools create \
     -t ghcr.io/thehfhotel/payroll-reimbursement-web:sha-<last-good> \
     ghcr.io/thehfhotel/reimbursement-v2-web:sha-<last-good>
   ```
   Manual, credentialed registry operation — not run by CI, not run by an
   agent. `<last-good>` = the sha currently live in
   `/home/reimbursement-v2/production/.env` on evergreen before this merge.
4. Merge → both pipelines run: payroll's (no-op for its apps) and
   reimbursement's (new image names → fresh packages → deploy → health check).
5. Verify live: containers healthy, app serving, a queue round-trip works,
   **and approver notifications actually arrive in the HF One portal**
   (`NOTIFY_INGRESS_TOKEN` has no required-secret guard in the workflow — a
   missed copy fails dark, not loud; confirm by triggering one real "request
   submitted" notification, don't just trust the deploy going green).
6. Confirm in GHCR (org Packages view) that both `payroll-reimbursement-api`
   and `payroll-reimbursement-web` show as linked to `thehfhotel/HF-finance`
   before trusting the deploy job's `docker compose pull` on the next run.
7. Archive `thehfhotel/reimbursement-v2` (history + issues stay readable);
   local `~/reimbursement` clone becomes read-only reference — work happens
   in `~/payroll/reimbursement`.

## Rollback

Before step 4: delete the branch. After: revert the merge commit — the old
repo still exists unchanged and its pipeline still works until archived, so
re-pointing deploys back is one push. Evergreen state needs no rollback
(nothing there moved).

## Post-review audit fixes (this pass)

A file-cited audit of the branch turned up gaps the checklist above didn't
originally cover; folded in here rather than opening a second CR per
`CLAUDE.local.md`. Applied in the working tree:

- **Rollback path**: added the imagetools-mirror step (order item 3, new)
  and rewrote `DEPLOYMENT.md`'s Rollback section to name the new image and
  flag that anything older than the cutover sha needs the old package name.
- **Secrets doc**: `DEPLOYMENT.md`'s table renamed `SSH_PRIVATE_KEY` /
  `SSH_KNOWN_HOSTS` → `REIMB_SSH_PRIVATE_KEY` / `REIMB_SSH_KNOWN_HOSTS`,
  retargeted `--repo thehfhotel/reimbursement-v2` → `--repo
  thehfhotel/HF-finance` (also in `scripts/sync-notify-token.sh` and
  `deploy/evergreen-setup.sh`), added the 5 secrets the table was missing
  (`READER_RESOLVE_SECRET`, `NOTIFY_INGRESS_TOKEN`, `KIOSK_EMAILS`,
  `HF_ERP_BASE_URL`, `SLACK_WEBHOOK_URL`) with fail-open/fail-dark noted per
  row.
- **`KBIZ_QUEUE_HOST_DIR`**: dropped as a `deploy-reimbursement.yml` secret
  (it fed only reimbursement's half of a directory shared with two other
  stacks that had no matching secret); now a hardcoded literal identical to
  `docker-compose.yml`'s own default. See root `CLAUDE.md`.
- **Health check**: `deploy-reimbursement.yml`'s post-deploy probe now hits
  `/healthz/upstream` (the api-proxying endpoint), not the static `/healthz`
  nginx answers for itself — closes the same blind spot the compose
  `HEALTHCHECK` was already fixed for after 2026-08-10.
- **Contract gating**: `deploy-reimbursement.yml`'s `deploy` job now also
  needs a new `contract` job (root `bun test`, the suite that covers
  `kbiz-bot/test/shared-contract.test.ts`); both deploy workflows now share
  one `concurrency` group (`deploy-evergreen`) so the two rollouts queue
  instead of racing on the shared KBIZ queue dir.
- **kbiz-bot typecheck**: `deploy.yml`'s `test` job now also installs and
  `tsc --noEmit`s kbiz-bot (previously configured, never invoked anywhere);
  `test` runs on `pull_request` too so this gates a PR, not just `main` —
  `build-payroll`/`build-kbiz-bot`/`deploy` explicitly exclude
  `pull_request` (push and manual `workflow_dispatch` still work) so a PR
  can never trigger a production deploy.
- **Image LABEL**: both Dockerfiles' `org.opencontainers.image.source`
  pointed at a personal fork (`jwinut/reimbursement`); now
  `thehfhotel/HF-finance`.
- **Action pinning**: `deploy-reimbursement.yml` and `reimbursement-ci.yml`
  now pin every action to a commit sha (reusing `deploy.yml`'s already-vetted
  pins where the action matches), consistent with this repo's existing
  convention. Note this bumps several actions' major versions
  (`checkout` v4→v5, `setup-buildx-action`/`login-action` v3→v4,
  `build-push-action` v6→v7) to match what's already running successfully
  elsewhere in this repo — not verified against a live run by this pass
  (no push was made); confirm on the next real CI run.
- **Dependabot**: re-added `bun` + `docker` ecosystem entries for
  `/reimbursement` (deleted with the subtree's own `.github/` and never
  recreated at root) — recovered from `git show 29d7ac4^:reimbursement/.github/dependabot.yml`.
- **Root `Dockerfile`** (payroll-form): now copies `bun.lock` and drops the
  `|| bun install --production` fallback, so the image is built from the
  exact versions `bun test` validated instead of a fresh floating resolve.
- **Stale doc/image-name references**: `CLAUDE.md` (root + reimbursement's),
  `README.md`, `import-notion.ts`'s runbook comment, and
  `docker-compose.yml`'s `/srv` vs `/home/deploy` comment mismatch.

Not applied (needs a human with registry/SSH credentials, not covered by
this doc-and-workflow-only pass): the imagetools mirror in step 3 above, and
confirming the GHCR package-repo link in step 6.
