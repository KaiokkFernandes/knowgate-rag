import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { type CreateTeamRequest, createTeamRequestSchema } from '@knowgate/shared';
import { uuidParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentMembership, type OrgMembership, Roles } from './org-access';
import { TeamsService } from './teams.service';

/** Any member can see teams; only admins manage them (CLAUDE.md §7). */
@Controller('orgs/:orgId/teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  list(@CurrentMembership() membership: OrgMembership) {
    return this.teams.list(membership.organizationId);
  }

  @Post()
  @Roles('ADMIN')
  create(
    @CurrentMembership() membership: OrgMembership,
    @Body(new ZodValidationPipe(createTeamRequestSchema)) body: CreateTeamRequest,
  ) {
    return this.teams.create(membership.organizationId, body.name);
  }

  @Delete(':teamId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: OrgMembership,
    @Param('teamId', uuidParam()) teamId: string,
  ): Promise<void> {
    return this.teams.remove(membership.organizationId, teamId);
  }

  @Get(':teamId/members')
  listMembers(
    @CurrentMembership() membership: OrgMembership,
    @Param('teamId', uuidParam()) teamId: string,
  ) {
    return this.teams.listMembers(membership.organizationId, teamId);
  }

  /** PUT: idempotent, the URL fully identifies the team membership. */
  @Put(':teamId/members/:userId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  addMember(
    @CurrentMembership() membership: OrgMembership,
    @Param('teamId', uuidParam()) teamId: string,
    @Param('userId', uuidParam()) userId: string,
  ): Promise<void> {
    return this.teams.addMember(membership.organizationId, teamId, userId);
  }

  @Delete(':teamId/members/:userId')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMember(
    @CurrentMembership() membership: OrgMembership,
    @Param('teamId', uuidParam()) teamId: string,
    @Param('userId', uuidParam()) userId: string,
  ): Promise<void> {
    return this.teams.removeMember(membership.organizationId, teamId, userId);
  }
}
