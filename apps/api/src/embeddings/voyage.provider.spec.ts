import { VoyageApiError, VoyageEmbeddingProvider } from './voyage.provider';

const DIMENSION = 4;

function okResponse(count: number, offset = 0, reversed = false): Response {
  const data = Array.from({ length: count }, (_, i) => ({
    embedding: [offset + i, 0, 0, 0],
    index: i,
  }));
  return Response.json({
    data: reversed ? data.reverse() : data,
    usage: { total_tokens: count * 10 },
  });
}

function setup(responses: (Response | Error)[]) {
  // The provider always calls fetch(url: string, init) with a JSON string body.
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const sleeps: number[] = [];
  const fetchMock: typeof fetch = (url, init) => {
    calls.push({
      url: url as string,
      body: init?.body as string,
      headers: init?.headers as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) throw new Error('No more mocked responses');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  const provider = new VoyageEmbeddingProvider({
    apiKey: 'test-key',
    model: 'voyage-4-large',
    dimension: DIMENSION,
    maxAttempts: 3,
    fetch: fetchMock,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  const body = (i: number) => JSON.parse(calls[i]?.body ?? '') as Record<string, unknown>;
  return { provider, calls, sleeps, body };
}

describe('VoyageEmbeddingProvider', () => {
  it('sends the documented request and returns vectors in input order', async () => {
    const { provider, calls, body } = setup([okResponse(2, 0, true)]);

    const result = await provider.embed(['a', 'b'], 'document');

    expect(calls[0]?.url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(calls[0]?.headers.Authorization).toBe('Bearer test-key');
    expect(body(0)).toEqual({
      input: ['a', 'b'],
      model: 'voyage-4-large',
      input_type: 'document',
      output_dimension: DIMENSION,
      truncation: false,
    });
    // The API answered in reverse order; the provider sorts by index.
    expect(result).toEqual({
      vectors: [
        [0, 0, 0, 0],
        [1, 0, 0, 0],
      ],
      totalTokens: 20,
    });
  });

  it('splits large inputs into several requests (at most 128 texts each)', async () => {
    const { provider, calls, body } = setup([okResponse(128), okResponse(72, 128)]);

    const result = await provider.embed(
      Array.from({ length: 200 }, (_, i) => `t${i}`),
      'document',
    );

    expect(calls).toHaveLength(2);
    expect((body(1).input as string[])[0]).toBe('t128');
    expect(result.vectors).toHaveLength(200);
    expect(result.vectors[199]?.[0]).toBe(199);
    expect(result.totalTokens).toBe(2000);
  });

  it('retries 429 honoring Retry-After, and 5xx with backoff', async () => {
    const { provider, calls, sleeps } = setup([
      new Response(null, { status: 429, headers: { 'retry-after': '2' } }),
      new Response(null, { status: 503 }),
      okResponse(1),
    ]);

    await expect(provider.embed(['a'], 'query')).resolves.toMatchObject({ totalTokens: 10 });
    expect(calls).toHaveLength(3);
    expect(sleeps[0]).toBe(2000);
    expect(sleeps[1]).toBeLessThanOrEqual(1000); // jittered: random * 500ms * 2^(2-1)
  });

  it('retries network errors and timeouts', async () => {
    const { provider, calls } = setup([new TypeError('fetch failed'), okResponse(1)]);
    await provider.embed(['a'], 'query');
    expect(calls).toHaveLength(2);
  });

  it('does not retry client errors such as 401 and never echoes the key', async () => {
    const { provider, calls } = setup([new Response('{"detail":"bad key"}', { status: 401 })]);

    const error = await provider.embed(['a'], 'query').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VoyageApiError);
    expect(error).toMatchObject({ status: 401, message: 'Voyage API responded 401' });
    expect(calls).toHaveLength(1);
  });

  it('gives up after maxAttempts', async () => {
    const { provider, calls } = setup(
      [500, 500, 500].map((status) => new Response(null, { status })),
    );
    await expect(provider.embed(['a'], 'query')).rejects.toMatchObject({ status: 500 });
    expect(calls).toHaveLength(3);
  });

  it('rejects vectors of the wrong dimension', async () => {
    const { provider } = setup([
      Response.json({ data: [{ embedding: [1, 2], index: 0 }], usage: { total_tokens: 1 } }),
    ]);
    await expect(provider.embed(['a'], 'query')).rejects.toThrow(VoyageApiError);
  });

  it('refuses a model without a configured price', () => {
    expect(
      () =>
        new VoyageEmbeddingProvider({ apiKey: 'k', model: 'voyage-unknown', dimension: DIMENSION }),
    ).toThrow(/No price/);
  });
});
