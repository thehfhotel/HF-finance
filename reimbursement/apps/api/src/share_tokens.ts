import { timingSafeEqual } from 'node:crypto';
import { prisma } from './db';
import type { User } from './generated/prisma';
import { generateShareToken, hashShareToken, looksLikeShareToken } from './share_token_crypto';

export { hashShareToken, looksLikeShareToken } from './share_token_crypto';

/**
 * Share tokens — the credential an employee's phone holds so an iOS Shortcut
 * can POST a shared receipt into that employee's inbox.
 *
 * Design notes, because each one is a deliberate refusal of the obvious thing:
 *
 * - **Opaque random bytes, not a JWT.** Revocation has to be immediate, and a
 *   JWT would need this same database lookup to be revocable — so the JWT buys
 *   nothing and adds a signature to leak. The token is 32 random bytes.
 *
 * - **Only the hash is stored.** A dump of `share_tokens` cannot be replayed
 *   against the API. The plaintext exists exactly once, in the response that
 *   creates it.
 *
 * - **Plain SHA-256, not bcrypt/argon2.** Those exist to make *low-entropy*
 *   secrets expensive to guess. This secret is 256 bits of CSPRNG output, so
 *   there is nothing to brute-force, and a slow KDF on the hot upload path
 *   would only be a denial-of-service lever.
 *
 * - **`hfr_` prefix.** Makes a leaked token greppable in logs, chat history and
 *   secret scanners — the same reason GitHub prefixes `ghp_`.
 *
 * The token authenticates ONE endpoint (`POST /api/inbox/quick`). It is not
 * a session: it cannot read receipts, list bundles, or log in.
 *
 * The crypto itself lives in `share_token_crypto.ts` — that module imports no
 * database, so the rules deciding whether a credential is accepted are testable
 * without one.
 */

/**
 * Most tokens an employee may hold at once.
 *
 * Not a security boundary — it is a "you have twelve forgotten tokens" guard.
 * Each phone needs exactly one; a handful covers replacing a lost device
 * without pruning.
 */
export const MAX_TOKENS_PER_USER = 5;

export interface IssuedShareToken {
  /** The plaintext. Returned ONCE, never stored, never recoverable. */
  token: string;
  id: string;
  hint: string;
  label: string;
  /** Always null on a freshly issued token — nothing has used it yet. Present
   *  so this shape serializes through the same path as a listed token. */
  lastUsedAt: Date | null;
  createdAt: Date;
}

/**
 * Mint a token for a user and persist only its hash.
 *
 * Returns the plaintext — the ONLY moment it exists. The caller must hand it
 * straight to the employee (QR + copy button) and keep it out of logs.
 */
export async function issueShareToken(userId: string, label: string): Promise<IssuedShareToken> {
  const active = await prisma.shareToken.count({ where: { userId, revokedAt: null } });
  if (active >= MAX_TOKENS_PER_USER) {
    throw new ShareTokenLimitError(MAX_TOKENS_PER_USER);
  }

  const generated = generateShareToken();

  const row = await prisma.shareToken.create({
    data: {
      userId,
      tokenHash: generated.tokenHash,
      hint: generated.hint,
      label: label.trim().slice(0, 60),
    },
  });

  return {
    token: generated.token,
    id: row.id,
    hint: row.hint,
    label: row.label,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
  };
}

export class ShareTokenLimitError extends Error {
  constructor(readonly limit: number) {
    super(`At most ${limit} share tokens per user`);
    this.name = 'ShareTokenLimitError';
  }
}

/**
 * Resolve a presented token to its owner, or null.
 *
 * Null for every failure mode — unknown, revoked, malformed — so a caller
 * cannot distinguish "no such token" from "revoked token" and use the API as an
 * oracle. `lastUsedAt` is stamped on success so the settings screen can show a
 * token nobody uses, which is the one most likely to have leaked.
 */
export async function resolveShareToken(presented: string): Promise<User | null> {
  if (!looksLikeShareToken(presented)) return null;

  const row = await prisma.shareToken.findUnique({
    where: { tokenHash: hashShareToken(presented) },
    include: { user: true },
  });

  if (!row) return null;
  if (row.revokedAt !== null) return null;

  // The lookup above is already an exact match on a unique index, so this
  // comparison can only ever succeed — it is here so that the hash never
  // becomes something we compare with `===` if this function is later changed
  // to scan candidates. Cheap, and it keeps the constant-time habit intact.
  const presentedHash = Buffer.from(hashShareToken(presented), 'hex');
  const storedHash = Buffer.from(row.tokenHash, 'hex');
  if (presentedHash.length !== storedHash.length) return null;
  if (!timingSafeEqual(presentedHash, storedHash)) return null;

  // Fire-and-forget: a failed bookkeeping write must never fail an upload the
  // employee is standing there waiting for.
  void prisma.shareToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch((error) => console.error('[share-token] lastUsedAt update failed:', error));

  return row.user;
}

/**
 * Revoke one token, scoped to its owner.
 *
 * `userId` is part of the WHERE clause rather than checked afterwards, so one
 * employee can never revoke another's token by guessing an id. Returns false
 * when nothing matched — already revoked, wrong owner, or no such token.
 */
export async function revokeShareToken(userId: string, tokenId: string): Promise<boolean> {
  const { count } = await prisma.shareToken.updateMany({
    where: { id: tokenId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count > 0;
}

/** A user's tokens, newest first. Never includes a hash — there is nothing to show. */
export async function listShareTokens(userId: string) {
  return prisma.shareToken.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, hint: true, label: true, lastUsedAt: true, createdAt: true },
  });
}
