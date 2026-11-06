import { Controller, Get, Inject, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@knowgate/db';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { PRISMA } from '../database/database.module';

@Controller('me')
export class UsersController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** The authenticated user and the organizations they belong to (never the password hash). */
  @Get()
  async me(@CurrentUser() current: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: current.id },
      select: {
        id: true,
        email: true,
        name: true,
        memberships: {
          select: { role: true, organization: { select: { id: true, name: true } } },
        },
      },
    });
    // A valid token for a deleted user.
    if (!user) throw new NotFoundException();

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organizations: user.memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
      })),
    };
  }
}
