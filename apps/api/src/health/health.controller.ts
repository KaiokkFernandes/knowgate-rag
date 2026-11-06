import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import type { HealthResponse } from '@knowgate/shared';
import { PostgresHealthIndicator } from './postgres.health';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly postgres: PostgresHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** 200 when every dependency is up; 503 (thrown by Terminus) when any is down. */
  @Get()
  @HealthCheck()
  check(): Promise<HealthResponse> {
    return this.health.check([() => this.postgres.check(), () => this.redis.check()]);
  }
}
