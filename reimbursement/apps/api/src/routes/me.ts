import { Elysia } from 'elysia';
import { auth } from '../auth';
import { serializeUser } from '../serializers';

/**
 * `/me` — returns the authenticated user.
 *
 * Mounted under `/api` by `index.ts`, so the public path is `/api/me`.
 */
export const meRoutes = new Elysia({ prefix: '/me' })
  .use(auth)
  .get('/', ({ user }) => serializeUser(user));
