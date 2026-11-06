import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env by itself. Load the monorepo root .env when it exists
// (local dev); in CI and containers the variables come from the real environment.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Not wrapped in env(): `prisma generate` must work without a database (CI typecheck).
    url: process.env.DATABASE_URL ?? '',
  },
  // Chunk's DDL is hand-written in migrations: Prisma cannot represent the HNSW index
  // nor the generated tsvector column, and would try to drop them on every new migration.
  experimental: {
    externalTables: true,
  },
  tables: {
    external: ['public.Chunk'],
  },
});
