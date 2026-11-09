import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@knowgate/db';
import type { Request } from 'express';

/** Membership of the current user in the organization of the route (set by OrgAccessGuard). */
export interface OrgMembership {
  organizationId: string;
  userId: string;
  role: Role;
}

export type RequestWithMembership = Request & { membership?: OrgMembership };

export const ROLES_KEY = 'roles';

/** Restricts an /orgs/:orgId route to the given roles (checked by OrgAccessGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Injects the membership resolved by OrgAccessGuard. Only valid on routes with :orgId. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): OrgMembership => {
    const membership = context.switchToHttp().getRequest<RequestWithMembership>().membership;
    if (!membership) {
      // Programming error: the route has no :orgId, so the guard never resolved a membership.
      throw new Error('CurrentMembership used on a route without :orgId');
    }
    return membership;
  },
);
