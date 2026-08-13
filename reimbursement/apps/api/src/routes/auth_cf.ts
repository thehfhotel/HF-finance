import { Elysia } from 'elysia';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '../db';
import { signAuthToken } from '../jwt';
import { serializeUser } from '../serializers';

/**
 * Cloudflare Access → app-JWT exchange.
 *
 * The whole app sits behind a Cloudflare Access wall. Once a user clears that
 * wall (via Google or the HF ID identity provider, which itself may be
 * fronted by LINE) the edge injects a signed `Cf-Access-Jwt-Assertion` header
 * on every proxied request. We never trust that the header is merely
 * *present* — we verify it RS256 against the team's JWKS and pin issuer +
 * audience, then map the verified `email` claim to a local `User` row and
 * mint this app's own session JWT (the same `signAuthToken` used by the NFC
 * card-tap path).
 *
 *   POST /api/auth/cf-login
 *        → read `Cf-Access-Jwt-Assertion` header
 *        → verify RS256 via the CF Access team JWKS (iss/aud pinned)
 *        → map payload.email → User (see resolveUserByCfEmail)
 *        → mint session, return { token, user }
 */

// ─── Env config ──────────────────────────────────────────────────────────────

const CF_ACCESS_TEAM_DOMAIN =
  process.env.CF_ACCESS_TEAM_DOMAIN ?? 'laikaexpress.cloudflareaccess.com';
const CF_ACCESS_AUD = process.env.CF_ACCESS_AUD;

/**
 * Shared-terminal identities, in HF One's format: `email=kiosk-id,email2=id2`.
 *
 * A kiosk is a PLACE, not a person (hf-erp CONTEXT.md: "A Kiosk is a place, not
 * a person — it must never be treated as an employee"). The office/reception PCs
 * clear Cloudflare Access as a shared Google account, so without this map their
 * verified email either resolves to some employee row — attributing every
 * receipt typed at that PC to a place — or fails closed with a 403 that reads as
 * a bug to whoever is standing there.
 *
 * Unset or empty ⇒ no session is ever a kiosk, i.e. the feature is dark and
 * every identity takes the ordinary employee path. Same fail-closed posture as
 * CF_ACCESS_AUD and READER_RESOLVE_SECRET.
 */
const KIOSK_EMAILS = parseKioskEmails(process.env.KIOSK_EMAILS);

function parseKioskEmails(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of (raw ?? '').split(',')) {
    const [email, kioskId] = pair.split('=');
    const key = email?.trim().toLowerCase();
    const id = kioskId?.trim();
    if (key && id) map.set(key, id);
  }
  return map;
}
const CF_ACCESS_CERTS_URL =
  process.env.CF_ACCESS_CERTS_URL ??
  `https://${CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;

interface CfAccessConfig {
  aud: string;
}

/**
 * Resolve CF Access config at request time. Only CF_ACCESS_AUD is strictly
 * required — the team domain has a sane default. Missing the audience means
 * the feature is not configured, so we fail closed (503).
 */
function getCfAccessConfig(): CfAccessConfig | { missing: string[] } {
  const missing: string[] = [];
  if (!CF_ACCESS_AUD) missing.push('CF_ACCESS_AUD');
  if (missing.length > 0) return { missing };
  return { aud: CF_ACCESS_AUD as string };
}

// ─── CF Access JWKS (remote, cached by jose) ─────────────────────────────────

// createRemoteJWKSet is lazy — it doesn't fetch until first verify — and jose
// caches + cooldown-throttles the JWKS internally, so a single instance is fine.
const jwks = createRemoteJWKSet(new URL(CF_ACCESS_CERTS_URL));

/**
 * Is this request carrying a valid Cloudflare Access identity?
 *
 * Used to gate /uploads, which serves receipt photos and bank-transfer slips.
 * Those cannot be gated on the app JWT: a browser does not attach an
 * Authorization header to an <img> request, so the token never arrives. The
 * Access assertion does — the edge injects it on every proxied request,
 * including image loads — and it is the same signed identity this app already
 * trusts to mint sessions.
 *
 * Returns false when Access is not configured, so a dev machine without
 * Cloudflare in front still serves its own uploads.
 */
export async function hasValidCfIdentity(assertion: string | undefined): Promise<boolean> {
  if (!CF_ACCESS_AUD) return true; // not configured (dev) — nothing to verify against
  if (!assertion) return false;
  try {
    await jwtVerify(assertion, jwks, {
      issuer: `https://${CF_ACCESS_TEAM_DOMAIN}`,
      audience: CF_ACCESS_AUD,
      algorithms: ['RS256'],
    });
    return true;
  } catch {
    return false;
  }
}

