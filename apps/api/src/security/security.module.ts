import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../config/env';
import { isNotAuthRateLimited } from './rate-limit';

const ONE_MINUTE_MS = 60_000;

/**
 * Rate limiting per client IP, answering 429 when exceeded.
 * Storage is in memory: fine for a single instance. With several instances the counters
 * must be shared (a ThrottlerStorage backed by Redis).
 * Behind a reverse proxy, Express must trust it ("trust proxy") or every client shares the
 * proxy's IP; that is configured with the deploy (phase 4).
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        {
          name: 'default',
          ttl: ONE_MINUTE_MS,
          limit: config.get('RATE_LIMIT_PER_MINUTE', { infer: true }),
        },
        {
          name: 'auth',
          ttl: ONE_MINUTE_MS,
          limit: config.get('AUTH_RATE_LIMIT_PER_MINUTE', { infer: true }),
          skipIf: isNotAuthRateLimited,
        },
      ],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class SecurityModule {}
