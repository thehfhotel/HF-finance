import { createHash, randomBytes } from 'node:crypto';

/**
 * The pure half of share tokens: generating, hashing and shape-checking them.
 *
 * Split out from `share_tokens.ts` because that module imports `./db`, which
 * throws at import time without `DATABASE_URL`. Keeping the crypto here means
 * the rules that actually decide whether a credential is accepted can be tested
 * with no database, no environment and no network — matching the pure-core /
 * driver split the monorepo already uses for kbiz-bot.
 *
 * Nothing in this file touches IO. If that stops being true, the tests stop
 * being able to run, which is the point.
 */

/** Prefix on every issued token. Not secret — an identifier, so leaks are findable. */
export const TOKEN_PREFIX = 'hfr_';

/** Bytes of entropy in the random part. 32 bytes = 256 bits. */
export const TOKEN_BYTES = 32;

/** Characters of the random part shown in the UI, e.g. `hfr_a1b2c3…`. */
export const HINT_LENGTH = 6;

/**
 * SHA-256 of the plaintext, hex. The only form that reaches the database.
 *
 * Plain SHA-256 rather than bcrypt/argon2 on purpose: those exist to make
 * *low-entropy* secrets expensive to guess, and this secret is 256 bits of
 * CSPRNG output — there is nothing to brute-force. A slow KDF on the upload
 * path would only be a denial-of-service lever.
 */
export function hashShareToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Is this even shaped like one of our tokens?
 *
 * A cheap structural reject so a malformed Authorization header never costs a
 * database round trip. Deliberately NOT a security check — a well-formed token
 * still has to match a stored hash.
 */
export function looksLikeShareToken(candidate: string): boolean {
  if (!candidate.startsWith(TOKEN_PREFIX)) return false;
  const random = candidate.slice(TOKEN_PREFIX.length);
  return random.length === TOKEN_BYTES * 2 && /^[0-9a-f]+$/.test(random);
}

export interface GeneratedToken {
  /** The plaintext. Exists here and in the creation response — nowhere else. */
  token: string;
  /** What gets stored. */
  tokenHash: string;
  /** What the UI shows so a person can tell two tokens apart. */
  hint: string;
}

/** Mint a fresh token and everything derived from it. */
export function generateShareToken(): GeneratedToken {
  const random = randomBytes(TOKEN_BYTES).toString('hex');
  const token = `${TOKEN_PREFIX}${random}`;
  return {
    token,
    tokenHash: hashShareToken(token),
    hint: random.slice(0, HINT_LENGTH),
  };
}
