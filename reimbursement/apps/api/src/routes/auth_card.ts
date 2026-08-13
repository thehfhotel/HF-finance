import { Elysia, t } from 'elysia';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { prisma } from '../db';
import { signAuthToken } from '../jwt';

/**
 * NFC staff-card login.
 *
 * Employees tap their card on a paired terminal; the browser drives a two-step
 * poll against these endpoints, and this API talks server-to-server to the
 * central HF-ID service to obtain (and verify) a signed card assertion, then
 * mints the SAME app-issued JWT session that the Cloudflare Access exchange
 * (`auth_cf.ts`) produces.
 *
 *   POST /api/auth/card-login/start  { reader_id }
 *        → HF-ID  POST /api/private/reader/claim  (X-Reader-Secret)
 *        → stashes the returned claim_token in a short-lived HttpOnly cookie
 *
 *   GET  /api/auth/card-login/wait
 *        → HF-ID  POST /api/private/reader/wait   { claim_token }
 *          · 204 → 204 (client re-polls, waiting for a tap)
 *          · 200 { assertion } → verify (RS256 via HF-ID JWKS), map badge→User,
 *                                mint session, return { token }
 *          · 403 → 403 (card not allowed)
 *
 * The assertion is an RS256 HF-ID id_token. We verify issuer + audience
 * ("reimbursement") + signature against the HF-ID JWKS, require the `apps`
 * grant to include "reimbursement", then resolve `sub` (the badge) to a local
 * User row via `User.badge`.
 */

// ─── Env config ──────────────────────────────────────────────────────────────

const READER_RESOLVE_SECRET = process.env.READER_RESOLVE_SECRET;
const HF_ID_BASE_URL = process.env.HF_ID_BASE_URL ?? 'http://192.168.100.228:5000';
const HF_ID_ISSUER = process.env.HF_ID_ISSUER ?? 'https://id.thehfhotel.org/oidc';
const HF_ID_AUDIENCE = 'reimbursement';
const APP_GRANT_KEY = 'reimbursement';

/**
 * Public origin serving HF-ID's `/api/public/reader/elevate/<ticket>` confirm
 * page. This is a Cloudflare Access BYPASS app (hf-erp
 * infra/cloudflare/gate-erp-root.ts creates `erp.thehfhotel.org/api/public*`),
 * which is exactly why the kiosk QR must point here and not at this app's own
 * hostname: the phone scanning it has no Access session and would otherwise be
 * bounced into a login it cannot complete.
 */
const HF_ID_PUBLIC_BASE_URL = (
  process.env.HF_ID_PUBLIC_BASE_URL ?? 'https://erp.thehfhotel.org'
).replace(/\/+$/, '');

const IS_PROD = process.env.NODE_ENV === 'production';

interface ReaderConfig {
  readerSecret: string;
  baseUrl: string;
  issuer: string;
}

/**
 * Resolve card-login config at request time. Only READER_RESOLVE_SECRET is
 * strictly required — the base URL + issuer have sane LAN defaults. Missing the
 * secret means the feature is not configured, so we fail closed (503).
 */
function getReaderConfig(): ReaderConfig | { missing: string[] } {
  const missing: string[] = [];
  if (!READER_RESOLVE_SECRET) missing.push('READER_RESOLVE_SECRET');
  if (missing.length > 0) return { missing };
  return {
    readerSecret: READER_RESOLVE_SECRET as string,
    baseUrl: HF_ID_BASE_URL.replace(/\/+$/, ''),
    issuer: HF_ID_ISSUER,
  };
}

// ─── HF-ID JWKS (remote, cached by jose) ─────────────────────────────────────

// createRemoteJWKSet is lazy — it doesn't fetch until first verify — and jose
// caches + cooldown-throttles the JWKS internally, so a single instance is fine.
const jwks = createRemoteJWKSet(
  new URL(`${HF_ID_BASE_URL.replace(/\/+$/, '')}/oidc/jwks`),
);

/**
 * Verify an HF-ID card assertion (RS256 id_token). Pins the algorithm, issuer
 * and audience; anything else throws.
 */
