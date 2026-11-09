export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

/** `document` for chunks being indexed, `query` for user questions (asymmetric retrieval). */
export type EmbeddingInputType = 'document' | 'query';

export interface EmbeddingResult {
  /** One vector per input text, in the same order. */
  vectors: number[][];
  /** Tokens billed by the provider (exact, from the API response). */
  totalTokens: number;
}

/**
 * Embeddings behind an interface: the Voyage implementation in production, a deterministic
 * fake in tests and local development, so tests never call a paid API (CLAUDE.md §9).
 */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  /** List price, used to record the cost of each call in UsageEvent. */
  readonly pricePerMillionTokens: number;
  embed(texts: string[], inputType: EmbeddingInputType): Promise<EmbeddingResult>;
}

export function costUsd(provider: EmbeddingProvider, tokens: number): number {
  return (tokens * provider.pricePerMillionTokens) / 1_000_000;
}
