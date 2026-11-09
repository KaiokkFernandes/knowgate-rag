import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@knowgate/db';
import { PRISMA } from '../database/database.module';

/**
 * Every query filters by the team id AND the organization id from the route membership,
 * never by the team id alone: a team id from another organization is simply not found (IDOR).
 */
@Injectable()
export class TeamsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async list(organizationId: string) {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      select: { id: true, name: true, createdAt: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
    return teams.map(({ _count, ...team }) => ({ ...team, memberCount: _count.members }));
  }

  async create(organizationId: string, name: string) {
    try {
      const team = await this.prisma.team.create({
        data: { organizationId, name },
        select: { id: true, name: true, createdAt: true },
      });
      return { ...team, memberCount: 0 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A team with this name already exists');
      }
      throw error;
    }
  }

  /**
   * Team memberships and document shares go with the team (ON DELETE CASCADE).
   * A TEAMS-visibility document shared only with this team becomes visible to no member;
   * the documents module (phase 2) must account for that.
   */
  async remove(organizationId: string, teamId: string): Promise<void> {
    const { count } = await this.prisma.team.deleteMany({ where: { id: teamId, organizationId } });
    if (count === 0) throw new NotFoundException();
  }

  async listMembers(organizationId: string, teamId: string) {
    await this.assertTeamInOrganization(organizationId, teamId);
    const members = await this.prisma.teamMember.findMany({
      where: { teamId, organizationId },
      select: {
        createdAt: true,
        membership: {
          select: { role: true, user: { select: { id: true, email: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.membership.user.id,
      email: m.membership.user.email,
      name: m.membership.user.name,
      role: m.membership.role,
      addedAt: m.createdAt,
    }));
  }

  /** Idempotent: adding someone who is already in the team is a no-op. */
  async addMember(organizationId: string, teamId: string, userId: string): Promise<void> {
    await this.assertTeamInOrganization(organizationId, teamId);
    const membership = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { userId: true },
    });
    // Also enforced by the composite foreign key TeamMember → Membership(organizationId, userId).
    if (!membership) throw new NotFoundException('User is not a member of this organization');

    await this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { organizationId, teamId, userId },
      update: {},
    });
  }

  async removeMember(organizationId: string, teamId: string, userId: string): Promise<void> {
    const { count } = await this.prisma.teamMember.deleteMany({
      where: { organizationId, teamId, userId },
    });
    if (count === 0) throw new NotFoundException();
  }

  private async assertTeamInOrganization(organizationId: string, teamId: string): Promise<void> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId },
      select: { id: true },
    });
    if (!team) throw new NotFoundException();
  }
}
