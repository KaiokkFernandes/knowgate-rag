import { type ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PrismaClient } from '@knowgate/db';
import { OrgAccessGuard } from './org-access.guard';

const ORG_ID = '01a1b2c3-0000-7000-8000-000000000001';

function setup(options: {
  params?: Record<string, string>;
  user?: { id: string };
  membershipRole?: 'ADMIN' | 'MEMBER' | null;
  requiredRoles?: string[];
}) {
  const request: Record<string, unknown> = {
    params: options.params ?? {},
    user: options.user ?? { id: 'user-1' },
  };
  const findUnique = jest
    .fn()
    .mockResolvedValue(
      options.membershipRole
        ? { organizationId: ORG_ID, userId: 'user-1', role: options.membershipRole }
        : null,
    );
  const prisma = { membership: { findUnique } } as unknown as PrismaClient;
  const reflector = { getAllAndOverride: () => options.requiredRoles } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { guard: new OrgAccessGuard(reflector, prisma), context, request, findUnique };
}

describe('OrgAccessGuard', () => {
  it('ignores routes without :orgId', async () => {
    const { guard, context, findUnique } = setup({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 for a malformed orgId without querying the database', async () => {
    const { guard, context, findUnique } = setup({ params: { orgId: 'not-a-uuid' } });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers 404 (not 403) when the user is not a member', async () => {
    const { guard, context } = setup({ params: { orgId: ORG_ID }, membershipRole: null });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 403 when the member lacks the required role', async () => {
    const { guard, context } = setup({
      params: { orgId: ORG_ID },
      membershipRole: 'MEMBER',
      requiredRoles: ['ADMIN'],
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('attaches the membership for an allowed member', async () => {
    const { guard, context, request } = setup({
      params: { orgId: ORG_ID },
      membershipRole: 'ADMIN',
      requiredRoles: ['ADMIN'],
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.membership).toEqual({ organizationId: ORG_ID, userId: 'user-1', role: 'ADMIN' });
  });
});
