import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';

/** Unique e-mail per test: tests share the database and never depend on each other's data. */
export function uniqueEmail(): string {
  return `user-${randomUUID()}@example.test`;
}

/** Returns the `kg_refresh=...` pair from Set-Cookie, ready to send back in a Cookie header. */
export function refreshCookieFrom(response: Response): string {
  const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = setCookie?.find((c) => c.startsWith('kg_refresh='));
  if (!cookie) throw new Error('Response has no kg_refresh cookie');
  return cookie.split(';')[0]!;
}

export function setCookieHeader(response: Response): string {
  const setCookie = response.headers['set-cookie'] as unknown as string[] | undefined;
  return (setCookie ?? []).join('\n');
}
