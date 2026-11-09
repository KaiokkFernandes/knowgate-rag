import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { OrgAccessGuard } from './org-access.guard';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  controllers: [OrganizationsController, MembersController],
  providers: [
    OrganizationsService,
    MembersService,
    { provide: APP_GUARD, useClass: OrgAccessGuard },
  ],
})
export class OrganizationsModule {}
