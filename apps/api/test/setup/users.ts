import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authResponseSchema } from '@knowgate/shared';
import { uniqueEmail } from './http';

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

/** Registers a fresh user and returns its id and access token. */
export async function registerUser(app: INestApplication<App>): Promise<TestUser> {
  const email = uniqueEmail();
  const registered = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'correct horse battery', name: 'Test User' })
    .expect(201);
  const { accessToken } = authResponseSchema.parse(registered.body);

  const me = await request(app.getHttpServer())
    .get('/me')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);
  return { id: (me.body as { id: string }).id, email, token: accessToken };
}
