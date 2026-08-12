import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Local dev reads DATABASE_URL from the repo-root .env via dotenv. Prod
// receives it from the container env (docker-compose), and dotenv is a
// dev-only dep stripped from the runtime image. Only attempt to load
// dotenv when DATABASE_URL is missing AND dotenv is actually installed.
if (!process.env.DATABASE_URL) {
  try {
    const req = createRequire(import.meta.url);
    const dotenv = req('dotenv') as { config: (opts: { path: string }) => void };
    dotenv.config({ path: resolve(import.meta.dirname, '../../../.env') });
  } catch {
    // dotenv not available; rely on ambient env.
  }
}

import { PrismaClient } from './generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({ connectionString: databaseUrl });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
