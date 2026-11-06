import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import type { Env } from '../config/env';

export const PG_POOL = Symbol('PG_POOL');

/**
 * Provides a single shared PostgreSQL connection pool.
 * In phase 1b Prisma will be built on top of this same pool (driver adapter),
 * and the raw pgvector / full-text queries can use it directly.
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
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
