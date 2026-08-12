import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// In dev (and in `bun run db:*` from the repo root), DATABASE_URL lives in
// the repo-root `.env`. In production the container injects it directly via
// docker-compose's `environment` block, no .env file in sight — and dotenv
// is a dev-only dep, stripped from the runtime image. So: only try to load
// dotenv when DATABASE_URL is missing, and tolerate dotenv not being
// installed.
if (!process.env.DATABASE_URL) {
  try {
    const req = createRequire(import.meta.url);
    const dotenv = req('dotenv') as { config: (opts: { path: string }) => void };
    dotenv.config({ path: resolve(import.meta.dirname, '../../.env') });
  } catch {
    // dotenv not available — rely on the ambient environment.
  }
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for this Prisma command (check .env at repo root, or set the env var directly)',
    );
  }
  return url;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  // datasource.url is consulted only by commands that actually need to talk
  // to the DB (`migrate`, `studio`). `generate` reads the schema and stops.
  datasource: {
    get url(): string {
      return requireDatabaseUrl();
    },
  },
  migrations: {
    path: 'prisma/migrations',
    adapter: () => new PrismaPg({ connectionString: requireDatabaseUrl() }),
  },
});
