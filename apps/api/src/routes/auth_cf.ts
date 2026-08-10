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
 * A kiosk is a PLACE, not a person (HF-erp CONTEXT.md: "A Kiosk is a place, not
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

// ─── Email → User resolution ─────────────────────────────────────────────────

const EMP_EMAIL_DOMAIN = 'emp.thehfhotel.org';

/**
 * Map a verified Cloudflare Access `email` claim to a local User.
 * 1. exact match on User.email (stored lowercased)
 * 2. synthetic employee address: local part = HF-ID badge (case-insensitive)
 * 3. no match → caller responds 403 (fail closed, no auto-provisioning)
 */
async function resolveUserByCfEmail(rawEmail: string) {
  const email = rawEmail.trim().toLowerCase();
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) return byEmail;
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : '';
  const domain = at > 0 ? email.slice(at + 1) : '';
  if (domain === EMP_EMAIL_DOMAIN && local.length > 0) {
    return prisma.user.findFirst({ where: { badge: { equals: local, mode: 'insensitive' } } });
  }
  return null;
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

    const user = await resolveUserByCfEmail(rawEmail);
    if (!user) {
      return status(403, {
        message: 'บัญชีนี้ยังไม่ได้ผูกกับพนักงานในระบบเบิกค่าใช้จ่าย — ติดต่อผู้ดูแลระบบ',
      });
    }

    const token = await signAuthToken({ userId: user.id, badge: user.badge ?? undefined });
    return { token, user: serializeUser(user) };
  }),
);
