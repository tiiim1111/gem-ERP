import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  controllers: [RolesController, PermissionsController],
  providers: [RolesService],
})
export class RolesModule {}
