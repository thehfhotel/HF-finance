import { Elysia } from 'elysia';
import { prisma } from './db';
import { verifyAuthToken } from './jwt';

// Honor the X-Dev-User-Id impersonation header ONLY in an explicit dev
// environment. Using `=== 'development'` (rather than `!== 'production'`) makes
// the bypass fail closed when NODE_ENV is unset or misconfigured.
const ALLOW_DEV_USER_HEADER = process.env.NODE_ENV === 'development';

/**
 * JWT-backed authentication plugin.
 *
 * Looks for `Authorization: Bearer <jwt>`, verifies it, and resolves the
 * internal `User` via the `userId` claim. The token is issued after a
 * verified Cloudflare Access login or an NFC card tap, so `userId` is always
 * present here.
 *
 * In dev, we additionally honor `X-Dev-User-Id: <userId>` so the existing
 * tweaks panel "view as employee/approver" toggle keeps working without
 * forcing a real Cloudflare Access round-trip during local development. This
 * bypass is enabled ONLY when `NODE_ENV=development`, so it fails closed when
 * NODE_ENV is unset or set to anything else (production included).
 */
export const auth = new Elysia({ name: 'auth' }).derive(
  { as: 'scoped' },
  async ({ headers, status }) => {
    if (ALLOW_DEV_USER_HEADER) {
      const devUserId = headers['x-dev-user-id'];
      if (devUserId) {
        const user = await prisma.user.findUnique({ where: { id: devUserId } });
        if (!user) return status(401, { message: 'Dev user not found' });
        return { user };
      }
    }

    const authz = headers.authorization;
    if (!authz?.startsWith('Bearer ')) {
      return status(401, { message: 'Missing Authorization: Bearer header' });
    }
    const token = authz.slice('Bearer '.length).trim();

    let claims;
    try {
      claims = await verifyAuthToken(token);
    } catch {
      return status(401, { message: 'Invalid or expired token' });
    }

    const user = await prisma.user.findUnique({ where: { id: claims.userId } });
    if (!user) {
      return status(401, { message: 'User no longer exists' });
    }

    return { user };
  },
);
