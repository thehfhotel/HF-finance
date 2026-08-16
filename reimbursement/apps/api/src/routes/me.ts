import { Elysia, t } from 'elysia';
import { auth } from '../auth';
import { serializeShareToken, serializeUser } from '../serializers';
import { buildShareSetup } from '../share_setup';
import {
  ShareTokenLimitError,
  issueShareToken,
  listShareTokens,
  revokeShareToken,
} from '../share_tokens';

/**
 * `/me` — the authenticated user, and the credentials their own phone holds.
 *
 * Mounted under `/api` by `index.ts`, so the public path is `/api/me`.
 *
 * Every share-token route here is scoped to the caller by construction: the
 * user id comes from the session, never from the request, so there is no
 * "whose token is this" check to forget. An approver has no route into another
 * employee's tokens either — deliberately. A manager who needs to cut off a
 * lost phone deletes or disables the employee, which cascades.
 */
export const meRoutes = new Elysia({ prefix: '/me' })
  .use(auth)
  .get('/', ({ user }) => serializeUser(user))

  /**
   * The values an iPhone Shortcut needs besides the employee's own token.
   *
   * Session-authenticated, so only somebody who has already cleared Cloudflare
   * Access can read it — which is the whole argument for serving it at all
   * (see `share_setup.ts`). `no-store` because the response carries a
   * credential: without it a proxy or the browser's bfcache could hold the
   * service-token secret after the employee has logged out.
   */
  .get('/share-setup', ({ set }) => {
    set.headers['cache-control'] = 'no-store';
    return buildShareSetup(process.env);
  })

  /** My phones. Never includes a token — there is nothing to show but the hint. */
  .get('/share-tokens', async ({ user }) => {
    const tokens = await listShareTokens(user.id);
    return tokens.map(serializeShareToken);
  })

  /**
   * Mint a token for a phone. The plaintext is in THIS response and nowhere
   * else, ever — the client shows it as a QR code for the Shortcut to scan.
   */
  .post(
    '/share-tokens',
    async ({ user, body, status, set }) => {
      try {
        const issued = await issueShareToken(user.id, body.label ?? '');
        set.status = 201;
        return {
          ...serializeShareToken(issued),
          token: issued.token,
        };
      } catch (error) {
        if (error instanceof ShareTokenLimitError) {
          return status(409, {
            message: `ถึงขีดจำกัดแล้ว (${error.limit} เครื่อง) — เพิกถอนเครื่องเก่าก่อน`,
          });
        }
        throw error;
      }
    },
    { body: t.Object({ label: t.Optional(t.String()) }) },
  )

  /** Revoke one of my tokens. Takes effect on the next upload, with no delay. */
  .delete('/share-tokens/:id', async ({ user, params, status }) => {
    const revoked = await revokeShareToken(user.id, params.id);
    if (!revoked) return status(404, { message: 'Share token not found' });
    return { ok: true };
  });
