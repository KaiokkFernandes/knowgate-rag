import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { PostgresHealthIndicator } from './postgres.health';
import { RedisHealthIndicator } from './redis.health';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [PostgresHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
