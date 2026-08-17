// Reimbursement — which property the signed-in viewer is STANDING AT, handed to
// the HF One top bar as its optional `data-property` attribute.
//
// The bar (hf-erp `public/shell/hf-bar.js`) lists every estate tool, including
// two identical-looking "Room Daily Report" cards, one per hotel. The HF Ville
// reception desk kept opening HF's and filing a day's rooms against the wrong
// hotel. Given `data-property` the bar leaves the OTHER property's
// branch-specific tools out of its switcher. The bar is served from a
// Cloudflare-BYPASSED, edge-cached path and must stay one identity-blind body
// for every viewer, so only the host app can say where its user is standing
// (hf-erp `design/HF-ONE.md`, the "data-property" section).
//
// Resolved HERE, on the server, from the Access assertion `resolveCfIdentity`
// has already RS256-verified against Cloudflare's JWKS with the issuer and
// audience pinned. The browser never gets a say in which property it claims.
//
// COSMETIC ONLY, and never an access decision. Cloudflare Access still admits
// exactly who it admitted before; every URL stays reachable; nothing here
// grants or denies anything.
//
// FAIL OPEN everywhere, unlike the login path around it. An unknown identity,
// an unparseable override or anything thrown means "no hint", which lists every
// tool. The failure mode of a display filter must be a cluttered switcher,
// never a missing tool.

/** The two properties the estate band knows about. */
export type PropertyHint = 'hf' | 'hfville';

/**
 * Shared reception identities that imply a PLACE, by the Google account
 * Cloudflare Access signs them in as.
 *
 * THE RULE FOR THIS MAP: an identity belongs here only if it is signed in at
 * exactly ONE desk. Scoping is a statement about a place, so an identity that
 * exists at two desks would steer one of them to the wrong hotel's form — the
 * very failure this exists to prevent. Two identities are deliberately absent;
 * do NOT "fix" this by adding them back:
 *
 *   theharbourfront.hotel@gmail.com  HF's reception identity, but ALSO signed
 *                                    in as Chrome `Profile 1` on the HF VILLE
 *                                    reception PC (that desk needs both), so it
 *                                    names no place. Scoping it to 'hf' would
 *                                    hide HF Ville's own card at the HF Ville
 *                                    desk — this bug from the other side.
 *   sdyoffice66@gmail.com            the office PC (`office-1`) — the office
 *                                    works both properties, and it is this
 *                                    app's card-tap terminal.
 *
 * Managers, LINE-authenticated employees (the synthetic
 * `<badge>@emp.thehfhotel.org` addresses), phones and unknown callers name no
 * place either, and fall through to no hint.
 *
 * `hfville.hotel@gmail.com` qualifies: Access knows it as kiosk
 * `hfville-reception-1`, and it exists only at the HF Ville front desk. Matches
 * hf-erp `src/server/property.ts`, ota-desk `lib/property-hint.ts`,
 * housekeeping `src/server/shell.ts` and payroll `src/property-hint.ts`, which
 * scope the same desk on the same rule.
 */
const DEFAULT_KIOSK_PROPERTY_EMAILS = 'hfville:hfville.hotel@gmail.com';

/**
 * Parsed fresh on every call so a container restart with a changed env (or a
 * test) never reads a stale snapshot — the estate's kiosk-map convention. Note
 * this differs from `KIOSK_EMAILS` next door in `routes/auth_cf.ts`, which is
 * parsed once at module load.
 *
 * DELIBERATELY NOT NAMED `KIOSK_EMAILS`, and deliberately a different SHAPE.
 * That variable answers a different question — "is this identity a shared
 * terminal that should get the card-tap screen rather than a session?" — and
 * its value (`.github/workflows/deploy-reimbursement.yml`) maps BOTH reception
 * mailboxes as `email=kiosk-id`. That mapping is correct for what it does and
 * must not change, but it is the wrong input here: feeding it in would scope
 * `theharbourfront.hotel@gmail.com` to 'hf' and break the HF Ville desk. The
 * distinct name AND the inverted `property:email` shape mean the two values can
 * never be pasted into each other unnoticed — an `email=kiosk-id` entry has no
 * `:` and is dropped as unkeyed. ota-desk took the same precaution for the same
 * reason.
 */
export function kioskPropertyEmails(): Map<string, PropertyHint> {
  // `||` on purpose: compose materializes an unset var as EMPTY, and empty must
  // mean "use the defaults", never "no kiosk has a property" — the latter would
  // quietly drop the scoping the HF Ville desk depends on.
  const raw = (process.env.KIOSK_PROPERTY_EMAILS ?? '').trim() || DEFAULT_KIOSK_PROPERTY_EMAILS;
  const map = new Map<string, PropertyHint>();
  for (const entry of raw.split(',')) {
    const text = entry.trim();
    const separator = text.indexOf(':');
    if (separator < 0) continue; // an unkeyed email names no property
    const property = text.slice(0, separator).trim().toLowerCase();
    const email = text.slice(separator + 1).trim().toLowerCase();
    // A half-written or unknown-property entry is DROPPED, never guessed at —
    // an unscoped identity simply sees every tool.
    if (!email || !isPropertyHint(property)) continue;
    map.set(email, property);
  }
  return map;
}

function isPropertyHint(value: string): value is PropertyHint {
  return value === 'hf' || value === 'hfville';
}

/**
 * The property this already-verified identity is standing at, or `undefined`
 * when it names no single place (managers, employees, the office PC, HF's
 * dual-desk reception identity, unknown or unauthenticated callers).
 *
 * Never throws: any failure yields `undefined` (fail open → the full switcher).
 */
export function propertyHintForEmail(email: string | null | undefined): PropertyHint | undefined {
  try {
    const normalized = String(email ?? '')
      .trim()
      .toLowerCase();
    if (!normalized) return undefined;
    return kioskPropertyEmails().get(normalized);
  } catch {
    return undefined;
  }
}
