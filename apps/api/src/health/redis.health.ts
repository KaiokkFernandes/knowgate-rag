import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

const TIMEOUT_MS = 2_000;

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /** Sends `PING`; marks `redis` as down if it throws or exceeds the timeout. */
  check() {
    return this.healthIndicatorService
      .check('redis')
      .attempt(async () => {
        // Connection errors surface as a rejected promise; the reply is typed as 'PONG'.
        await this.redis.ping();
      })
      .withTimeout(TIMEOUT_MS);
  }
}
