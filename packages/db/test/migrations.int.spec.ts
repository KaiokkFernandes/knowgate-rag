import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

const execFileAsync = promisify(execFile);

// Same image as docker-compose.yml, so the test database matches local dev.
const POSTGRES_IMAGE = 'pgvector/pgvector:0.8.7-pg18-trixie';
const PRISMA_BIN = resolve(process.cwd(), 'node_modules/.bin/prisma');

/**
 * Applies the real migrations to a throwaway Postgres and checks the objects that
 * Prisma does not manage (extensions, text search config, generated column,
 * HNSW and GIN indexes), plus the tenant-safe composite foreign key on Chunk.
 */
describe('database migrations', () => {
  let container: StartedPostgreSqlContainer;
  let pool: Pool;
  let databaseUrl: string;

  const prisma = (...args: string[]) =>
    execFileAsync(PRISMA_BIN, args, { env: { ...process.env, DATABASE_URL: databaseUrl } });

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    databaseUrl = container.getConnectionUri();
    await prisma('migrate', 'deploy');
    pool = new Pool({ connectionString: databaseUrl });
  });

  afterAll(async () => {
    await pool?.end();
    await container?.stop();
  });

  it('installs pgvector >= 0.8 and unaccent', async () => {
    const { rows } = await pool.query<{ extname: string; extversion: string }>(
      `SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'unaccent')`,
    );
    const versions = Object.fromEntries(rows.map((r) => [r.extname, r.extversion]));

    expect(versions.unaccent).toBeDefined();
    const [major = 0, minor = 0] = (versions.vector ?? '0.0').split('.').map(Number);
    // hnsw.iterative_scan (filtered vector search) requires pgvector 0.8.
    expect(major > 0 || minor >= 8).toBe(true);
  });

  it('creates searchVector as a STORED generated column', async () => {
    const { rows } = await pool.query<{ attgenerated: string; type: string }>(
      `SELECT a.attgenerated, format_type(a.atttypid, a.atttypmod) AS type
         FROM pg_attribute a
        WHERE a.attrelid = '"Chunk"'::regclass AND a.attname = 'searchVector'`,
    );

    expect(rows).toEqual([{ attgenerated: 's', type: 'tsvector' }]);
  });

  it('creates the HNSW (cosine) and GIN indexes on Chunk', async () => {
    const { rows } = await pool.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Chunk'`,
    );
    const defs = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));

    expect(defs.Chunk_embedding_idx).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/);
    expect(defs.Chunk_searchVector_idx).toMatch(/USING gin \("searchVector"\)/);
  });

  describe('with an organization and a document', () => {
    let orgId: string;
    let documentId: string;

    beforeAll(async () => {
      const org = await pool.query<{ id: string }>(
        `INSERT INTO "Organization" (name, "dailyTokenLimit", "updatedAt")
         VALUES ('Acme', 1000, now()) RETURNING id`,
      );
      orgId = org.rows[0]!.id;
      const doc = await pool.query<{ id: string }>(
        `INSERT INTO "Document" ("organizationId", title, "sourceType", "updatedAt")
         VALUES ($1, 'Política de reembolso', 'MARKDOWN', now()) RETURNING id`,
        [orgId],
      );
      documentId = doc.rows[0]!.id;
    });

    it('matches Portuguese text regardless of accents and inflection', async () => {
      await pool.query(
        `INSERT INTO "Chunk" ("organizationId", "documentId", position, content, "tokenCount")
         VALUES ($1, $2, 0, 'As despesas de viagem são reembolsadas conforme a política.', 12)`,
        [orgId, documentId],
      );

      const { rows } = await pool.query<{ count: string }>(
        `SELECT count(*) FROM "Chunk"
          WHERE "searchVector" @@ plainto_tsquery('portuguese_unaccent', $1)`,
        ['politicas de reembolso'],
      );

      expect(rows[0]!.count).toBe('1');
    });

    it('rejects a chunk whose organizationId differs from its document', async () => {
      const other = await pool.query<{ id: string }>(
        `INSERT INTO "Organization" (name, "dailyTokenLimit", "updatedAt")
         VALUES ('Globex', 1000, now()) RETURNING id`,
      );

      await expect(
        pool.query(
          `INSERT INTO "Chunk" ("organizationId", "documentId", position, content, "tokenCount")
           VALUES ($1, $2, 1, 'leak attempt', 2)`,
          [other.rows[0]!.id, documentId],
        ),
      ).rejects.toMatchObject({ code: '23503' }); // foreign_key_violation
    });
  });

  it('leaves no drift between the database and schema.prisma', async () => {
    // --exit-code: 0 = no difference, 2 = Prisma would generate changes (execFile rejects).
    await expect(
      prisma(
        'migrate',
        'diff',
        '--from-config-datasource',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ),
    ).resolves.toBeDefined();
  });
});
