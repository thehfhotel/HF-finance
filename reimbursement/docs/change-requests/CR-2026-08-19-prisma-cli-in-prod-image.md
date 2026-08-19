# CR-2026-08-19: Keep the Prisma CLI in the api production image (retroactive)

**Status:** retroactive — filed after ADR 0002 already shipped. See "Why this
is retroactive" below.

## What

Records [ADR 0002](../adr/0002-prisma-cli-in-prod-image.md) — the decision to
keep `prisma` as a runtime `dependency` of `apps/api` (so
`docker-entrypoint.sh`'s `bunx prisma migrate deploy` keeps running at
container start) rather than pruning it or its now-larger
`@prisma/studio-core` transitive tree out of the production image.

**No code, Dockerfile, or workflow change.** This is a decision-and-evidence
document only — `Dockerfile.api`, `apps/api/docker-entrypoint.sh`, and
`apps/api/package.json` are unchanged by this CR, exactly as ADR 0002's own
Scope line says.

## Why

The dependabot batch rollout on 2026-08-19 bumped `@prisma/client` /
`@prisma/adapter-pg` / `prisma` / `@prisma/client-runtime-utils` to 7.9.1,
which pulled `@prisma/studio-core` 0.27.3 → 0.33.0 and swapped its dependency
tree (chart.js out; `@visx`/`d3`/`elkjs`/`lodash` in) — materially bigger, on
a money-path image. That prompted the question of whether the CLI (and that
tree) belongs in the runtime image at all. ADR 0002 answers it: keep it,
because no CI gate ever boots the built image (`reimbursement-ci.yml`'s image
job is build-only; the `contract` job migrates from source), so a pruned CLI
that later breaks would first fail as a production crashloop, not a red
check. See the ADR for the full measurement (≈490 MB / ~48% of the 1.02 GB
image once the `chown -R` copy-up layer is counted) and the three rejected
alternatives.

## Why this is retroactive

`reimbursement/CLAUDE.local.md` requires a change request for every doc that
is added or modified: "always create a change request for modifying existing
docs or create a new doc." ADR 0002 was written and committed (`bb2a6f0`,
2026-08-19) without one — the session that produced it was working from a
checklist that didn't carry this step forward, and the gap wasn't caught
before the commit. It surfaced afterward as an explicitly tracked open item
(`followups-report.md` §6.2: "No change-request doc was filed for ADR 0002
... Your call whether one is needed retroactively"). This CR is that
retroactive filing: it does not change ADR 0002's content or its Deciders
line (that line is a separate open item — owner sign-off, tracked and handled
elsewhere) — it only documents, after the fact, what was decided and why, in
the place the convention says it belongs.

## Docs modified

| Doc | Summary |
|---|---|
| `docs/adr/0002-prisma-cli-in-prod-image.md` | Already existed (committed `bb2a6f0`, 2026-08-19) — not modified by this CR. Listed here because this CR is its change request. |
| `docs/change-requests/CR-2026-08-19-prisma-cli-in-prod-image.md` (this file) | New. |

## Data migration

None. No schema, code, or config change.