// ─── Email → User resolution ─────────────────────────────────────────────────

const EMP_EMAIL_DOMAIN = 'emp.thehfhotel.org';

/**
 * Map a verified Cloudflare Access `email` claim to a local User.
 * 1. exact match on User.email (stored lowercased)
 * 2. synthetic employee address: local part = HF-ID badge (case-insensitive)
 * 3. no match → caller responds 403 (fail closed, no auto-provisioning)
 */
async function resolveUserByCfEmail(rawEmail: string, displayName?: string) {
  const email = rawEmail.trim().toLowerCase();
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) return byEmail;
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : '';
  const domain = at > 0 ? email.slice(at + 1) : '';
  if (domain === EMP_EMAIL_DOMAIN && local.length > 0) {
    const byBadge = await prisma.user.findFirst({
      where: { badge: { equals: local, mode: 'insensitive' } },
    });
    if (byBadge) return byBadge;

    // Same rule as the card/QR paths: HF-ID owns identity, this app owns roles.
    //
    // Only the synthetic `<badge>@emp.thehfhotel.org` domain reaches here, and
    // Cloudflare only ever mints that address through the HF ID provider, whose
    // policy on this app already requires `apps contains reimbursement`. So the
    // grant has been verified upstream and a matching row is pure bookkeeping —
    // without this, an employee central has explicitly authorised still bounces
    // off a 403 with no way to fix it themselves.
    //
    // A Google address can never match this domain, so managers are unaffected
    // and that path still fails closed below.
    const name = displayName?.trim() || `พนักงาน ${local}`;
    return prisma.user.create({
      data: { badge: local, name, initials: initialsFor(name), role: 'EMPLOYEE' },
    });
  }
  return null;
}

/** Avatar initials — mirrors the rule used for card/QR provisioning. */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw =
    words.length >= 2
      ? [...words[0]][0] + [...words[1]][0]
      : [...(words[0] ?? '')].slice(0, 2).join('');
  return (raw || '??').slice(0, 4);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const authCfRoutes = new Elysia().group('/auth', (group) =>
  group.post('/cf-login', async ({ headers, status }) => {
    const config = getCfAccessConfig();
    if ('missing' in config) {
      return status(503, {
        message: `Cloudflare Access login not configured. Missing env: ${config.missing.join(', ')}`,
      });
    }

    const assertion = headers['cf-access-jwt-assertion'];
    if (!assertion) {
      return status(401, {
        message: 'ไม่พบข้อมูลยืนยันตัวตนจาก Cloudflare Access กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
      });
    }

    let payload;
    try {
      const result = await jwtVerify(assertion, jwks, {
        issuer: `https://${CF_ACCESS_TEAM_DOMAIN}`,
        audience: config.aud,
        algorithms: ['RS256'],
      });
      payload = result.payload;
    } catch {
      return status(401, {
        message: 'ไม่พบข้อมูลยืนยันตัวตนจาก Cloudflare Access กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
      });
    }

    const rawEmail = payload.email;
    if (typeof rawEmail !== 'string' || rawEmail.length === 0) {
      return status(403, {
        message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงานในระบบเบิกค่าใช้จ่าย — ติดต่อผู้ดูแลระบบ',
      });
    }

    // Kiosk check comes BEFORE the user lookup, deliberately. The office PC's
    // shared Google is also present on an employee row, and the kiosk identity
    // has to win — otherwise that terminal keeps signing itself in as a person.
    // Ordering it this way also means switching a terminal to kiosk mode is a
    // pure env change, with no row to migrate and nothing to undo.
    const kioskId = KIOSK_EMAILS.get(rawEmail.trim().toLowerCase());
    if (kioskId) {
      // Not an error: a place has no session. The SPA reads this as "show the
      // card-tap screen" so an employee can attach themselves to the terminal.
      return { kiosk: true as const, kioskId };
    }

    // Cloudflare forwards the IdP's display name when it has one; HF-ID's own
    // fallback (`พนักงาน <badge>`) is used when it doesn't, and the next card or
    // QR login refreshes it from central either way.
    const cfName = typeof payload.name === 'string' ? payload.name : undefined;

    const user = await resolveUserByCfEmail(rawEmail, cfName);
    if (!user) {
      return status(403, {
        message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงานในระบบเบิกค่าใช้จ่าย — ติดต่อผู้ดูแลระบบ',
      });
    }

    const token = await signAuthToken({ userId: user.id, badge: user.badge ?? undefined });
    return { token, user: serializeUser(user) };
  }),
);
