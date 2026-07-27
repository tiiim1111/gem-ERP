import {
  Body,
  Controller,
  Get,
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
import { CreateRoleDto } from './dto/create-role.dto';
import { QueryRolesDto } from './dto/query-roles.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RoleDetailView, RolesService, RoleView } from './roles.service';

@ApiTags('roles')
@ApiCookieAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.role.view)
  @ApiOperation({ summary: 'List roles with permission counts.' })
  list(@Query() query: QueryRolesDto): Promise<Paginated<RoleView>> {
    return this.roles.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.role.create)
  @ApiOperation({ summary: 'Create a custom role.' })
  create(
    @Body() dto: CreateRoleDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RoleDetailView> {
    return this.roles.create(dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.role.view)
  @ApiOperation({ summary: 'Role detail including the full permission list.' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<RoleDetailView> {
    return this.roles.getById(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.role.update)
  @ApiOperation({
    summary: 'Edit name/description/active flag (system roles are immutable).',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RoleDetailView> {
    return this.roles.update(id, dto, auditContextFrom(req));
  }

  @Put(':id/permissions')
  @RequirePermissions(PERMISSIONS.role.managePermissions)
  @ApiOperation({
    summary:
      'Replace the role’s permission set (validated against the catalog; audited).',
  })
  setPermissions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetRolePermissionsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<RoleDetailView> {
    return this.roles.setPermissions(id, dto.permissions, auditContextFrom(req));
  }
}
