import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import { healthResponseSchema } from '@knowgate/shared';
import { HealthController } from './health.controller';
import { PostgresHealthIndicator } from './postgres.health';
import { RedisHealthIndicator } from './redis.health';

/** Fake indicator: same Terminus API as the real ones, but with no network. */
function fakeIndicator(key: string, healthy: boolean) {
  return {
    provide: key === 'postgres' ? PostgresHealthIndicator : RedisHealthIndicator,
    inject: [HealthIndicatorService],
    useFactory: (his: HealthIndicatorService) => ({
      check: () =>
        his
          .check(key)
          .attempt(() => {
            if (!healthy) throw new Error('connection refused');
          })
          .withTimeout(100),
    }),
  };
}

async function createController(pg: boolean, redis: boolean): Promise<HealthController> {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule.forRoot({ logger: false })],
    controllers: [HealthController],
    providers: [fakeIndicator('postgres', pg), fakeIndicator('redis', redis)],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('returns ok when Postgres and Redis are up', async () => {
    const controller = await createController(true, true);

    const result = await controller.check();

    expect(healthResponseSchema.parse(result)).toBeTruthy();
    expect(result.status).toBe('ok');
    expect(result.details.postgres?.status).toBe('up');
    expect(result.details.redis?.status).toBe('up');
  });

  it('throws 503 and reports the failing dependency when one is down', async () => {
    const controller = await createController(true, false);

    const error = await controller.check().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse();
    const parsed = healthResponseSchema.parse(body);
    expect(parsed.status).toBe('error');
    expect(parsed.details.postgres?.status).toBe('up');
    expect(parsed.details.redis?.status).toBe('down');
  });
});
