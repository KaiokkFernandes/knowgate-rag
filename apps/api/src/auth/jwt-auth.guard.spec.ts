import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { TokenService } from './token.service';

function contextWith(headers: Record<string, string>, isPublic = false) {
  const request: { headers: Record<string, string>; user?: unknown } = { headers };
  const reflector = { getAllAndOverride: () => isPublic } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, reflector, context };
}

const tokens = {
  verifyAccessToken: (token: string) =>
    token === 'valid' ? Promise.resolve({ sub: 'user-1' }) : Promise.reject(new Error('bad')),
} as unknown as TokenService;

describe('JwtAuthGuard', () => {
  it('lets @Public() routes through without a token', async () => {
    const { reflector, context } = contextWith({}, true);

    await expect(new JwtAuthGuard(reflector, tokens).canActivate(context)).resolves.toBe(true);
  });

  it.each([
    ['no Authorization header', {}],
    ['a non-Bearer scheme', { authorization: 'Basic valid' }],
    ['an invalid token', { authorization: 'Bearer forged' }],
  ])('rejects %s with 401', async (_case, headers) => {
    const { reflector, context } = contextWith(headers);

    await expect(new JwtAuthGuard(reflector, tokens).canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the user to the request for a valid token', async () => {
    const { request, reflector, context } = contextWith({ authorization: 'Bearer valid' });

    await expect(new JwtAuthGuard(reflector, tokens).canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 'user-1' });
  });
});
