import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
} from '../common/types/auth-request';
import { CreateUserDto } from './dto/create-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetBranchAccessDto } from './dto/set-branch-access.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService, UserView } from './users.service';

@ApiTags('users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.user.view)
  @ApiOperation({ summary: 'List users (never returns password data).' })
  list(@Query() query: QueryUsersDto): Promise<Paginated<UserView>> {
    return this.users.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.user.create)
  @ApiOperation({
    summary:
      'Create a user with an admin-set initial password (forced change at first login).',
  })
  create(
    @Body() dto: CreateUserDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    return this.users.create(dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.user.view)
  @ApiOperation({ summary: 'User detail including roles and branch access.' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<UserView> {
    return this.users.getById(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.user.update)
  @ApiOperation({ summary: 'Edit profile fields (email, display name).' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    return this.users.update(id, dto, auditContextFrom(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.user.activate)
  @ApiOperation({ summary: 'Re-enable login for a deactivated user.' })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    return this.users.activate(id, auditContextFrom(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.user.deactivate)
  @ApiOperation({
    summary: 'Disable login and revoke every active session (no hard delete).',
  })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    return this.users.deactivate(id, auditContextFrom(req));
  }

  @Put(':id/roles')
  @RequirePermissions(PERMISSIONS.user.manageRoles)
  @ApiOperation({ summary: 'Replace the user’s role assignment (audited).' })
  setRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRolesDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    return this.users.setRoles(id, dto.roleIds, auditContextFrom(req));
  }

  @Put(':id/branch-access')
  @RequirePermissions(PERMISSIONS.user.manageBranchAccess)
  @ApiOperation({ summary: 'Replace the user’s branch access (audited).' })
  setBranchAccess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetBranchAccessDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    return this.users.setBranchAccess(id, dto.branchIds, auditContextFrom(req));
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.user.resetPassword)
  @ApiOperation({
    summary:
      'Admin password reset: forces change at next login, revokes all sessions.',
  })
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{ message: string }> {
    return this.users.resetPassword(id, dto.newPassword, auditContextFrom(req));
  }
}
