import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createApp } from './setup/create-app';

describe('Rate limiting (integration)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp({ AUTH_RATE_LIMIT_PER_MINUTE: '5', RATE_LIMIT_PER_MINUTE: '100' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 on the 6th login attempt within a minute', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'brute@example.test', password: 'guess guess' });

    for (let i = 0; i < 5; i++) {
      await attempt().expect(401);
    }
    const blocked = await attempt().expect(429);

    expect(blocked.headers['retry-after-auth']).toBeDefined();
  });

  it('does not rate limit /health', async () => {
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  });
});
