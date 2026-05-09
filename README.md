# payroll

Internal payroll-form web app for an in-house HR/finance workflow.
Generates beneficiary and transfer xlsx files in the K BIZ (KBank Business
Online) format, and ships a companion browser-automation worker
(`kbiz-bot`) that uploads them to K BIZ on a schedule.

This repository is published for transparency. It is **not** a generally
licensed open-source project — see `LICENSE` for the terms under which
the source is made available.

## Components

| dir | role |
| --- | --- |
| `src/` | Bun + Elysia web app (port 3000). Account list, monthly payroll worksheet, OTP-gated approvals queue, xlsx generation. |
| `kbiz-bot/` | Playwright + Chromium worker. Persistent K BIZ session, uploads beneficiary lists and payroll batches, polls the queue. |

## Running locally

```sh
bun install
cp .env.example .env   # fill in KBIZ_USERNAME / KBIZ_PASSWORD / SLACK_WEBHOOK_URL
bun run start          # web app only
```

For the full stack (web + browser-bot), use docker-compose:

```sh
docker compose up -d --build
docker compose logs -f
```

## Deployment

Production runs on a single host (evergreen). CI/CD details — including
the SSH-over-cloudflared deploy pattern, forced-command on the deploy
user, and one-time evergreen setup — are documented in
[`EVERGREEN.md`](./EVERGREEN.md).

## Security

See [`SECURITY.md`](./SECURITY.md).

## License

See [`LICENSE`](./LICENSE). Reading for security review, study, or
evaluation is permitted; use, modification, and redistribution are not.
