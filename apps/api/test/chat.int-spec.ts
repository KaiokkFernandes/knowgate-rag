import type { INestApplication } from '@nestjs/common';
import type { ChatCitation, ChatSource } from '@knowgate/shared';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { EMBEDDING_PROVIDER, type EmbeddingInputType } from '../src/embeddings/embedding-provider';
import { FakeEmbeddingProvider } from '../src/embeddings/fake.provider';
import { FakeLlmProvider } from '../src/llm/fake-llm.provider';
import { type AnswerEvent, type AnswerRequest, LLM_PROVIDER } from '../src/llm/llm-provider';
import { isValidCpf } from '../src/privacy/pii-masker';
import { createApp } from './setup/create-app';
import { registerUser, type TestUser } from './setup/users';

/** The offline fake LLM, recording each request and optionally failing mid-stream. */
class SpyLlm extends FakeLlmProvider {
  readonly requests: AnswerRequest[] = [];
  failNext = false;

  override async answer(request: AnswerRequest, onEvent: (event: AnswerEvent) => void) {
    this.requests.push(request);
    if (this.failNext) {
      this.failNext = false;
      onEvent({ type: 'text', text: 'Começando' });
      throw new Error('upstream overloaded');
    }
    return super.answer(request, onEvent);
  }
}

class SpyEmbeddings extends FakeEmbeddingProvider {
  readonly queries: string[] = [];

  override embed(texts: string[], inputType: EmbeddingInputType) {
    if (inputType === 'query') this.queries.push(...texts);
    return super.embed(texts, inputType);
  }
}

interface SseEvent {
  event: string;
  data: unknown;
}

interface DonePayload {
  messageId: string;
  answer: string;
  citations: ChatCitation[];
  notFound: boolean;
  stopReason: string | null;
}

const CPF = '529.982.247-25';

