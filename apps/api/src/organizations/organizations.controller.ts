import { Body, Controller, Get, Post } from '@nestjs/common';
import { type CreateOrganizationRequest, createOrganizationRequestSchema } from '@knowgate/shared';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentMembership, type OrgMembership } from './org-access';
import { OrganizationsService } from './organizations.service';

@Controller('orgs')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** Any authenticated user can create an organization and becomes its ADMIN. */
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrganizationRequestSchema)) body: CreateOrganizationRequest,
  ) {
    return this.organizations.create(user.id, body);
  }

  @Get(':orgId')
  async get(@CurrentMembership() membership: OrgMembership) {
    const organization = await this.organizations.get(membership.organizationId);
    return { ...organization, role: membership.role };
  }
}
