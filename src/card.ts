// Card-login verification — turns a signed HF ID "card assertion" (an RS256
// OIDC id_token minted by the central HF ID service on an NFC staff tap) into
// a payroll identity. Kept separate from the Elysia chain so the verify+authz
// logic is unit-testable without booting the HTTP server (see test/card.test.ts).
//
// The one-and-only remote JWKS set is built here at module scope — jose caches
// the fetched public keys across verifications, so we must NOT rebuild it per
// request.

import { jwtVerify, createRemoteJWKSet } from "jose";
import type { JWTVerifyGetKey, KeyLike } from "jose";

// Empty-string-safe env reads: run-deploy.sh materialises .env from the CI
// payload, so an unset GH value can land as `KEY=''`. Treat blank as "use the
// default" rather than overriding the default with an empty string.
const envOr = (v: string | undefined, fallback: string): string =>
  v && v.trim() ? v.trim() : fallback;

// Central HF ID service on the evergreen LAN (reachable from the container).
export const HF_ID_BASE_URL = envOr(process.env.HF_ID_BASE_URL, "http://192.168.100.228:5000");
// Expected id_token issuer — must match the central OIDC issuer.
export const HF_ID_ISSUER = envOr(process.env.HF_ID_ISSUER, "https://id.thehfhotel.org/oidc");

// Built once at module load; jose lazily fetches + caches the keys on first use.
export const cardAssertionJwks = createRemoteJWKSet(new URL(HF_ID_BASE_URL + "/oidc/jwks"));

export type CardAssertionFailure = "invalid" | "not_authorized";

// Thrown by verifyCardAssertion. `reason` maps to an HTTP status at the route:
//   "invalid"        → 401 (bad signature / issuer / audience / expiry)
//   "not_authorized" → 403 (verified, but no `payroll` grant)
export class CardAssertionError extends Error {
  constructor(public readonly reason: CardAssertionFailure, message: string) {
    super(message);
    this.name = "CardAssertionError";
  }
}

export interface CardIdentity {
  badge: string;
  name?: string;
  apps: string[];
}

// Verify a card assertion and confirm it carries the `payroll` grant.
//
// `key` is the remote JWKS resolver in production (pass `cardAssertionJwks`);
// tests pass a local public key so no network/JWKS stubbing is needed.
export async function verifyCardAssertion(
  assertion: string,
  key: JWTVerifyGetKey | KeyLike | Uint8Array,
  opts?: { issuer?: string },
): Promise<CardIdentity> {
  let payload;
  try {
    // jose enforces issuer, audience, signature (RS256 only) and exp/nbf.
    ({ payload } = await jwtVerify(assertion, key as JWTVerifyGetKey, {
      issuer: opts?.issuer ?? HF_ID_ISSUER,
      audience: "payroll",
      algorithms: ["RS256"],
    }));
  } catch {
    throw new CardAssertionError("invalid", "card assertion failed verification");
  }

  // Defense in depth: the central /wait already authorized, but re-check the
  // grant list on our side before minting a session.
  const apps = Array.isArray(payload.apps)
    ? payload.apps.filter((a): a is string => typeof a === "string")
    : [];
  if (!apps.includes("payroll")) {
    throw new CardAssertionError("not_authorized", "card assertion lacks the payroll grant");
  }

  return {
    badge: typeof payload.sub === "string" ? payload.sub : "",
    name: typeof payload.name === "string" ? payload.name : undefined,
    apps,
  };
}
