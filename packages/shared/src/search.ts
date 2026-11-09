import { z } from 'zod';

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  limit: z.number().int().min(1).max(20).default(8),
});

export const searchResultSchema = z.object({
  chunkId: z.uuid(),
  documentId: z.uuid(),
  documentTitle: z.string(),
  reference: z.string().nullable(),
  content: z.string(),
  position: z.number().int(),
  /** Reciprocal Rank Fusion score (higher is better; only meaningful for ordering). */
  score: z.number(),
  /** Cosine similarity to the query, or null when only the full-text search found the chunk. */
  similarity: z.number().nullable(),
  semanticRank: z.number().int().nullable(),
  keywordRank: z.number().int().nullable(),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
