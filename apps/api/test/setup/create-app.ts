import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { App } from 'supertest/types';

/**
 * Boots the real AppModule (real Postgres, Redis, guards, pipes) with the production
 * HTTP configuration. Env overrides must be set before the first call in a test file:
 * the config is read when AppModule is first imported (each test file has its own registry).
 */
export async function createApp(env: Record<string, string> = {}): Promise<INestApplication<App>> {
  Object.assign(process.env, env);
  const { AppModule } = await import('../../src/app.module.js');
  const { configureApp } = await import('../../src/app.setup.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}
