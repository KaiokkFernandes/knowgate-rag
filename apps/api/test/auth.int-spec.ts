import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { authResponseSchema } from '@knowgate/shared';
import { createApp } from './setup/create-app';
import { refreshCookieFrom, setCookieHeader, uniqueEmail } from './setup/http';

const PASSWORD = 'correct horse battery';

describe('Auth (integration)', () => {
  let app: INestApplication<App>;
  let pool: Pool;

  beforeAll(async () => {
    // Rate limiting is covered in its own file; here many logins come from the same IP.
    app = await createApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000' });
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const register = (email: string, password = PASSWORD) =>
    http().post('/auth/register').send({ email, password, name: 'Test User' });
  const login = (email: string, password = PASSWORD) =>
    http().post('/auth/login').send({ email, password });

  describe('POST /auth/register', () => {
    it('creates the user, returns an access token and sets the refresh cookie', async () => {
      const email = uniqueEmail();

      const response = await register(email).expect(201);

      expect(authResponseSchema.parse(response.body)).toMatchObject({ tokenType: 'Bearer' });
      expect(setCookieHeader(response)).toMatch(
        /kg_refresh=[^;]+; Path=\/auth; Expires=[^;]+; HttpOnly; SameSite=Strict/,
      );
    });

    it('stores the password as an Argon2id hash, never in plain text', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);

      const { rows } = await pool.query<{ passwordHash: string }>(
        `SELECT "passwordHash" FROM "User" WHERE email = $1`,
        [email],
      );

      expect(rows[0]?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      expect(rows[0]?.passwordHash).not.toContain(PASSWORD);
    });

    it('rejects a duplicate e-mail regardless of case and spaces (409)', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);

      await register(`  ${email.toUpperCase()} `).expect(409);
    });

    it('rejects invalid input (400) without echoing the password', async () => {
      const response = await register('not-an-email', 'short').expect(400);

      expect(response.body).toMatchObject({ message: 'Validation failed' });
      expect(JSON.stringify(response.body)).not.toContain('short');
    });
  });

  describe('POST /auth/login', () => {
    it('logs in with the right password', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);

      const response = await login(email).expect(200);

      expect(authResponseSchema.parse(response.body).accessToken).toBeTruthy();
    });

    it('answers wrong password and unknown e-mail with the same 401', async () => {
      const email = uniqueEmail();
      await register(email).expect(201);

      const wrongPassword = await login(email, 'wrong password').expect(401);
      const unknownEmail = await login(uniqueEmail()).expect(401);

      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });
  });

  describe('GET /me', () => {
    it('requires a valid access token', async () => {
      await http().get('/me').expect(401);
      await http().get('/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    });

    it('returns the current user without sensitive fields', async () => {
      const email = uniqueEmail();
      const { accessToken } = authResponseSchema.parse((await register(email).expect(201)).body);

      const response = await http()
        .get('/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body).toEqual({
        id: expect.any(String) as unknown,
        email,
        name: 'Test User',
        organizations: [],
      });
    });
  });

  describe('refresh token rotation', () => {
    it('exchanges the refresh cookie for a new token pair', async () => {
      const first = refreshCookieFrom(await register(uniqueEmail()).expect(201));

      const response = await http().post('/auth/refresh').set('Cookie', first).expect(200);

      expect(authResponseSchema.parse(response.body).accessToken).toBeTruthy();
      expect(refreshCookieFrom(response)).not.toBe(first);
    });

    it('treats reuse of a rotated token as theft and revokes every session', async () => {
      const stolen = refreshCookieFrom(await register(uniqueEmail()).expect(201));
      const rotated = refreshCookieFrom(
        await http().post('/auth/refresh').set('Cookie', stolen).expect(200),
      );

      await http().post('/auth/refresh').set('Cookie', stolen).expect(401);
      // The legitimate, newer token is revoked as well.
      await http().post('/auth/refresh').set('Cookie', rotated).expect(401);
    });

    it('rejects a missing or unknown refresh token', async () => {
      await http().post('/auth/refresh').expect(401);
      await http().post('/auth/refresh').set('Cookie', 'kg_refresh=unknown').expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const cookie = refreshCookieFrom(await register(uniqueEmail()).expect(201));

      const response = await http().post('/auth/logout').set('Cookie', cookie).expect(204);

      expect(setCookieHeader(response)).toMatch(
        /kg_refresh=; Path=\/auth; Expires=Thu, 01 Jan 1970/,
      );
      await http().post('/auth/refresh').set('Cookie', cookie).expect(401);
    });
  });

  it('keeps /health public', async () => {
    const response = await http().get('/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok' });
  });
});