describe('Chat (integration)', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  const llm = new SpyLlm();
  const embeddings = new SpyEmbeddings(1024);

  let admin: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let refundDocId: string;

  const server = () => request(app.getHttpServer());
  const auth = (user: TestUser, r: request.Test) => r.set('Authorization', `Bearer ${user.token}`);

  async function addDocument(title: string, markdown: string, teamIds: string[] = []) {
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

  /** Posts a question and parses the Server-Sent Events of the response. */
  async function ask(user: TestUser, body: object, org = orgId) {
    const response = await auth(user, server().post(`/orgs/${org}/chat`))
      .send(body)
      .buffer(true)
      .parse((res, callback) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => callback(null, text));
      });
    const events: SseEvent[] =
      response.status === 200
        ? (response.body as string)
            .split('\n\n')
            .filter(Boolean)
            .map((block) => {
              const [eventLine = '', dataLine = ''] = block.split('\n');
              return {
                event: eventLine.replace('event: ', ''),
                data: JSON.parse(dataLine.replace('data: ', '')) as unknown,
              };
            })
        : [];
    const find = <T>(name: string) => events.find((e) => e.event === name)?.data as T;
    return {
      response,
      events,
      meta: find<{ conversationId: string; sources: ChatSource[] }>('meta'),
      done: find<DonePayload>('done'),
    };
  }

  beforeAll(async () => {
    app = await createApp(
      {
        AUTH_RATE_LIMIT_PER_MINUTE: '1000',
        RATE_LIMIT_PER_MINUTE: '10000',
        CHAT_MIN_SIMILARITY: '0.5',
      },
      [
        { token: LLM_PROVIDER, value: llm },
        { token: EMBEDDING_PROVIDER, value: embeddings },
      ],
    );
    pool = new Pool({ connectionString: process.env.DATABASE_URL });

    [admin, member, outsider] = await Promise.all([
      registerUser(app),
      registerUser(app),
      registerUser(app),
    ]);
    orgId = (
      (await auth(admin, server().post('/orgs')).send({ name: 'Acme' }).expect(201)).body as {
        id: string;
      }
    ).id;
    await auth(admin, server().post(`/orgs/${orgId}/members`))
      .send({ email: member.email })
      .expect(201);
    const hrTeam = (
      (
        await auth(admin, server().post(`/orgs/${orgId}/teams`))
          .send({ name: 'RH' })
          .expect(201)
      ).body as { id: string }
    ).id;

    refundDocId = await addDocument(
      'Política de reembolso',
      '# Prazos\nO reembolso de despesas de viagem é pago em até cinco dias úteis.',
    );
    await addDocument(
      'Salários',
      '# Faixas\nA faixa salarial confidencial de engenharia sênior é revisada em março.',
      [hrTeam],
    );
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  beforeEach(() => {
    llm.requests.length = 0;
    embeddings.queries.length = 0;
  });

  it('streams an answer that cites the source chunk and stores the conversation', async () => {
    const { response, events, meta, done } = await ask(member, {
      question: 'Em quantos dias úteis o reembolso de despesas de viagem é pago?',
    });

    expect(response.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(events.map((e) => e.event)).toEqual(['meta', 'text', 'text', 'citation', 'done']);
    expect(meta.sources).toHaveLength(1);
    expect(meta.sources[0]).toMatchObject({
      index: 0,
      documentId: refundDocId,
      documentTitle: 'Política de reembolso',
      reference: 'Prazos',
    });

    // The fake LLM answers with the first sentence of the chunk (which starts with its heading).
    const sentence = '# Prazos\nO reembolso de despesas de viagem é pago em até cinco dias úteis.';
    expect(meta.sources[0]?.content).toBe(sentence);
    expect(done.notFound).toBe(false);
    expect(done.answer).toBe(`De acordo com os documentos: ${sentence}`);
    // The citation covers exactly the cited sentence inside the final answer.
    expect(done.citations).toEqual([
      expect.objectContaining({ sourceIndex: 0, documentId: refundDocId, reference: 'Prazos' }),
    ]);
    const [citation] = done.citations;
    expect(done.answer.slice(citation?.start, citation?.end)).toBe(sentence);

    const { rows: messages } = await pool.query<{ role: string; citations: unknown }>(
      'SELECT role, citations FROM "Message" WHERE "conversationId" = $1 ORDER BY "createdAt"',
      [meta.conversationId],
    );
    expect(messages.map((m) => m.role)).toEqual(['USER', 'ASSISTANT']);
    expect(messages[1]?.citations).toEqual(done.citations);

    const { rows: usage } = await pool.query<{ model: string; inputTokens: number }>(
      `SELECT model, "inputTokens" FROM "UsageEvent" WHERE "organizationId" = $1 AND kind = 'CHAT'`,
      [orgId],
    );
    expect(usage).toEqual([{ model: 'fake-llm', inputTokens: expect.any(Number) as number }]);
  });

  it('answers "not found" without calling the model when nothing is relevant', async () => {
    const { meta, done } = await ask(member, { question: 'Qual o cardápio do refeitório?' });

    expect(meta.sources).toEqual([]);
    expect(done).toMatchObject({ notFound: true, citations: [] });
    expect(done.answer).toMatch(/Não encontrei/);
    expect(llm.requests).toHaveLength(0);
  });

  it('never gives a member chunks of a team document they are not in', async () => {
    const question = 'Quando a faixa salarial confidencial de engenharia sênior é revisada?';

    const asMember = await ask(member, { question });
    expect(asMember.done.notFound).toBe(true);
    expect(llm.requests).toHaveLength(0);

    // The admin sees every document of the organization.
    const asAdmin = await ask(admin, { question });
    expect(asAdmin.meta.sources.map((s) => s.documentTitle)).toEqual(['Salários']);
  });

  it('masks personal data before retrieval, the model and storage', async () => {
    expect(isValidCpf(CPF)).toBe(true);
    const { meta } = await ask(member, {
      question: `Sou o CPF ${CPF}, e-mail joao@example.com: em quantos dias úteis o reembolso de despesas de viagem é pago?`,
    });

    const masked = 'Sou o CPF [CPF], e-mail [EMAIL]:';
    expect(embeddings.queries[0]).toContain(masked);
    expect(llm.requests[0]?.question).toContain(masked);
    const { rows } = await pool.query<{ content: string }>(
      `SELECT content FROM "Message" WHERE "conversationId" = $1 AND role = 'USER'`,
      [meta.conversationId],
    );
    expect(rows[0]?.content).toContain(masked);
    expect(JSON.stringify(rows)).not.toContain('529');
  });

  it('sends earlier turns as history when continuing a conversation', async () => {
    const question = 'Em quantos dias úteis o reembolso de despesas de viagem é pago?';
    const first = await ask(member, { question });
    await ask(member, { question, conversationId: first.meta.conversationId });

    expect(llm.requests[1]?.history).toEqual([
      { role: 'user', content: question },
      { role: 'assistant', content: first.done.answer },
    ]);
  });

  it('only lets users read and continue their own conversations', async () => {
    const { meta } = await ask(member, { question: 'Qual o cardápio do refeitório?' });

    // Another user of the same organization: plain 404 before any streaming.
    const asAdmin = await ask(admin, {
      question: 'Qual o cardápio?',
      conversationId: meta.conversationId,
    });
    expect(asAdmin.response.status).toBe(404);
    await auth(admin, server().get(`/orgs/${orgId}/conversations/${meta.conversationId}`)).expect(
      404,
    );
    const adminList = await auth(admin, server().get(`/orgs/${orgId}/conversations`)).expect(200);
    expect((adminList.body as { id: string }[]).map((c) => c.id)).not.toContain(
      meta.conversationId,
    );

    // A non-member cannot use the organization at all (404: its existence is not revealed).
    expect((await ask(outsider, { question: 'Oi' })).response.status).toBe(404);

    const own = await auth(
      member,
      server().get(`/orgs/${orgId}/conversations/${meta.conversationId}`),
    ).expect(200);
    expect((own.body as { messages: unknown[] }).messages).toHaveLength(2);
    const list = await auth(member, server().get(`/orgs/${orgId}/conversations`)).expect(200);
    expect((list.body as { id: string; title: string }[])[0]).toEqual(
      expect.objectContaining({ id: meta.conversationId, title: 'Qual o cardápio do refeitório?' }),
    );
  });

  it('validates the question', async () => {
    expect((await ask(member, { question: '   ' })).response.status).toBe(400);
    expect((await ask(member, { question: 'x'.repeat(2001) })).response.status).toBe(400);
    expect(
      (await ask(member, { question: 'Oi', conversationId: 'not-a-uuid' })).response.status,
    ).toBe(400);
  });

  it('turns a model failure during streaming into an error event', async () => {
    llm.failNext = true;
    const { events } = await ask(member, {
      question: 'Em quantos dias úteis o reembolso de despesas de viagem é pago?',
    });

    expect(events.map((e) => e.event)).toEqual(['meta', 'text', 'error']);
    expect(JSON.stringify(events)).not.toContain('upstream overloaded');
  });
});
