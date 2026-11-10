import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';

const execFileAsync = promisify(execFile);

// Same images as docker-compose.yml.
const POSTGRES_IMAGE = 'pgvector/pgvector:0.8.7-pg18-trixie';
const REDIS_IMAGE = 'redis:8.10.3-alpine';
const DB_PACKAGE = resolve(process.cwd(), '../../packages/db');

/** Starts the containers once for the whole run and applies the real migrations. */
export default async function globalSetup(): Promise<void> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE).start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();
  await execFileAsync(resolve(DB_PACKAGE, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: DB_PACKAGE,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });

  // Inherited by the test workers. Real variables take precedence over the developer's .env.
  process.env.DATABASE_URL = databaseUrl;
  process.env.REDIS_URL = redis.getConnectionUrl();
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'integration-test-secret-with-at-least-32-chars';
  // Never the paid API: env validation also refuses `voyage` when NODE_ENV=test.
  process.env.EMBEDDING_PROVIDER = 'fake';
  process.env.LLM_PROVIDER = 'fake';

  (globalThis as Record<string, unknown>).__CONTAINERS__ = [postgres, redis];
}
