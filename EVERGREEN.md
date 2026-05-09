# Deploying to evergreen

## CI/CD via GitHub Actions

`.github/workflows/deploy.yml` mirrors the new-hotel Phase-1 pattern
(`new-hotel/docs/runbook-deploy-modernization.md`):

1. **`changes`** — `dorny/paths-filter` decides whether the payroll image,
   the kbiz-bot image, and/or the deploy step need to run. Doc-only commits
   skip everything.
2. **`build-payroll` / `build-kbiz-bot`** — GitHub-hosted runners build
   in parallel, tag `:latest` and `:<sha>`, push to `ghcr.io`. Each gated on
   its own paths-filter output.
3. **`deploy`** — runs on `ubuntu-latest`, NOT on a self-hosted runner.
   It reaches evergreen via `cloudflared access ssh --hostname %h` (same
   tunnel the operators use for daily SSH) and SSHes as the unprivileged
   `deploy` user. `deploy@evergreen`'s `authorized_keys` pins the SSH key
   to `/srv/run-deploy-payroll.sh` (forced-command); the workflow can only
   trigger that script — it cannot execute arbitrary commands on prod.
   The script unpacks `docker-compose.yml`, materialises `.env` from the
   payload, `docker compose pull && up -d`, and health-checks both
   containers.

## One-time evergreen setup

The new-hotel runbook walks through the `deploy` user creation, sshd
hardening, and key install in detail. See:

```
new-hotel/docs/runbook-deploy-modernization.md
```

Steps already done as part of new-hotel modernisation (do NOT repeat):

- `deploy` user exists, in `docker` group, `/home/deploy/.ssh/` set up
- sshd has `PasswordAuthentication no` + `KbdInteractiveAuthentication no`
- `/var/log/deploy/` exists, owned `deploy:deploy`
- evergreen host key is published as the `EVERGREEN_HOST_KEY` GH Secret

Payroll-specific additions:

```sh
# 1. Generate a NEW ed25519 key for payroll (do NOT reuse new-hotel's key —
#    each app gets its own key pinned to its own forced-command).
ssh-keygen -t ed25519 -a 100 -f /tmp/evergreen-payroll-deploy \
  -C "gh-actions@thehfhotel-payroll" -N ""

# 2. On evergreen as root: install the deploy script + migrate the prod
#    dir. `mv` (not `install -d`) preserves the existing `data/` bind-mount
#    contents (queue, roster, registered cache). The named volume
#    `payroll-production_kbiz-bot-profile` is keyed by dir basename, which
#    doesn't change, so the Chromium session survives the move.
sudo install -m 755 -o root -g root \
  /path/to/payroll/scripts/deploy/run-deploy.sh \
  /srv/run-deploy-payroll.sh
sudo mv /home/nut/payroll-production /home/deploy/payroll-production
sudo chown -R deploy:deploy /home/deploy/payroll-production

# 3. APPEND a second entry to /home/deploy/.ssh/authorized_keys.
#    Result: two distinct keys, each pinned to its own forced-command.
sudo tee -a /home/deploy/.ssh/authorized_keys > /dev/null <<'EOF'
command="/srv/run-deploy-payroll.sh",restrict ssh-ed25519 PUBLIC_KEY_FROM_STEP_1 gh-actions@thehfhotel-payroll
EOF

# 4. Symlink under /home/nut for muscle-memory parity (operators reach
#    the dir via `cd ~/payroll-production` from the nut account).
sudo ln -s /home/deploy/payroll-production /home/nut/payroll-production

# 5. Test from your laptop BEFORE flipping the workflow:
echo '{"commit_sha":"test","deploy_payload_b64":"<b64 tarball>","ghcr":{...},"env":{...}}' \
  | ssh -i /tmp/evergreen-payroll-deploy \
      -o StrictHostKeyChecking=accept-new \
      -o ProxyCommand="cloudflared access ssh --hostname %h" \
      deploy@evergreen.thehfhotel.org
# Expect: script stdout streams back, ending with `[deploy] done ... log=...`.
# If anything goes wrong, log is at /var/log/deploy/deploy-payroll-*.log on evergreen.

# 6. Delete /tmp/evergreen-payroll-deploy from the laptop after step 7.

# 7. Add GH Secrets in this repo:
#    - EVERGREEN_DEPLOY_SSH_KEY = private half from step 1
#    - EVERGREEN_HOST_KEY       = same value as new-hotel's (same host)
```

## Repository secrets

| name                        | use                                           |
| --------------------------- | --------------------------------------------- |
| `KBIZ_USERNAME`             | KBIZ login (passed into `.env` on evergreen)  |
| `KBIZ_PASSWORD`             | KBIZ login                                    |
| `SLACK_WEBHOOK_URL`         | webhook for queue notifications (optional)    |
| `EVERGREEN_DEPLOY_SSH_KEY`  | ed25519 private key for `deploy@evergreen`    |
| `EVERGREEN_HOST_KEY`        | evergreen's SSH host key (`known_hosts` pin)  |

> Set with `gh secret set NAME --body "$VALUE"` (NOT `--body -`). The
> dash form treats literal `-` as the value; pipe via stdin instead:
> `printf '%s' "$VAL" | gh secret set NAME`.

## Operations

```sh
ssh nut@evergreen
cd /home/deploy/payroll-production    # via the /home/nut symlink: cd ~/payroll-production

# tail logs of one service
docker compose logs -f payroll
docker compose logs -f kbiz-bot

# rerun list scrape inside the kbiz-bot container
docker compose exec kbiz-bot node --import tsx src/list-payroll-accounts.ts

# reset KBIZ session (force fresh login on next run)
docker compose down
docker volume rm payroll-production_kbiz-bot-profile
docker compose up -d

# inspect the most recent CI deploy
sudo less /var/log/deploy/$(ls -t /var/log/deploy/deploy-payroll-*.log | head -1)
```

## Stack overview

| service        | role                                           | image                                          |
| -------------- | ---------------------------------------------- | ---------------------------------------------- |
| `payroll-form` | Bun + Elysia web app on :3000 (host :3002)     | `ghcr.io/thehfhotel/payroll:latest`            |
| `kbiz-bot`     | Headless Chromium + Playwright queue processor | `ghcr.io/thehfhotel/payroll-kbiz-bot:latest`   |

Both share `./data` (bind-mount) for the queue, roster, and registered cache.
`kbiz-bot-profile` is a named volume holding the persistent Chromium
profile (cookies/localStorage); rebuilds preserve the KBIZ session.

After the stack is up, port `3002` on evergreen is exposed via the
Cloudflare tunnel public hostname (configured in the Cloudflare web console).
