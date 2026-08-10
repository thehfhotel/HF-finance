# CR-2026-08-10: HF-ID owns identity; this app owns roles

## What

An HF-ID assertion that carries the `reimbursement` grant now **provisions the
employee** instead of bouncing off a 403. `sessionFromAssertion` upserts on
`User.badge`:

- **create** — `{ badge, name, initials, role: EMPLOYEE }`
- **update** — `{ name }` only

`role` is written once, on create, and never touched again, so promoting
someone to approver survives every subsequent login. `initials` is derived from
the display name (two words → first character of each; one word → first two
characters) and an approver can correct it on the พนักงาน screen.

**`name` is deliberately NOT create-only.** Central is the authority for display
names, so every assertion login refreshes it and names stay consistent across
every HF app. The accepted consequence: editing a name on the พนักงาน screen is
not durable for anyone who logs in by card or QR — their next login restores
central's value. Change the name in HF-ID Employee Management instead. This was
confirmed live on 2026-08-10: badge 421 was `นัท` here and `วิณัฐ` at central,
and the first QR login renamed the row to `วิณัฐ` as designed. `initials` was
untouched, because that one *is* create-only.

This applies to the two paths that carry a **signed HF-ID assertion** — NFC card
tap and the kiosk QR scan. The Cloudflare Access path is unchanged: a Google
identity carries no badge to anchor on, and the `managers` tier is a short
explicit allowlist, so those still resolve by `User.email` / synthetic
`<badge>@emp.thehfhotel.org` and still fail closed on no match.

Supersedes the "No match → fail-closed 403. No auto-provisioning." paragraph of
[CR-2026-07-29](./CR-2026-07-29-cloudflare-access-login.md) for assertion-based
logins only, and updates the **Identity mapping** convention in `CLAUDE.md`.

## Why

HF-ID (fingerprint-time-logger) already holds the LINE ↔ employee-id linkage and
the per-app grants. Keeping a second employee list here meant the same person
had to be registered twice, and the grant was useless on its own: an employee
that central had explicitly authorised for `reimbursement` still could not log
in until someone typed their badge into this app.

That surfaced concretely while enabling kiosk login. Only two of three users had
a badge, so a correctly-granted receptionist scanning the kiosk QR would have hit
*"บัตรนี้ยังไม่ได้ผูกกับพนักงานในระบบเบิกค่าใช้จ่าย"* — an error caused purely by
bookkeeping, at the moment they were standing at the terminal trying to work.

The assertion already carries everything needed, so nothing has to be invented:

```python
# fingerprint-time-logger, app/api/reader.py (origin/main)
assertion = oidc_service.mint_id_token(
    badge=tap["badge"],
    email=oidc_service.synthetic_email_for_badge(tap["badge"]),
    name=tap["display_name"],
    apps=tap["apps"],
    audience=app,
)
```

## Is this weaker?

No — the gate moved rather than opened. Provisioning happens only after an
assertion has passed every existing check: RS256 signature against the HF-ID
JWKS, pinned issuer and audience, and `apps ∋ "reimbursement"`. An employee
without that grant is still refused, exactly as before. What changed is that
central's authorisation is now sufficient on its own, instead of needing a
manual echo in this database.

`email` is deliberately left null on auto-provisioned rows. The badge is the
anchor, `resolveUserByCfEmail` already falls back from the synthetic address to
a badge match, and writing a synthetic address would collide if an approver
later attaches the person's real Google account.

## Risk / rollback

New rows land as `EMPLOYEE`, which can see and submit only their own receipts,
so the blast radius of an unexpected provision is one employee's own data.
Rolling back is restoring the `findUnique` + 403 in `sessionFromAssertion`; rows
already created stay valid and keep working.

Watch for: a display-name change at central renaming a row here (intended), and
duplicate people if a badge is ever re-issued to a different employee — central
treats the badge as the identity anchor, so that would be a problem upstream of
this app too.
