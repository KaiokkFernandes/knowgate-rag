import { FakeEmbeddingProvider } from './fake.provider';

const cosine = (a: number[], b: number[]) =>
  a.reduce((sum, value, i) => sum + value * (b[i] ?? 0), 0);

describe('FakeEmbeddingProvider', () => {
  const provider = new FakeEmbeddingProvider(1024);

  it('returns deterministic unit vectors of the configured dimension', async () => {
    const { vectors } = await provider.embed(
      ['Política de reembolso', 'Política de reembolso'],
      'document',
    );
    expect(vectors[0]).toHaveLength(1024);
    expect(Math.hypot(...(vectors[0] ?? []))).toBeCloseTo(1);
    expect(vectors[0]).toEqual(vectors[1]);
  });

  it('gives a higher similarity to texts that share words (accents ignored)', async () => {
    const {
      vectors: [query = [], related = [], unrelated = []],
    } = await provider.embed(
      ['prazo do reembolso', 'O reembolso tem prazo de 30 dias', 'Senhas devem ter 12 caracteres'],
      'query',
    );
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});
