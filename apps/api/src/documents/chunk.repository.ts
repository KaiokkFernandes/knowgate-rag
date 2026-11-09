import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@knowgate/db';
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

/** pgvector text format: "[0.1,0.2,...]". Rejects NaN/Infinity, which pgvector refuses. */
export function toVectorLiteral(vector: number[]): string {
  if (!vector.every(Number.isFinite)) throw new Error('Embedding contains a non-finite value');
  return `[${vector.join(',')}]`;
}
