import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@knowgate/db';
import type { Env } from '../config/env';
import { PRISMA } from '../database/database.module';

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

/**
 * Opaque refresh tokens with rotation and reuse detection.
 * - The token is 32 random bytes; only its SHA-256 is stored. A fast hash is enough
 *   because the token has 256 bits of entropy (brute force is not an option, unlike passwords).
 * - Every refresh revokes the presented token and issues a new one (rotation).
 * - A revoked token presented again means it leaked: every session of the user is revoked.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async create(userId: string): Promise<IssuedRefreshToken> {
    const { token, tokenHash, expiresAt } = this.generate();
    await this.prisma.session.create({ data: { userId, tokenHash, expiresAt } });
    return { token, expiresAt };
  }

  /** Exchanges a refresh token for a new one. Returns the user id it belongs to. */
  async rotate(presentedToken: string): Promise<{ userId: string; refresh: IssuedRefreshToken }> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(presentedToken) },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    if (!session) throw new UnauthorizedException();

    if (session.revokedAt) {
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException();
    }
    if (session.expiresAt <= new Date()) throw new UnauthorizedException();

    const next = this.generate();
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional update: if two requests race with the same token, only one revokes it.
      const { count } = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) return false;

      const created = await tx.session.create({
        data: { userId: session.userId, tokenHash: next.tokenHash, expiresAt: next.expiresAt },
        select: { id: true },
      });
      await tx.session.update({ where: { id: session.id }, data: { replacedById: created.id } });
      return true;
    });

    if (!rotated) {
      // Lost the race: the token was already used, so it is treated as reuse.
      await this.revokeAllForUser(session.userId);
      throw new UnauthorizedException();
    }
    return { userId: session.userId, refresh: { token: next.token, expiresAt: next.expiresAt } };
  }

  /** Logout: revokes the session of this token (no-op if unknown or already revoked). */
  async revoke(presentedToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(presentedToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private generate() {
    const token = randomBytes(32).toString('base64url');
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    return {
      token,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
