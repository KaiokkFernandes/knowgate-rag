import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../config/env';
import { TokenService } from './token.service';

const SECRET = 'a'.repeat(64);

function createService(secret = SECRET, ttl = 900): TokenService {
  const config = { get: () => ttl } as unknown as ConfigService<Env, true>;
  return new TokenService(new JwtService({ secret }), config);
}

/** Builds an unsigned JWT with "alg": "none" (classic forgery attempt). */
function unsignedToken(payload: object): string {
  const encode = (part: object) => Buffer.from(JSON.stringify(part)).toString('base64url');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.`;
}

describe('TokenService', () => {
  it('issues a Bearer access token that verifies back to the user id', async () => {
    const service = createService();

    const issued = await service.issueAccessToken('user-1');
    const payload = await service.verifyAccessToken(issued.accessToken);

    expect(issued).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(payload.sub).toBe('user-1');
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await createService('b'.repeat(64)).issueAccessToken('user-1');

    await expect(createService().verifyAccessToken(forged.accessToken)).rejects.toThrow();
  });

  it('rejects an unsigned token ("alg": "none")', async () => {
    const forged = unsignedToken({ sub: 'user-1', iss: 'knowgate-api', aud: 'knowgate' });

    await expect(createService().verifyAccessToken(forged)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const service = createService(SECRET, 1);
    const { accessToken } = await service.issueAccessToken('user-1');
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await expect(service.verifyAccessToken(accessToken)).rejects.toThrow(/expired/);
  });
});
