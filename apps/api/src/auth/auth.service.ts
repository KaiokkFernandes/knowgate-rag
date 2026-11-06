import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@knowgate/db';
import type { AuthResponse, LoginRequest, RegisterRequest } from '@knowgate/shared';
import { PRISMA } from '../database/database.module';
import { PasswordService } from './password.service';
import { type IssuedRefreshToken, SessionService } from './session.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async register(input: RegisterRequest): Promise<IssuedSession> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      const user = await this.prisma.user.create({
        data: { email: input.email, name: input.name, passwordHash },
        select: { id: true },
      });
      return await this.issueSession(user.id);
    } catch (error) {
      // Unique violation on email. Relying on the constraint (not a SELECT first) is race-free.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('E-mail already registered');
      }
      throw error;
    }
  }

  async login(input: LoginRequest): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, passwordHash: true },
    });

    const valid = user
      ? await this.passwords.verify(user.passwordHash, input.password)
      : await this.passwords.verifyDummy(input.password);
    // One generic error for unknown e-mail and wrong password (no account enumeration).
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');

    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(input.password) },
      });
    }

    return this.issueSession(user.id);
  }

  async refresh(refreshToken: string): Promise<IssuedSession> {
    const { userId, refresh } = await this.sessions.rotate(refreshToken);
    return { tokens: await this.tokens.issueAccessToken(userId), refresh };
  }

  logout(refreshToken: string): Promise<void> {
    return this.sessions.revoke(refreshToken);
  }

  private async issueSession(userId: string): Promise<IssuedSession> {
    const [tokens, refresh] = await Promise.all([
      this.tokens.issueAccessToken(userId),
      this.sessions.create(userId),
    ]);
    return { tokens, refresh };
  }
}

export interface IssuedSession {
  tokens: AuthResponse;
  refresh: IssuedRefreshToken;
}
