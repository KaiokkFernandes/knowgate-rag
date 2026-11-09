import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaClient } from '@knowgate/db';
import type { CreateOrganizationRequest } from '@knowgate/shared';
import type { Env } from '../config/env';
import { PRISMA } from '../database/database.module';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Creates the organization with its creator as ADMIN, atomically (nested write = one transaction). */
  async create(userId: string, input: CreateOrganizationRequest) {
    const organization = await this.prisma.organization.create({
      data: {
        name: input.name,
        dailyTokenLimit: this.config.get('DAILY_TOKEN_LIMIT_DEFAULT', { infer: true }),
        memberships: { create: { userId, role: 'ADMIN' } },
      },
      select: { id: true, name: true, dailyTokenLimit: true, createdAt: true },
    });
    return { ...organization, role: 'ADMIN' as const };
  }

  async get(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, dailyTokenLimit: true, createdAt: true },
    });
    if (!organization) throw new NotFoundException();
    return organization;
  }
}
