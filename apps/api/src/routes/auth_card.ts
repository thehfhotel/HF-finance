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

      // Verify the signed assertion (RS256, issuer + audience pinned).
      let payload: JWTPayload;
      try {
        payload = await verifyCardAssertion(data.assertion, config.issuer);
      } catch {
        clearClaim(jar);
        return status(401, { message: 'Invalid card assertion' });
      }

      // The assertion must carry a grant for this app.
      const apps = payload.apps;
      if (!Array.isArray(apps) || !apps.includes(APP_GRANT_KEY)) {
        clearClaim(jar);
        return status(403, { message: 'Card is not granted access to this app' });
      }

      // `sub` is the badge (the central identity anchor); `badge` mirrors it.
      const badge =
        typeof payload.sub === 'string' && payload.sub.length > 0
          ? payload.sub
          : typeof payload.badge === 'string' && payload.badge.length > 0
            ? payload.badge
            : null;
      if (!badge) {
        clearClaim(jar);
        return status(401, { message: 'Card assertion missing badge' });
      }

      // Map badge → this app's employee row. No auto-provisioning: a badge that
      // isn't linked to a User can't log in (surfaces the impedance mismatch
      // rather than silently minting a stray account).
      const user = await prisma.user.findUnique({ where: { badge } });
      clearClaim(jar);
      if (!user) {
        return status(403, {
          message: 'บัตรนี้ยังไม่ได้ผูกกับพนักงานในระบบเบิกค่าใช้จ่าย',
        });
      }

      // Mint the app's own session — identical shape to the Cloudflare Access
      // path, keyed on the internal User.id. `badge` is informational only.
      const token = await signAuthToken({ userId: user.id, badge });

      return { token, linked: true as const, redirect: '/' };
    }),
);
