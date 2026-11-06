import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

const TIMEOUT_MS = 2_000;

@Injectable()
export class PostgresHealthIndicator {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /** Runs `SELECT 1`; marks `postgres` as down if it throws or exceeds the timeout. */
  check() {
    return this.healthIndicatorService
      .check('postgres')
      .attempt(async () => {
        await this.pool.query('SELECT 1');
      })
      .withTimeout(TIMEOUT_MS);
  }
}
