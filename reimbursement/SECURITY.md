# Security Policy

## Supported Versions

The following versions of the Expense Reimbursement Application are currently supported with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take security vulnerabilities seriously. If you discover a security issue, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Use GitHub's private vulnerability reporting feature:
   - Go to the repository's "Security" tab
   - Click "Report a vulnerability"
   - Provide detailed information about the vulnerability

### What to Include

- Type of vulnerability (e.g., XSS, SQL injection, authentication bypass)
- Steps to reproduce the issue
- Potential impact of the vulnerability
- Any suggested fixes (optional)

### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Target**: Within 30 days for critical issues

### What to Expect

- We will acknowledge receipt of your report
- We will investigate and validate the issue
- We will work on a fix and coordinate disclosure
- We will credit you in the security advisory (unless you prefer anonymity)

## Security measures

- **Authentication**: Cloudflare Access edge wall in front of the SPA, plus
  origin-side re-verification — the api never trusts the `Cf-Access-Jwt-Assertion`
  header at face value. It verifies the RS256 signature against the team's
  JWKS and pins `iss`/`aud` before minting the app's own server-issued HS256
  JWT (jose, 24h expiry). NFC staff-card login follows the same pattern against
  the central HF-ID service's JWKS.
- **Authorization**: Role-based access (`employee` / `approver`). Approver-only
  endpoints check `user.role === 'APPROVER'` server-side before mutation.
- **Account binding**: No self-signup. Admins manage the `badge` (NFC card /
  employee identity) and `email` (Cloudflare Access identity) mapping directly
  on the User row — there is no auto-provisioning from either login path.
- **Input validation**: Elysia `t.Object` schemas on every body/query/multipart.
- **Database**: Prisma ORM with parameterized queries.
- **Secrets**: `.env` and `.env*.local` are gitignored. Production secrets live
  as GitHub Actions secrets and are materialized into the deploy host's `.env`
  with mode `0600` at deploy time.
- **Image storage**: Uploaded receipts and transfer slips are served behind the
  same auth as the API (the `web` container's nginx proxies `/uploads/*`).
- **Dev backdoor**: `X-Dev-User-Id` header bypasses JWT verification. Hard-disabled
  when `NODE_ENV=production`.

## Best practices for contributors

- Never commit secrets or credentials. `git status` before every push.
- Use environment variables for anything sensitive.
- Don't disable the role check in approver endpoints.
- Don't lower the JWT signing algorithm or remove the `iss`/`aud` claims.
- Keep dependencies current via Dependabot PRs.
