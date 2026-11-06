import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthResponse } from '@knowgate/shared';
import type { Env } from '../config/env';
import type { AccessTokenPayload } from './auth.types';

export const JWT_ISSUER = 'knowgate-api';
export const JWT_AUDIENCE = 'knowgate';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issueAccessToken(userId: string): Promise<AuthResponse> {
    const expiresIn = this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    const payload: AccessTokenPayload = { sub: userId };
    const accessToken = await this.jwt.signAsync(payload, {
      algorithm: 'HS256',
      expiresIn,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn };
  }

  /** Throws if the signature, algorithm, issuer, audience or expiry is invalid. */
  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      // Pinning the algorithm blocks "alg: none" and algorithm-confusion attacks.
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }
}
