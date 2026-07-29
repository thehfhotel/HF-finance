# CR-2026-07-29: Retire LINE OAuth login → Cloudflare Access + NFC card login

## What

Removes the app-level LINE OAuth login (channel config, callback route, the
6-digit `lineLinkingCode` binding ceremony, and the admin UI that managed it).
Replaces it with two login paths that were already partially in place:

- **Cloudflare Access** — the SPA now sits behind a CF Access application
  (Google identity for managers, HF ID for employees). A new silent exchange
  endpoint, `POST /api/auth/cf-login`, verifies the `Cf-Access-Jwt-Assertion`
  header at the origin (RS256, team JWKS, `iss`/`aud` pinned — the header is
  never trusted as-is) and mints the app's existing HS256 JWT.
- **HF-ID NFC card login** (already shipped in `a50a1eb`) — unaffected by this
  change; it fails closed independently of Cloudflare Access via
  `READER_RESOLVE_SECRET`.

Identity resolution is admin-managed, not self-service: a verified login
resolves by `User.email` exact match first, then by badge via the synthetic
`<badge>@emp.thehfhotel.org` address. No match → fail-closed 403. No
auto-provisioning.

## Why

The legacy reimbursement app's LINE Login channel was grandfathered in for
convenience, but HF-erp ADR-0002 retires ad hoc per-app LINE channels in
favor of Cloudflare Access as the standard internal-tool login wall. Piggy-backing
on Access also removes the 6-digit code hand-off step (share a code out of
band, expires in 24h) that employees found confusing, and drops LINE channel
secrets from this app's threat surface entirely.

## Docs modified

| Doc | Summary |
|---|---|
| `README.md` | Stack line + local-dev steps: LINE OAuth → Cloudflare Access wall + NFC card login; tweaks-panel user-swap wording updated |
| `CLAUDE.md` | Stack table `Auth` row → CF Access + HF-ID card login; replaced the "LINE binding flow" convention bullet with an "Identity mapping" bullet (email-then-badge resolution, fail-closed 403) |
| `SECURITY.md` | Authentication paragraph rewritten around the CF Access edge wall + origin re-verification; Account binding paragraph rewritten around admin-managed badge/email, no auto-provisioning; pre-link-token mentions deleted |
| `DEPLOYMENT.md` | Secrets table: dropped `LINE_CHANNEL_ID`/`LINE_CHANNEL_SECRET`, added `CF_ACCESS_TEAM_DOMAIN` (optional) + `CF_ACCESS_AUD` (required); deleted "5. LINE Developers console" section entirely, renumbered 6→5 (tunnel cutover) and 7→6 (first deploy); topology diagram/text now notes the public hostname sits behind a Cloudflare Access application (managed in HF-erp's `infra/cloudflare/hostnames.json`) with AUD readback via the CF API |
| `.env.example` (other-owner surface, listed for completeness) | LINE OAuth block removed, Cloudflare Access block added near the card-login vars |
| `docker-compose.production.yml` | api service env: LINE vars removed, `CF_ACCESS_TEAM_DOMAIN`/`CF_ACCESS_AUD` added, nearby comment corrected |
| `.github/workflows/deploy.yml` | Secret wiring + required-secrets validation + `.env` heredoc all swapped from LINE vars to the two CF Access vars |
| `apps/web/src/screens/approver/ManageEmployees.tsx` | Linking-code UX (generate/regenerate/revoke, code display modal, LINE status column) removed; email field + column added to the create/edit admin UI |

## Data migration

Prisma migration `20260729000000_cf_access_login` (landed alongside this CR):

- Drops 5 columns from `users`: `lineId`, `lineDisplayName`, `linePictureUrl`,
  `lineLinkingCode`, `lineLinkingCodeGeneratedAt` (plus their unique indexes).
- Adds `users.email` (nullable, unique, stored lowercased) for the Cloudflare
  Access identity mapping.

No backfill is required — existing rows simply gain a null `email` until an
admin sets one; `badge`-based card login is unaffected.
