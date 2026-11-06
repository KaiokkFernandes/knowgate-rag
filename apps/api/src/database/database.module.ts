import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrismaClient, type PrismaClient } from '@knowgate/db';
import { Pool } from 'pg';
import type { Env } from '../config/env';

export const PG_POOL = Symbol('PG_POOL');
export const PRISMA = Symbol('PRISMA');

/**
 * Provides one shared PostgreSQL pool and a PrismaClient built on top of it.
 * Prisma (regular queries) and raw pgvector / full-text SQL (ChunkRepository, phase 2)
 * therefore share the same connections and the same pool limits.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: 10,
          connectionTimeoutMillis: 5_000,
        }),
    },
    {
      provide: PRISMA,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => createPrismaClient(pool),
    },
  ],
  exports: [PG_POOL, PRISMA],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    // Prisma does not end a pool it did not create, so the pool is closed explicitly after it.
    await this.prisma.$disconnect();
    await this.pool.end();
  }
}
