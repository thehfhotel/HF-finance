import { SignJWT, jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

const JWT_EXPIRY_HOURS = Number(process.env.JWT_EXPIRY_HOURS ?? 24);
const SECRET_BYTES = new TextEncoder().encode(JWT_SECRET);
const ISSUER = 'reimbursement-api';
const AUDIENCE = 'reimbursement-web';

/**
 * Claims carried in app-issued JWTs. Issued after a verified Cloudflare Access
 * login (email claim resolved to a User row) or an NFC card tap (badge
 * resolved to a User row).
 */
export interface AuthClaims {
  /** Internal User.id. Always present — the pre-link state no longer exists. */
  userId: string;
  /** HF-ID badge when the session came from a card tap. Informational. */
  badge?: string;
}

export async function signAuthToken(claims: AuthClaims): Promise<string> {
  return await new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${JWT_EXPIRY_HOURS}h`)
    .sign(SECRET_BYTES);
}

export async function verifyAuthToken(token: string): Promise<AuthClaims> {
  const { payload } = await jwtVerify(token, SECRET_BYTES, {
    issuer: ISSUER,
    audience: AUDIENCE,
  });
  if (typeof payload.userId !== 'string') {
    throw new Error('Token missing userId');
  }
  return {
    userId: payload.userId,
    badge: typeof payload.badge === 'string' ? payload.badge : undefined,
  };
}
