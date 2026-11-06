import { PrismaPg } from '@prisma/adapter-pg';
import type { Pool } from 'pg';
import { PrismaClient } from './generated/prisma/client.js';

/**
 * Creates a PrismaClient on top of an existing pg Pool.
 * The API, the MCP server and scripts share one pool per process: Prisma and the raw
 * pgvector / full-text queries (ChunkRepository) then use the same connections.
 * The caller owns the pool and is responsible for closing it.
 */
export function createPrismaClient(pool: Pool): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}
