import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { resolve } from 'node:path';
import { prisma } from './db';
import { meRoutes } from './routes/me';
import { receiptRoutes } from './routes/receipts';
import { bundleRoutes } from './routes/bundles';
import { authLineRoutes } from './routes/auth_line';
import { authCardRoutes } from './routes/auth_card';
import { adminRoutes } from './routes/admin';
import { expenseRoutes } from './routes/expenses';
import { plRoutes } from './routes/pl';

const PORT = Number(process.env.API_PORT ?? 3001);
const UPLOADS_DIR = resolve(process.cwd(), 'uploads');

// Strict allowlist of characters in a filename — defends against `..`,
// absolute paths, percent-encoding, etc. Files written by saveUploadedFile
// only ever use [a-zA-Z0-9._-], so this is a tight match.
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

// In production, only the web origin may make credentialed cross-origin calls.
// (The web app is same-origin behind nginx, so this is defense-in-depth.) If
// WEB_BASE_URL is unset in prod we fail closed to no cross-origin access.
const CORS_ORIGIN =
  process.env.NODE_ENV === 'production' ? (process.env.WEB_BASE_URL ?? false) : true;

const app = new Elysia()
  .use(cors({ origin: CORS_ORIGIN, credentials: true }))
  // Serve receipt photos and transfer-slip images from the uploads volume.
  // We hand-roll this instead of @elysiajs/static — that plugin enumerates
  // the directory once at boot and breaks on files added later (e.g. the
  // notion-import backfill, future receipt uploads).
  .get('/uploads/:filename', async ({ params, set, status }) => {
    if (!SAFE_FILENAME.test(params.filename)) {
      return status(404, 'Not found');
    }
    const path = resolve(UPLOADS_DIR, params.filename);
    const file = Bun.file(path);
    if (!(await file.exists())) return status(404, 'Not found');
    set.headers['cache-control'] = 'public, max-age=86400, immutable';
    return file;
  })
  .get('/health', async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  })
  .get('/', () => ({ name: 'reimbursement-api', version: '0.1.0' }))
  .group('/api', (api) =>
    api
      .use(meRoutes)
      .use(receiptRoutes)
      .use(bundleRoutes)
      .use(authLineRoutes)
      .use(authCardRoutes)
      .use(adminRoutes)
      .use(expenseRoutes)
      .use(plRoutes),
  )
  .listen(PORT);

console.log(`API listening on http://localhost:${PORT}`);

export type App = typeof app;