async function verifyCardAssertion(assertion: string, issuer: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(assertion, jwks, {
    issuer,
    audience: HF_ID_AUDIENCE,
    algorithms: ['RS256'],
  });
  return payload;
}

// ─── Assertion → session ─────────────────────────────────────────────────────

/**
 * Avatar initials for an auto-provisioned employee.
 *
 * Thai names have no case distinction and are often a single word, so the Latin
 * "first letter of each word" rule degrades badly. Two words → first character
 * of each; one word → its first two characters. Capped at the 4 the admin form
 * enforces. An approver can always correct it on the พนักงาน screen.
 */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw =
    words.length >= 2
      ? [...words[0]][0] + [...words[1]][0]
      : [...(words[0] ?? '')].slice(0, 2).join('');
  return (raw || '??').slice(0, 4);
}

/**
 * The ONE admission step for every authenticator.
 *
 * A card tap and a kiosk QR scan both end here, so the two produce identical
 * sessions by construction — the QR path cannot drift into being weaker than
 * the card path, because there is only one copy of the checks.
 *
 * Returns the minted session, or a `{ status, message }` the caller surfaces
 * verbatim. Callers are responsible for clearing whatever ticket cookie they
 * hold, since the two paths cookie differently.
 */
type AdmissionFailure = { ok: false; status: 401 | 403; message: string };
type AdmissionSuccess = { ok: true; token: string };

async function sessionFromAssertion(
  assertion: string,
  issuer: string,
): Promise<AdmissionSuccess | AdmissionFailure> {
  let payload: JWTPayload;
  try {
    payload = await verifyCardAssertion(assertion, issuer);
  } catch {
    return { ok: false, status: 401, message: 'Invalid card assertion' };
  }

  // The assertion must carry a grant for this app.
  const apps = payload.apps;
  if (!Array.isArray(apps) || !apps.includes(APP_GRANT_KEY)) {
    return { ok: false, status: 403, message: 'Card is not granted access to this app' };
  }

  // `sub` is the badge (the central identity anchor); `badge` mirrors it.
  const badge =
    typeof payload.sub === 'string' && payload.sub.length > 0
      ? payload.sub
      : typeof payload.badge === 'string' && payload.badge.length > 0
        ? payload.badge
        : null;
  if (!badge) {
    return { ok: false, status: 401, message: 'Card assertion missing badge' };
  }

  // Identity comes from HF-ID; only ROLES are managed here.
  //
  // HF-ID already owns the LINE ↔ employee-id linkage and just proved, in a
  // signed assertion, both who this is and that they hold the `reimbursement`
  // grant. Requiring an admin to pre-create a matching row here duplicated that
  // list and made the grant useless on its own: a properly-granted employee
  // still bounced off a 403 until someone typed their badge into this app.
  //
  // So the badge is upserted instead. `role` is set only on create and never
  // touched afterwards — promoting someone to approver is this app's decision
  // and must survive every subsequent login.
  const displayName = typeof payload.name === 'string' ? payload.name.trim() : '';
  const name = displayName.length > 0 ? displayName : `พนักงาน ${badge}`;

  const user = await prisma.user.upsert({
    where: { badge },
    // Keep the display name fresh from central, which is the authority for it.
    update: { name },
    create: { badge, name, initials: initialsFor(name), role: 'EMPLOYEE' },
  });

  // Mint the app's own session — identical shape to the Cloudflare Access
  // path, keyed on the internal User.id. `badge` is informational only.
  return { ok: true, token: await signAuthToken({ userId: user.id, badge }) };
}

// ─── Claim-token cookie ──────────────────────────────────────────────────────

const CLAIM_COOKIE = 'rb_card_claim';
const CLAIM_COOKIE_PATH = '/api/auth/card-login';
const CLAIM_COOKIE_TTL_S = 180; // matches the assertion/claim short lifetime

// Elysia's reactive `cookie` proxy is typed loosely here; a minimal shape keeps
// the handlers readable without pulling Elysia's internal Cookie generics in.
interface CookieJar {
  [name: string]: {
    value?: string;
    set(opts: Record<string, unknown>): void;
  };
}

