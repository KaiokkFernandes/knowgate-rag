import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaClient, Role } from '@knowgate/db';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.types';
import { PRISMA } from '../database/database.module';
import { ROLES_KEY, type RequestWithMembership } from './org-access';

const uuid = z.uuid();

/**
 * Global guard for every route with an :orgId parameter (secure by default: a new
 * organization route is protected even if nobody remembers to add a decorator).
 *
 * - The membership is read from the database on every request (primary key lookup), never
 *   from the token: removing a member or changing a role takes effect immediately.
 * - Non-members get 404, not 403, so the API does not confirm that an organization exists.
 * - @Roles(...) on the route then restricts by role (403: the user is a member, so the
 *   organization's existence is already known to them).
 *
 * Runs after JwtAuthGuard (AuthModule is imported before OrganizationsModule).
 */
@Injectable()
export class OrgAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithMembership & { user?: AuthenticatedUser }>();
    const orgId = request.params?.orgId;
    if (orgId === undefined) return true; // not an organization route

    const user = request.user;
    // Invalid UUIDs would make Postgres throw (500); they simply do not exist.
    if (!user || typeof orgId !== 'string' || !uuid.safeParse(orgId).success) {
      throw new NotFoundException();
    }

    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: orgId, userId: user.id } },
      select: { organizationId: true, userId: true, role: true },
    });
    if (!membership) throw new NotFoundException();

    const allowedRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException();
    }

    request.membership = membership;
    return true;
  }
}
