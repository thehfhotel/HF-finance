# Security policy

## Reporting a vulnerability

If you discover a security issue in this repository, please report it
privately rather than filing a public issue.

Open a private security advisory on GitHub:
<https://github.com/thehfhotel/hf-finance/security/advisories/new>

Or email the maintainers via a GitHub issue with the subject
`SECURITY:` and we will follow up via private channel.

We aim to acknowledge reports within 5 business days. There is no bug
bounty programme — disclosure is voluntary, and we appreciate
responsible reporters.

## Scope

In scope:

- Authentication / authorisation flaws in the web app or kbiz-bot
- Secret leakage paths (logs, generated xlsx, error responses)
- Injection / RCE / SSRF in the web app or deploy script
- Supply-chain issues in pinned dependencies or actions

Out of scope:

- The K BIZ banking interface itself (report to KBank)
- Issues that require physical access to the deploy host
- Best-practice nits without a demonstrable impact (please open a regular
  issue or PR comment instead)
