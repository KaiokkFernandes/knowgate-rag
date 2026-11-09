import type { INestApplication } from '@nestjs/common';
import type { SearchResult } from '@knowgate/shared';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { EMBEDDING_PROVIDER, type EmbeddingInputType } from '../src/embeddings/embedding-provider';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { createApp } from './setup/create-app';
import { registerUser, type TestUser } from './setup/users';

/** The offline fake, recording what is sent to the provider. */
class SpyProvider extends FakeEmbeddingProvider {
  readonly sent: { texts: string[]; inputType: EmbeddingInputType }[] = [];

  override embed(texts: string[], inputType: EmbeddingInputType) {
    this.sent.push({ texts, inputType });
    return super.embed(texts, inputType);
  }
}

describe('Hybrid search (integration)', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  const provider = new SpyProvider(1024);

  beforeAll(async () => {
    app = await createApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000', RATE_LIMIT_PER_MINUTE: '10000' }, [
      { token: EMBEDDING_PROVIDER, value: provider },
    ]);
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  const server = () => request(app.getHttpServer());
  const auth = (user: TestUser, r: request.Test) => r.set('Authorization', `Bearer ${user.token}`);

  async function createOrg(admin: TestUser): Promise<string> {
    const response = await auth(admin, server().post('/orgs')).send({ name: 'Acme' }).expect(201);
    return (response.body as { id: string }).id;
  }

  async function addMember(admin: TestUser, orgId: string, user: TestUser) {
    await auth(admin, server().post(`/orgs/${orgId}/members`))
      .send({ email: user.email })
      .expect(201);
  }

  async function createTeam(admin: TestUser, orgId: string, name: string): Promise<string> {
    const response = await auth(admin, server().post(`/orgs/${orgId}/teams`))
      .send({ name })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** Uploads a Markdown document and waits until the worker has embedded it. */
  async function addDocument(
    admin: TestUser,
    orgId: string,
    title: string,
    markdown: string,
    teamIds: string[] = [],
  ): Promise<string> {
    let req = auth(admin, server().post(`/orgs/${orgId}/documents`)).field('title', title);
    if (teamIds.length > 0) {
      req = req.field('visibility', 'TEAMS');
      for (const teamId of teamIds) req = req.field('teamIds', teamId);
    }
    const response = await req.attach('file', Buffer.from(markdown), 'doc.md').expect(201);
    const documentId = (response.body as { id: string }).id;
    for (let i = 0; i < 100; i++) {
      const { rows } = await pool.query<{ status: string }>(
        'SELECT status FROM "Document" WHERE id = $1',
        [documentId],
      );
      if (rows[0]?.status === 'READY') return documentId;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw new Error(`Document ${title} was not embedded`);
  }

  async function search(user: TestUser, orgId: string, query: string, limit?: number) {
    const response = await auth(user, server().post(`/orgs/${orgId}/search`))
      .send({ query, limit })
      .expect(200);
    return (response.body as { results: SearchResult[] }).results;
  }

  const SMALL_DOCUMENT =
    '# Um\nCafé na copa.\n# Dois\nEstacionamento no subsolo.\n# Três\nCrachá na portaria.';

  async function queryVectorLiteral(query: string): Promise<number[]> {
    const {
      vectors: [vector = []],
    } = await new FakeEmbeddingProvider(1024).embed([query], 'query');
    return vector;
  }

  /** Inserts a READY document with `count` chunks whose vectors sit right next to the query. */
  async function insertChunksNear(
    query: string,
    orgId: string,
    visibility: 'ORG' | 'TEAMS',
    count: number,
    teamId?: string,
  ) {
    const queryVector = await queryVectorLiteral(query);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO "Document" ("organizationId", title, "sourceType", visibility, status, "updatedAt")
       VALUES ($1, 'Grande', 'TXT', $2, 'READY', now()) RETURNING id`,
      [orgId, visibility],
    );
    const documentId = rows[0]?.id;
    if (teamId) {
      await pool.query(
        'INSERT INTO "DocumentTeam" ("organizationId", "documentId", "teamId") VALUES ($1, $2, $3)',
        [orgId, documentId, teamId],
      );
    }
    for (let start = 0; start < count; start += 250) {
      const vectors = Array.from({ length: Math.min(250, count - start) }, () => {
        const noisy = queryVector.map((value) => value + (Math.random() - 0.5) * 0.01);
        return `[${noisy.join(',')}]`;
      });
      await pool.query(
        `INSERT INTO "Chunk" ("organizationId", "documentId", position, content, "tokenCount", embedding)
         SELECT $1, $2, $3 + n::int, 'linha ' || ($3 + n::int), 2, v::vector
           FROM unnest($4::text[]) WITH ORDINALITY AS t(v, n)`,
        [orgId, documentId, start, vectors],
      );
    }
    await pool.query('ANALYZE "Chunk"');
    await pool.query('ANALYZE "Document"');
  }

  /**
   * Runs the vector part of the search as a member who only sees ORG documents, forcing the
   * plan Postgres picks at production scale (HNSW index scan; `enable_sort = off` rules out the
   * exact B-tree + sort plan it prefers for a few thousand rows). Returns the titles found and
   * whether the HNSW index was used.
   */
  async function vectorSearchWithHnsw(query: string, orgId: string, iterativeScan: string) {
    const vector = `[${(await queryVectorLiteral(query)).join(',')}]`;
    const sql = `
      SELECT d.title FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId"
       WHERE c."organizationId" = $2::uuid AND d.status = 'READY' AND d.visibility = 'ORG'
       ORDER BY c.embedding <=> $1::vector LIMIT 3`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_sort = off');
      await client.query(`SET LOCAL hnsw.iterative_scan = ${iterativeScan}`);
      const plan = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN (COSTS OFF) ${sql}`, [
        vector,
        orgId,
      ]);
      const { rows } = await client.query<{ title: string }>(sql, [vector, orgId]);
      return {
        usedHnsw: plan.rows.some((row) => row['QUERY PLAN'].includes('Chunk_embedding_idx')),
        titles: rows.map((row) => row.title),
      };
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  }

  const titles = (results: SearchResult[]) =>
    [...new Set(results.map((r) => r.documentTitle))].sort();

  it('ranks the matching chunk first and returns its citation data', async () => {
    const admin = await registerUser(app);
    const orgId = await createOrg(admin);
    await addDocument(
      admin,
      orgId,
      'Política de reembolso',
      '# Reembolso\nDespesas de viagem são reembolsadas.\n## Prazos\nO prazo do reembolso é de 30 dias após a viagem.',
    );
    await addDocument(admin, orgId, 'Segurança', '# Senhas\nSenhas precisam de 12 caracteres.');

    const [first, ...rest] = await search(admin, orgId, 'Qual é o prazo do reembolso?');

    expect(first).toMatchObject({
      documentTitle: 'Política de reembolso',
      reference: 'Reembolso > Prazos',
      content: expect.stringContaining('30 dias') as unknown,
      semanticRank: 1,
      keywordRank: 1,
    });
    expect(first?.similarity).toBeGreaterThan(0);
    // Ordered by fused score.
    for (const result of rest) expect(result.score).toBeLessThanOrEqual(first?.score ?? 0);
  });

  it('finds an exact term through full-text even when it is not among the vector candidates', async () => {
    const admin = await registerUser(app);
    const orgId = await createOrg(admin);
    await addDocument(admin, orgId, 'Códigos', '# Sistemas\nO sistema interno se chama Xptoflux.');

    const results = await search(admin, orgId, 'xptoflux');

    expect(results[0]).toMatchObject({ documentTitle: 'Códigos', keywordRank: 1 });
  });

  describe('tenant isolation', () => {
    it('never returns another organization chunks, even for a question identical to them', async () => {
      const adminA = await registerUser(app);
      const adminB = await registerUser(app);
      const orgA = await createOrg(adminA);
      const orgB = await createOrg(adminB);
      const secretOfA = 'O bônus anual da diretoria da Acme é de doze salários.';
      await addDocument(adminA, orgA, 'Bônus A', `# Bônus\n${secretOfA}`);
      await addDocument(
        adminB,
        orgB,
        'Férias B',
        '# Férias\nCada colaborador tem 30 dias de férias.',
      );

      const resultsForB = await search(adminB, orgB, secretOfA);
      const resultsForA = await search(adminA, orgA, secretOfA);

      // B still gets its own (unrelated) chunk, and nothing from A.
      expect(titles(resultsForB)).toEqual(['Férias B']);
      expect(JSON.stringify(resultsForB)).not.toContain('doze salários');
      expect(resultsForA[0]?.documentTitle).toBe('Bônus A');
    });

    it('still returns the small organization results next to a much larger one', async () => {
      const bigAdmin = await registerUser(app);
      const smallAdmin = await registerUser(app);
      const bigOrg = await createOrg(bigAdmin);
      const smallOrg = await createOrg(smallAdmin);
      const query = 'orçamento trimestral consolidado';
      await addDocument(smallAdmin, smallOrg, 'Pequena', SMALL_DOCUMENT);
      await insertChunksNear(query, bigOrg, 'ORG', 2000);

      const results = await search(smallAdmin, smallOrg, query, 3);

      // Postgres answers this one with the B-tree on Chunk.organizationId (the tenant filter is
      // selective), an exact search: correct with or without the HNSW iterative scan.
      expect(results).toHaveLength(3);
      expect(titles(results)).toEqual(['Pequena']);
    });
  });

  it('keeps vector results when HNSW neighbors are filtered out by visibility (iterative scan)', async () => {
    const admin = await registerUser(app);
    const member = await registerUser(app);
    const orgId = await createOrg(admin);
    await addMember(admin, orgId, member);
    const board = await createTeam(admin, orgId, 'Diretoria');
    const query = 'orçamento trimestral consolidado';

    // Visible to the member: 3 chunks unrelated to the question (no shared words).
    await addDocument(admin, orgId, 'Pequena', SMALL_DOCUMENT);
    // In the same organization, 2,000 chunks right next to the question, in a document the
    // member cannot see: the tenant filter does not help, and the nearest neighbors are all
    // filtered out by the visibility rule.
    await insertChunksNear(query, orgId, 'TEAMS', 2000, board);

    // Through the API: the member gets the 3 visible chunks, found by the vector search.
    const results = await search(member, orgId, query, 3);
    expect(results).toHaveLength(3);
    expect(titles(results)).toEqual(['Pequena']);
    expect(results.every((r) => r.semanticRank !== null && r.keywordRank === null)).toBe(true);

    // Why the repository sets hnsw.iterative_scan: on the HNSW plan, the 40 nearest
    // neighbors (ef_search) are all invisible to the member and filtered out afterwards.
    const withoutIterativeScan = await vectorSearchWithHnsw(query, orgId, 'off');
    const withIterativeScan = await vectorSearchWithHnsw(query, orgId, 'relaxed_order');
    expect(withoutIterativeScan).toEqual({ usedHnsw: true, titles: [] });
    expect(withIterativeScan).toEqual({
      usedHnsw: true,
      titles: ['Pequena', 'Pequena', 'Pequena'],
    });
  });

  describe('visibility', () => {
    it('returns TEAMS chunks only to members of those teams (and to admins)', async () => {
      const admin = await registerUser(app);
      const hrMember = await registerUser(app);
      const outsider = await registerUser(app);
      const orgId = await createOrg(admin);
      await addMember(admin, orgId, hrMember);
      await addMember(admin, orgId, outsider);
      const hr = await createTeam(admin, orgId, 'RH');
      await auth(admin, server().put(`/orgs/${orgId}/teams/${hr}/members/${hrMember.id}`)).expect(
        204,
      );

      await addDocument(admin, orgId, 'Férias (geral)', '# Férias\nPedidos de férias pelo portal.');
      await addDocument(
        admin,
        orgId,
        'Férias da diretoria (RH)',
        '# Férias\nRegras de férias e salários da diretoria.',
        [hr],
      );

      const query = 'regras de férias';
      expect(titles(await search(outsider, orgId, query))).toEqual(['Férias (geral)']);
      expect(titles(await search(hrMember, orgId, query))).toEqual([
        'Férias (geral)',
        'Férias da diretoria (RH)',
      ]);
      expect(titles(await search(admin, orgId, query))).toEqual([
        'Férias (geral)',
        'Férias da diretoria (RH)',
      ]);
    });

    it('only searches READY documents', async () => {
      const admin = await registerUser(app);
      const orgId = await createOrg(admin);
      const documentId = await addDocument(
        admin,
        orgId,
        'Antigo',
        '# Viagens\nPolítica de viagens.',
      );
      await pool.query(`UPDATE "Document" SET status = 'FAILED' WHERE id = $1`, [documentId]);

      expect(await search(admin, orgId, 'política de viagens')).toEqual([]);
    });
  });

  describe('privacy and cost', () => {
    it('masks personal data in the question before embedding it, and records the usage', async () => {
      const admin = await registerUser(app);
      const orgId = await createOrg(admin);
      await addDocument(admin, orgId, 'Ficha', '# Contato\nCPF 529.982.247-25 do colaborador.');
      provider.sent.length = 0;

      const results = await search(admin, orgId, 'Quem tem o CPF 52998224725?');

      expect(provider.sent).toEqual([{ texts: ['Quem tem o CPF [CPF]?'], inputType: 'query' }]);
      // The masked question matches the masked chunk.
      expect(results[0]?.content).toContain('CPF [CPF]');
      const { rows } = await pool.query<{ userId: string; kind: string }>(
        `SELECT "userId", kind FROM "UsageEvent"
          WHERE "organizationId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        [orgId],
      );
      expect(rows[0]).toEqual({ userId: admin.id, kind: 'EMBEDDING' });
    });

    it('does not call the provider when there is nothing to search', async () => {
      const admin = await registerUser(app);
      const orgId = await createOrg(admin);
      provider.sent.length = 0;

      expect(await search(admin, orgId, 'qualquer coisa')).toEqual([]);
      expect(provider.sent).toEqual([]);
    });
  });

  it('validates the request and the membership', async () => {
    const admin = await registerUser(app);
    const outsider = await registerUser(app);
    const orgId = await createOrg(admin);
    const post = (user: TestUser, body: object) =>
      auth(user, server().post(`/orgs/${orgId}/search`)).send(body);

    await post(admin, { query: '   ' }).expect(400);
    await post(admin, { query: 'férias', limit: 21 }).expect(400);
    await post(outsider, { query: 'férias' }).expect(404);
  });
});
