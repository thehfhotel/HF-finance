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