function storeClaim(cookie: CookieJar, claimToken: string): void {
  cookie[CLAIM_COOKIE].set({
    value: claimToken,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: CLAIM_COOKIE_PATH,
    maxAge: CLAIM_COOKIE_TTL_S,
  });
}

// ─── Kiosk QR ticket cookie ──────────────────────────────────────────────────

const TICKET_COOKIE = 'rb_kiosk_ticket';
const TICKET_COOKIE_PATH = '/api/auth/kiosk-login';
const TICKET_COOKIE_TTL_S = 600; // central's elevate ticket lifetime

function storeTicket(cookie: CookieJar, ticket: string): void {
  cookie[TICKET_COOKIE].set({
    value: ticket,
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: TICKET_COOKIE_PATH,
    maxAge: TICKET_COOKIE_TTL_S,
  });
}

function clearTicket(cookie: CookieJar): void {
  cookie[TICKET_COOKIE].set({
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: TICKET_COOKIE_PATH,
    maxAge: 0,
  });
}

function clearClaim(cookie: CookieJar): void {
  cookie[CLAIM_COOKIE].set({
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PROD,
    path: CLAIM_COOKIE_PATH,
    maxAge: 0,
  });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const authCardRoutes = new Elysia().group('/auth', (group) =>
  group
    .post(
      '/card-login/start',
      async ({ body, cookie, status }) => {
        const config = getReaderConfig();
        if ('missing' in config) {
          return status(503, {
            message: `Card login not configured. Missing env: ${config.missing.join(', ')}`,
          });
        }

        let claimToken: string;
        try {
          const res = await fetch(`${config.baseUrl}/api/private/reader/claim`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Reader-Secret': config.readerSecret,
            },
            body: JSON.stringify({ reader_id: body.reader_id, app: APP_GRANT_KEY }),
          });
          if (res.status === 403 || res.status === 401) {
            return status(403, { message: 'Reader not authorized' });
          }
          if (!res.ok) {
            return status(502, { message: 'HF-ID reader claim failed' });
          }
          const data = (await res.json()) as { claim_token?: unknown };
          if (typeof data.claim_token !== 'string' || data.claim_token.length === 0) {
            return status(502, { message: 'HF-ID reader claim returned no token' });
          }
          claimToken = data.claim_token;
        } catch {
          return status(502, { message: 'HF-ID service unreachable' });
        }

        storeClaim(cookie as unknown as CookieJar, claimToken);
        return { ok: true as const };
      },
      {
        body: t.Object({
          reader_id: t.String({ minLength: 1, maxLength: 128 }),
        }),
      },
    )

    .get('/card-login/wait', async ({ cookie, status }) => {
      const config = getReaderConfig();
      if ('missing' in config) {
        return status(503, {
          message: `Card login not configured. Missing env: ${config.missing.join(', ')}`,
        });
      }

      const jar = cookie as unknown as CookieJar;
      const claimToken = jar[CLAIM_COOKIE]?.value;
      if (!claimToken) {
        return status(400, { message: 'No card-login in progress' });
      }

      // Poll the central service for a tap on this claim.
      let waitRes: Response;
      try {
        waitRes = await fetch(`${config.baseUrl}/api/private/reader/wait`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claim_token: claimToken }),
        });
      } catch {
        return status(502, { message: 'HF-ID service unreachable' });
      }

      // Still waiting for a card tap — tell the client to re-poll.
      if (waitRes.status === 204) {
        return status(204, null);
      }

      // Central rejected the claim (expired / unknown / denied).
      if (waitRes.status === 403) {
        clearClaim(jar);
        return status(403, { message: 'Card login was denied or expired' });
      }

      if (!waitRes.ok) {
        return status(502, { message: 'HF-ID reader wait failed' });
      }

      const data = (await waitRes.json()) as { assertion?: unknown };
      if (typeof data.assertion !== 'string' || data.assertion.length === 0) {
        return status(502, { message: 'HF-ID reader wait returned no assertion' });
      }

      const admitted = await sessionFromAssertion(data.assertion, config.issuer);
      clearClaim(jar);
      if (!admitted.ok) return status(admitted.status, { message: admitted.message });

      return { token: admitted.token, linked: true as const, redirect: '/' };
    })

    // ── Kiosk QR login ──────────────────────────────────────────────────────
    //
    // The reader-free authenticator. A shared terminal shows a QR; the employee
    // scans it with the phone already in their pocket and confirms in LINE, and
    // central returns the same RS256 assertion a card tap would have produced.
    //
    // This is what makes a kiosk work with no hardware at all: `reader_id`
    // exists only to name a physical tap buffer, and central's elevate endpoint
    // takes no reader — `label` is a cosmetic terminal name.
    .post('/kiosk-login/start', async ({ body, cookie, status }) => {
      const config = getReaderConfig();
      if ('missing' in config) {
        return status(503, {
          message: `Kiosk login not configured. Missing env: ${config.missing.join(', ')}`,
        });
      }

      let startRes: Response;
      try {
        startRes = await fetch(`${config.baseUrl}/api/private/reader/elevate/start`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Reader-Secret': config.readerSecret,
          },
          body: JSON.stringify({ app: APP_GRANT_KEY, label: body.label ?? '' }),
        });
      } catch {
        return status(502, { message: 'HF-ID unreachable' });
      }
      if (!startRes.ok) return status(502, { message: 'HF-ID elevate start failed' });

      const data = (await startRes.json().catch(() => null)) as { elevate_token?: unknown } | null;
      if (typeof data?.elevate_token !== 'string' || data.elevate_token.length === 0) {
        return status(502, { message: 'HF-ID elevate start returned no token' });
      }

      // The ticket is inherently public — it is about to be rendered on screen
      // as a QR. The cookie only keeps /wait parameterless, like the card path.
      storeTicket(cookie as unknown as CookieJar, data.elevate_token);

      // The QR points at HF-ID's Cloudflare-BYPASSED public path, not at this
      // app: the scanning phone has no Access session, so any Access-gated URL
      // would bounce it to a login it cannot complete.
      return { qrUrl: `${HF_ID_PUBLIC_BASE_URL}/api/public/reader/elevate/${data.elevate_token}` };
    }, {
      body: t.Object({ label: t.Optional(t.String({ maxLength: 64 })) }),
    })

    .get('/kiosk-login/wait', async ({ cookie, status }) => {
      const config = getReaderConfig();
      if ('missing' in config) {
        return status(503, {
          message: `Kiosk login not configured. Missing env: ${config.missing.join(', ')}`,
        });
      }

      const jar = cookie as unknown as CookieJar;
      const ticket = jar[TICKET_COOKIE]?.value;
      if (typeof ticket !== 'string' || ticket.length === 0) {
        return status(400, { message: 'No kiosk ticket — call start first' });
      }

      let waitRes: Response;
      try {
        waitRes = await fetch(`${config.baseUrl}/api/private/reader/elevate/wait`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Reader-Secret': config.readerSecret,
          },
          body: JSON.stringify({ elevate_token: ticket }),
        });
      } catch {
        return status(502, { message: 'HF-ID unreachable' });
      }

      // Nobody has scanned yet — keep polling.
      if (waitRes.status === 204) return status(204, null);
      // Scanned, but the employee holds no grant for this app.
      if (waitRes.status === 403) {
        clearTicket(jar);
        return status(403, { message: 'ไม่มีสิทธิ์ใช้งานระบบเบิกค่าใช้จ่าย' });
      }
      // Ticket expired — the client mints a fresh QR.
      if (waitRes.status === 404) {
        clearTicket(jar);
        return status(410, { message: 'QR expired' });
      }
      if (!waitRes.ok) return status(502, { message: 'HF-ID elevate wait failed' });

      const data = (await waitRes.json().catch(() => null)) as { assertion?: unknown } | null;
      if (typeof data?.assertion !== 'string' || data.assertion.length === 0) {
        return status(502, { message: 'HF-ID elevate wait returned no assertion' });
      }

      const admitted = await sessionFromAssertion(data.assertion, config.issuer);
      clearTicket(jar);
      if (!admitted.ok) return status(admitted.status, { message: admitted.message });

      return { token: admitted.token, linked: true as const, redirect: '/' };
    }),
);
