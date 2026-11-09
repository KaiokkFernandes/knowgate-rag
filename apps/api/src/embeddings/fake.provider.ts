import { createHash } from 'node:crypto';
import { estimateTokens } from '../documents/ingestion/chunker';
import type { EmbeddingInputType, EmbeddingProvider, EmbeddingResult } from './embedding-provider';

/**
 * Deterministic, offline embeddings for tests and local development ("hashing trick"):
 * each word (lowercase, accents removed) adds ±1 to a dimension chosen by its hash, and the
 * vector is normalized. Texts that share words get a higher cosine similarity, which is
 * enough to test retrieval end to end without a paid API. Not a semantic model.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-hashing';
  readonly pricePerMillionTokens = 0;

  constructor(readonly dimension: number) {}

  embed(texts: string[], _inputType: EmbeddingInputType): Promise<EmbeddingResult> {
    return Promise.resolve({
      vectors: texts.map((text) => this.vector(text)),
      totalTokens: texts.reduce((sum, text) => sum + estimateTokens(text), 0),
    });
  }

  private vector(text: string): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    const words = text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .match(/[a-z0-9]+/g);
    for (const word of words ?? []) {
      const hash = createHash('sha256').update(word).digest();
      const index = hash.readUInt32BE(0) % this.dimension;
      vector[index] = (vector[index] ?? 0) + ((hash[4] ?? 0) % 2 === 0 ? 1 : -1);
    }
    const norm = Math.hypot(...vector);
    // An empty text still gets a valid (non-zero) vector: cosine distance is undefined for zero.
    if (norm === 0) vector[0] = 1;
    return norm === 0 ? vector : vector.map((value) => value / norm);
  }
}
