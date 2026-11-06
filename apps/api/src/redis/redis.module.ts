import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Provides a single shared Redis client (usage limits and cache in later phases). */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const client = new Redis(config.get('REDIS_URL', { infer: true }), {
          // Fail fast instead of queueing commands forever when Redis is down.
          maxRetriesPerRequest: 1,
        });
        // Without a listener ioredis prints "Unhandled error event" on every reconnect attempt.
        // Only the message is logged: the connection URL (which may hold a password) is not.
        const logger = new Logger('Redis');
        client.on('error', (err: NodeJS.ErrnoException) => {
          // Node's dual-stack connect throws an AggregateError with an empty message; the code is set.
          logger.warn(`Connection error: ${err.message || err.code || err.name}`);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit();
  }
}
