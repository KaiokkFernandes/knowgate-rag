import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { estimateTokens } from '../src/documents/ingestion/chunker';
import { EMBEDDING_PROVIDER, type EmbeddingInputType } from '../src/embeddings/embedding-provider';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { createApp } from './setup/create-app';
import { registerUser, type TestUser } from './setup/users';

/** The offline fake, plus a switch to simulate the provider being down. */
class ControlledProvider extends FakeEmbeddingProvider {
  failing = false;
  calls = 0;

  override embed(texts: string[], inputType: EmbeddingInputType) {
    this.calls++;
    if (this.failing) return Promise.reject(new Error('provider down (simulated)'));
    return super.embed(texts, inputType);
  }
}

describe('Embedding worker (integration)', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  const provider = new ControlledProvider(1024);

  beforeAll(async () => {
    app = await createApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000' }, [
      { token: EMBEDDING_PROVIDER, value: provider },
    ]);
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  beforeEach(() => {
    provider.failing = false;
    provider.calls = 0;
  });

  const auth = (user: TestUser, r: request.Test) => r.set('Authorization', `Bearer ${user.token}`);

  async function setup() {
    const admin = await registerUser(app);
    const org = await auth(admin, request(app.getHttpServer()).post('/orgs')).send({
      name: 'Acme',
    });
    return { admin, orgId: (org.body as { id: string }).id };
  }

  async function upload(admin: TestUser, orgId: string, markdown: string): Promise<string> {
    const response = await auth(
      admin,
      request(app.getHttpServer()).post(`/orgs/${orgId}/documents`),
    )
      .attach('file', Buffer.from(markdown), 'doc.md')
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** Polls the API until the background worker sets one of the final statuses. */
  async function waitForStatus(admin: TestUser, orgId: string, documentId: string) {
    for (let i = 0; i < 100; i++) {
      const response = await auth(
        admin,
        request(app.getHttpServer()).get(`/orgs/${orgId}/documents/${documentId}`),
      ).expect(200);
      const { status } = response.body as { status: string };
      if (status === 'READY' || status === 'FAILED') return status;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Document did not finish processing');
  }

  async function embeddingStats(documentId: string) {
    const { rows } = await pool.query<{ total: number; embedded: number; dims: number | null }>(
      `SELECT count(*)::int AS total, count(embedding)::int AS embedded,
              max(vector_dims(embedding)) AS dims
         FROM "Chunk" WHERE "documentId" = $1`,
      [documentId],
    );
    return rows[0];
  }

  it('embeds every chunk in batches, marks the document READY and records usage', async () => {
    const { admin, orgId } = await setup();
    // 140 sections -> 140 chunks -> two batches (128 + 12).
    const sections = Array.from({ length: 140 }, (_, i) => `# Seção ${i}\nConteúdo da seção ${i}.`);
    const documentId = await upload(admin, orgId, sections.join('\n'));

    expect(await waitForStatus(admin, orgId, documentId)).toBe('READY');
    expect(await embeddingStats(documentId)).toEqual({ total: 140, embedded: 140, dims: 1024 });
    expect(provider.calls).toBe(2);

    const { rows } = await pool.query<{
      kind: string;
      model: string;
      userId: string;
      tokens: number;
      cost: string;
    }>(
      `SELECT kind, model, "userId", "inputTokens" AS tokens, "costUsd"::text AS cost
         FROM "UsageEvent" WHERE "organizationId" = $1 ORDER BY "createdAt"`,
      [orgId],
    );
    const chunkTokens = await pool.query<{ content: string }>(
      'SELECT content FROM "Chunk" WHERE "documentId" = $1',
      [documentId],
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (r) => r.kind === 'EMBEDDING' && r.model === 'fake-hashing' && r.userId === admin.id,
      ),
    ).toBe(true);
    expect(rows.reduce((sum, r) => sum + r.tokens, 0)).toBe(
      chunkTokens.rows.reduce((sum, r) => sum + estimateTokens(r.content), 0),
    );
    expect(rows.map((r) => r.cost)).toEqual(['0.000000', '0.000000']);
  });

  it('marks the document FAILED when the provider is down, and reprocesses it on request', async () => {
    const { admin, orgId } = await setup();
    provider.failing = true;
    const documentId = await upload(admin, orgId, '# Política\nTexto.');

    expect(await waitForStatus(admin, orgId, documentId)).toBe('FAILED');
    expect(await embeddingStats(documentId)).toMatchObject({ embedded: 0 });

    provider.failing = false;
    const reprocess = () =>
      auth(
        admin,
        request(app.getHttpServer()).post(`/orgs/${orgId}/documents/${documentId}/reprocess`),
      );
    await reprocess().expect(202);
    expect(await waitForStatus(admin, orgId, documentId)).toBe('READY');
    expect(await embeddingStats(documentId)).toMatchObject({ total: 1, embedded: 1 });

    // Only FAILED documents can be reprocessed.
    await reprocess().expect(409);
  });

  it('resumes unfinished documents when the API starts (crash recovery)', async () => {
    const { admin, orgId } = await setup();
    const documentId = await upload(admin, orgId, '# A\nUm.\n# B\nDois.');
    expect(await waitForStatus(admin, orgId, documentId)).toBe('READY');

    // Simulate a crash in the middle: one chunk embedded, the other not, status PROCESSING.
    await pool.query(
      `UPDATE "Chunk" SET embedding = NULL WHERE "documentId" = $1 AND position = 1`,
      [documentId],
    );
    await pool.query(`UPDATE "Document" SET status = 'PROCESSING' WHERE id = $1`, [documentId]);
    provider.calls = 0;

    const restarted = await createApp({}, [{ token: EMBEDDING_PROVIDER, value: provider }]);
    try {
      expect(await waitForStatus(admin, orgId, documentId)).toBe('READY');
      expect(await embeddingStats(documentId)).toMatchObject({ total: 2, embedded: 2 });
      // Only the missing chunk was sent again (one call, one text).
      const { rows } = await pool.query<{ tokens: number }>(
        `SELECT "inputTokens" AS tokens FROM "UsageEvent"
          WHERE "organizationId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        [orgId],
      );
      expect(rows[0]?.tokens).toBe(estimateTokens('# B\nDois.'));
    } finally {
      await restarted.close();
    }
  });

  it('only lets admins reprocess, and hides other organizations documents', async () => {
    const { admin, orgId } = await setup();
    const other = await setup();
    const documentId = await upload(admin, orgId, '# A\nUm.');
    await waitForStatus(admin, orgId, documentId);

    await auth(
      other.admin,
      request(app.getHttpServer()).post(`/orgs/${other.orgId}/documents/${documentId}/reprocess`),
    ).expect(404);
  });
});
