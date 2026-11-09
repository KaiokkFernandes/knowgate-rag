import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@knowgate/db';
import type { SearchResult } from '@knowgate/shared';
import { PRISMA } from '../database/database.module';

export interface ChunkToEmbed {
  id: string;
  content: string;
  context: string | null;
}

/**
 * The only place with raw SQL for chunks (vector and full-text columns that Prisma cannot
 * map). Always tagged templates ($queryRaw / $executeRaw): values are sent as parameters,
 * never concatenated into the SQL.
 */
@Injectable()
export class ChunkRepository {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Next chunks of a document that still have no embedding, in document order. */
  findWithoutEmbedding(organizationId: string, documentId: string, limit: number) {
    return this.prisma.$queryRaw<ChunkToEmbed[]>`
      SELECT id, content, context
        FROM "Chunk"
       WHERE "organizationId" = ${organizationId}::uuid
         AND "documentId" = ${documentId}::uuid
         AND embedding IS NULL
       ORDER BY position
       LIMIT ${limit}`;
  }

  /** Cheap check before paying for a query embedding: is there anything to search? */
  async hasSearchableChunks(scope: SearchScope): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
          FROM "Chunk" c
          JOIN "Document" d ON d.id = c."documentId" AND d."organizationId" = c."organizationId"
         WHERE ${accessFilter(scope)}
           AND c.embedding IS NOT NULL) AS found`;
    return rows[0]?.found ?? false;
  }

  /**
   * Hybrid search: vector similarity (HNSW, cosine) and Portuguese full-text, each taking its
   * best CANDIDATES chunks inside the access filter, combined with Reciprocal Rank Fusion:
   * score = sum of 1 / (RRF_K + rank). RRF uses only ranks, so the two scales (cosine
   * distance and ts_rank) never need to be normalized against each other.
   */
  hybridSearch(params: HybridSearchParams): Promise<SearchResult[]> {
    const vector = toVectorLiteral(params.queryVector);
    const access = accessFilter(params);
    return this.prisma.$transaction(async (tx) => {
      // HNSW filters AFTER finding neighbors: in a small tenant next to a big one, the nearest
      // neighbors may all belong to others and be filtered out. Iterative scan keeps scanning
      // the index until enough rows pass the filter (pgvector >= 0.8). LOCAL: this transaction only.
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = relaxed_order`;
      return tx.$queryRaw<SearchResult[]>`
        WITH semantic AS MATERIALIZED (
          -- Filters inside the CTE so the index scan applies them (pgvector README).
          SELECT c.id, c.embedding <=> ${vector}::vector AS distance
            FROM "Chunk" c
            JOIN "Document" d ON d.id = c."documentId" AND d."organizationId" = c."organizationId"
           WHERE ${access}
             AND c.embedding IS NOT NULL
           ORDER BY distance
           LIMIT ${CANDIDATES}
        ),
        semantic_ranked AS (
          -- relaxed_order may return rows slightly out of order: rank them strictly here
          -- ("+ 0" keeps Postgres 17+ from reusing the index order).
          SELECT id, distance, RANK() OVER (ORDER BY distance + 0) AS rank FROM semantic
        ),
        keyword AS (
          SELECT c.id, RANK() OVER (ORDER BY ts_rank_cd(c."searchVector", q.query) DESC) AS rank
            FROM "Chunk" c
            JOIN "Document" d ON d.id = c."documentId" AND d."organizationId" = c."organizationId",
                 -- OR between the words of the question (plainto_tsquery uses AND, too strict for
                 -- natural-language questions); ts_rank_cd still favors chunks matching more words.
                 (SELECT replace(plainto_tsquery('portuguese_unaccent', ${params.queryText})::text,
                                 '&', '|')::tsquery AS query) q
           WHERE ${access}
             AND c."searchVector" @@ q.query
           ORDER BY ts_rank_cd(c."searchVector", q.query) DESC
           LIMIT ${CANDIDATES}
        )
        SELECT c.id AS "chunkId",
               c."documentId",
               d.title AS "documentTitle",
               c.reference,
               c.content,
               c.position,
               (COALESCE(1.0 / (${RRF_K} + s.rank), 0) + COALESCE(1.0 / (${RRF_K} + k.rank), 0))::float8 AS score,
               (1 - s.distance)::float8 AS similarity,
               s.rank::int AS "semanticRank",
               k.rank::int AS "keywordRank"
          FROM semantic_ranked s
          FULL OUTER JOIN keyword k ON k.id = s.id
          JOIN "Chunk" c ON c.id = COALESCE(s.id, k.id)
          JOIN "Document" d ON d.id = c."documentId"
         ORDER BY score DESC, c.id
         LIMIT ${params.limit}`;
    });
  }

  /** Stores many embeddings in one statement (unnest pairs each id with its vector). */
  async setEmbeddings(organizationId: string, items: { id: string; vector: number[] }[]) {
    if (items.length === 0) return 0;
    const ids = items.map((item) => item.id);
    const vectors = items.map((item) => toVectorLiteral(item.vector));
    return this.prisma.$executeRaw`
      UPDATE "Chunk" AS c
         SET embedding = v.embedding::vector
        FROM unnest(${ids}::uuid[], ${vectors}::text[]) AS v(id, embedding)
       WHERE c.id = v.id
         AND c."organizationId" = ${organizationId}::uuid`;
  }
}

export interface SearchScope {
  organizationId: string;
  userId: string;
  /** Admins search every document of the organization (same rule as documentAccessWhere). */
  isAdmin: boolean;
}

export interface HybridSearchParams extends SearchScope {
  queryVector: number[];
  queryText: string;
  limit: number;
}

/** Candidates taken from each method before fusion (equal to hnsw.ef_search's default). */
const CANDIDATES = 40;
/** RRF constant from the original paper (Cormack et al., 2009); dampens the top ranks. */
const RRF_K = 60;

/**
 * Chunks the user may read: tenant first, then only READY documents that are ORG-wide or
 * shared with one of the user's teams (admins: all). The same rule as documentAccessWhere,
 * written in SQL for the search queries; integration tests cover both.
 */
function accessFilter(scope: SearchScope): Prisma.Sql {
  return Prisma.sql`
        c."organizationId" = ${scope.organizationId}::uuid
    AND d.status = 'READY'
    AND (
          ${scope.isAdmin}::boolean
       OR d.visibility = 'ORG'
       OR EXISTS (
            SELECT 1
              FROM "DocumentTeam" dt
              JOIN "TeamMember" tm
                ON tm."teamId" = dt."teamId" AND tm."organizationId" = dt."organizationId"
             WHERE dt."documentId" = d.id
               AND tm."userId" = ${scope.userId}::uuid))`;
}

/** pgvector text format: "[0.1,0.2,...]". Rejects NaN/Infinity, which pgvector refuses. */
export function toVectorLiteral(vector: number[]): string {
  if (!vector.every(Number.isFinite)) throw new Error('Embedding contains a non-finite value');
  return `[${vector.join(',')}]`;
}
