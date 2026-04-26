# Deploying to evergreen

## One-time setup on evergreen

```sh
ssh nut@evergreen
# Make sure docker + docker-compose plugin + git are installed.
docker --version
docker compose version
git --version

mkdir -p ~/payroll
cd ~/payroll
git clone git@github.com:thehfhotel/payroll.git .
# OR use HTTPS if SSH isn't set up yet:
# git clone https://github.com/thehfhotel/payroll.git .

cp .env.example .env
nano .env
# fill in:
#   KBIZ_USERNAME=...
#   KBIZ_PASSWORD=...
#   SLACK_WEBHOOK_URL=https://hooks.slack.com/...

docker compose up -d --build
docker compose ps
docker compose logs -f
```

After the stack is up, expose port 3000 via your Cloudflare Tunnel
public hostname (configured in the Cloudflare web console).

## CI/CD via GitHub Actions

`.github/workflows/deploy.yml` mirrors the new-hotel deploy pattern:

1. **Build** — two GitHub-hosted runners build `payroll` (Bun + Elysia)
   and `payroll-kbiz-bot` (Playwright + Chromium) images in parallel,
   tag them `:latest` and `:<commit-sha>`, push to ghcr.io.
2. **Deploy** — runs on the existing self-hosted runner on evergreen
   (`actions.runner.thehfhotel.evergreen.service`). It writes `.env`
   from repo secrets into `/home/nut/payroll-production/`, copies
   `docker-compose.yml` there, then `docker compose pull && up -d`.

The deploy directory `/home/nut/payroll-production/` is the canonical
production location and holds the bind-mounted `data/` (queue, roster,
registered cache) plus the `kbiz-bot-profile` named volume (Chromium
session cookies — survive rebuilds).

**Repository secrets** (already set):

| name                | use                                         |
| ------------------- | ------------------------------------------- |
| `KBIZ_USERNAME`     | KBIZ login                                  |
| `KBIZ_PASSWORD`     | KBIZ login                                  |
| `SLACK_WEBHOOK_URL` | webhook for queue notifications             |

The workflow writes them into `.env` on each run before `docker compose up`.

**Self-hosted runner** is shared org-wide on evergreen — no per-repo
runner setup needed. Workflow targets `runs-on: [self-hosted, linux]`.

## SSH-key auth (so deploy.sh doesn't prompt for password)

From your laptop:

```sh
ssh-copy-id nut@evergreen
# Type the password once (***REDACTED***). Future ssh nut@evergreen logs in
# without a prompt.
ssh nut@evergreen 'echo "passwordless ssh: $(hostname)"'
```

## Subsequent deploys

From your laptop (after committing changes):

```sh
./deploy.sh
```

This pushes to `main`, ssh's into evergreen, `git reset --hard origin/main`,
rebuilds the images, and brings the stack up. Override remote/branch:

```sh
REMOTE=nut@evergreen BRANCH=main ./deploy.sh
```

## Manual deploy on evergreen

If you've changed something directly on evergreen, or just want to tail logs:

```sh
ssh nut@evergreen
cd ~/payroll
git pull
docker compose up -d --build
docker compose logs -f
```

## Stack overview

| service        | role                                           | image                                          |
| -------------- | ---------------------------------------------- | ---------------------------------------------- |
| `payroll-form` | Bun + Elysia web app on :3000                  | built from `Dockerfile`                        |
| `kbiz-bot`     | Headless Chromium + Playwright queue processor | built from `kbiz-bot/Dockerfile` (~1.5GB image)|

Both share `./data` (volume) for the queue, roster, and registered cache.
`kbiz-bot-profile` is a named volume holding the persistent Chromium
profile (cookies/localStorage); rebuilds preserve the KBIZ session.

## Troubleshooting

```sh
# tail logs of one service
docker compose logs -f payroll
docker compose logs -f kbiz-bot

# rerun list scrape inside the kbiz-bot container
docker compose exec kbiz-bot node --import tsx src/list-payroll-accounts.ts

# reset KBIZ session (force fresh login on next run)
docker compose down
docker volume rm payroll_kbiz-bot-profile
docker compose up -d
```
