import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  type AddMemberRequest,
  addMemberRequestSchema,
  type UpdateMemberRoleRequest,
  updateMemberRoleRequestSchema,
} from '@knowgate/shared';
import { uuidParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CurrentMembership, type OrgMembership, Roles } from './org-access';
import { MembersService } from './members.service';

/** Membership of the organization is enforced by OrgAccessGuard (route has :orgId). */
@Controller('orgs/:orgId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(@CurrentMembership() membership: OrgMembership) {
    return this.members.list(membership.organizationId);
  }

  @Post()
  @Roles('ADMIN')
  add(
    @CurrentMembership() membership: OrgMembership,
    @Body(new ZodValidationPipe(addMemberRequestSchema)) body: AddMemberRequest,
  ) {
    return this.members.add(membership.organizationId, body);
  }

  @Patch(':userId')
  @Roles('ADMIN')
  updateRole(
    @CurrentMembership() membership: OrgMembership,
    @Param('userId', uuidParam()) userId: string,
    @Body(new ZodValidationPipe(updateMemberRoleRequestSchema)) body: UpdateMemberRoleRequest,
  ) {
    return this.members.updateRole(membership.organizationId, userId, body.role);
  }

  /** Admins remove anyone; members can only remove themselves (leave the organization). */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: OrgMembership,
    @Param('userId', uuidParam()) userId: string,
  ): Promise<void> {
    return this.members.remove(membership, userId);
  }
}
