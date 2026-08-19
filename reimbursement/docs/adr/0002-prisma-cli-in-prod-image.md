# 0002 — The Prisma CLI stays in the api production image

- **Status:** Accepted
- **Date:** 2026-08-19
- **Deciders:** Claude agent, raised by the dependabot batch review (§4.6) —
  pending owner (Winut) confirmation; no in-session sign-off was obtained
- **Scope:** `Dockerfile.api`, `apps/api/docker-entrypoint.sh`,
  `apps/api/package.json`. No change to either deploy workflow.

## Context

`apps/api/docker-entrypoint.sh` runs `bunx prisma migrate deploy` and then `exec`s
the server, so the `prisma` CLI is a runtime `dependency` and ships to production.
It is the ONLY automated migration path there: `deploy-reimbursement.yml` has no
migration step, and the `contract` job's `migrate deploy` hits a throwaway CI
database. Prisma 7.9.1 made this tree materially bigger (`@prisma/studio-core`
0.27.3 → 0.33.0 swapped chart.js for `@visx`/`d3`/`elkjs`/`lodash`), which is what
prompted this decision.

Measured on the live image `payroll-reimbursement-api:sha-cca087d` (**1.02 GB**)
and by re-resolving the production tree locally:

| Line item | Size |
|---|---|
| `bun install --production` layer | 367 MB |
| `RUN chown -R bun:bun /app` (overlayfs copy-up of all of `/app`) | 355 MB |
| `apt-get install curl imagemagick ghostscript` | 120 MB |
| — prisma CLI subtree in the install layer (133 pkgs: react-dom, effect, pglite…) | 248 MB |
| — of that, the `@prisma/studio-core` subtree (55 pkgs) | 75 MB |

`chown -R` re-materializes every file in `/app`, so the CLI is paid for twice:
≈490 MB, ~48% of the image; `studio-core` alone ≈150 MB, ~15%.

Two facts constrain the options. **Nothing in CI ever runs the built runtime
image** — `reimbursement-ci.yml`'s image job is build-only and the `contract` job
migrates from the source tree, so the entrypoint's first real execution is always
the production rollout. And `prisma` is an *optional peer* of `@prisma/client` (it
ships only because `apps/api` declares it directly), while `@prisma/studio-core`
is a *hard* dependency of `prisma` 7.9.1 — no supported way to have one without
the other.

## Decision

**Keep the entrypoint migration and keep the CLI in the image.** No code change.

## Consequences

- The image stays ~1 GB. Pulls are LAN-local to evergreen, once per deploy — the
  cost is build and registry storage, not runtime.
- `docker compose up` and host reboots always self-migrate before serving. That
  property is what we are protecting.
- react-dom/effect/pglite/@visx sit on a money-path image but are never imported:
  the server uses `@prisma/client`; only the entrypoint's one-shot touches the CLI.
- If image size ever does matter, the 355 MB `chown` layer (removable with
  `COPY --chown` + `USER bun` before install) is a bigger win than the CLI itself.

## Alternatives considered

- **(c) Prune `@prisma/studio-core` from the runtime image** — *proven to work,
  rejected anyway.* With it removed, `migrate deploy` applied all 15 migrations to
  a real Postgres and re-ran clean ("No pending migrations"), and `prisma -v` was
  unaffected: the CLI's `studio-core` requires are lazy. But no manifest can
  express it — it means `rm -rf` on bun's private
  `node_modules/.bun/@prisma+studio-core@*/` store path, from a floating
  `oven/bun:1.3` base, for 75 MB. If a later Prisma moves any migrate-path require
  into `studio-core`, the entrypoint exits non-zero, the container crashloops, the
  api never starts — an outage first seen in production, because no gate runs the
  image.
- **(b) Migrate from the deploy workflow (one-shot container before rollout)** —
  no size win (the one-shot needs the same CLI, and `prisma.config.ts` imports
  `prisma/config`), and it removes self-migration on restart: an out-of-band
  `compose up` would serve against an unmigrated schema.
- **(d) Separate slim migrate image** — the only real size win, but it doubles the
  build matrix, adds an image to keep lockstep with the same lockfile, and carries
  (b)'s regression. High effort, new money-path deploy failure modes.
- Any variant that drops `prisma` from `dependencies` must also replace the
  entrypoint call: `bunx prisma` would resolve nothing locally and fetch the CLI
  from npm at container start, making startup depend on registry reach.

## Revisit if

Prisma's runtime tree grows materially again, the image blocks a deploy on build
time or registry quota, or CI gains a job that boots the built image against a
database — that last one removes the main objection to (c).
