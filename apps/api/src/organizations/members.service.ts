import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient, type Role } from '@knowgate/db';
import type { AddMemberRequest } from '@knowgate/shared';
import { PRISMA } from '../database/database.module';
import type { OrgMembership } from './org-access';

type Tx = Prisma.TransactionClient;

const memberSelect = {
  role: true,
  createdAt: true,
  user: { select: { id: true, email: true, name: true } },
} as const;

function toMember(m: {
  role: Role;
  createdAt: Date;
  user: { id: string; email: string; name: string };
}) {
  return {
    userId: m.user.id,
    email: m.user.email,
    name: m.user.name,
    role: m.role,
    joinedAt: m.createdAt,
  };
}

@Injectable()
export class MembersService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      select: memberSelect,
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map(toMember);
  }

  /** Adds an existing user by e-mail (invitation links for new users are a later step). */
  async add(organizationId: string, input: AddMemberRequest) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('No user with this e-mail');

    try {
      const membership = await this.prisma.membership.create({
        data: { organizationId, userId: user.id, role: input.role },
        select: memberSelect,
      });
      return toMember(membership);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('User is already a member');
      }
      throw error;
    }
  }

  async updateRole(organizationId: string, userId: string, role: Role) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const current = await findMembership(tx, organizationId, userId);

      if (current.role === 'ADMIN' && role !== 'ADMIN') {
        await assertNotLastAdmin(tx, organizationId);
      }
      const updated = await tx.membership.update({
        where: { organizationId_userId: { organizationId, userId } },
        data: { role },
        select: memberSelect,
      });
      return toMember(updated);
    });
  }

  /**
   * Admins can remove anyone; any member can remove themselves (leave).
   * Team memberships go away with it (composite foreign key, ON DELETE CASCADE).
   */
  async remove(actor: OrgMembership, userId: string): Promise<void> {
    const { organizationId } = actor;
    if (actor.role !== 'ADMIN' && actor.userId !== userId) {
      throw new ForbiddenException();
    }

    await this.prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const target = await findMembership(tx, organizationId, userId);
      if (target.role === 'ADMIN') await assertNotLastAdmin(tx, organizationId);

      await tx.membership.delete({
        where: { organizationId_userId: { organizationId, userId } },
      });
    });
  }
}

/**
 * Serializes membership changes of one organization. Without it, two admins demoting each
 * other at the same time would both see "2 admins" and leave the organization with none.
 */
async function lockOrganization(tx: Tx, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
}

async function findMembership(tx: Tx, organizationId: string, userId: string) {
  const membership = await tx.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { role: true },
  });
  if (!membership) throw new NotFoundException();
  return membership;
}

async function assertNotLastAdmin(tx: Tx, organizationId: string): Promise<void> {
  const admins = await tx.membership.count({ where: { organizationId, role: 'ADMIN' } });
  if (admins <= 1) {
    throw new ConflictException('An organization must keep at least one admin');
  }
}
