import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import type { Branch, Warehouse } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { BranchesService } from './branches.service';
import { WarehousesService } from './warehouses.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { OrgQueryDto } from './dto/org-query.dto';
import { CreateWarehouseDto } from './dto/warehouse.dto';

@ApiTags('org')
@ApiCookieAuth()
@Controller('branches')
export class BranchesController {
  constructor(
    private readonly branches: BranchesService,
    private readonly warehouses: WarehousesService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.branch.view)
  @ApiOperation({
    summary: 'List branches (non-super-admins see accessible branches only).',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: OrgQueryDto,
  ): Promise<Paginated<Branch>> {
    return this.branches.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.branch.create)
  @ApiOperation({ summary: 'Create a branch (code is unique and immutable).' })
  create(
    @Body() dto: CreateBranchDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Branch> {
    return this.branches.create(dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.branch.view)
  @ApiOperation({ summary: 'Branch detail (404 when out of scope).' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Branch> {
    return this.branches.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.branch.update)
  @ApiOperation({ summary: 'Edit branch fields (code is immutable).' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Branch> {
    return this.branches.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.branch.activate)
  @ApiOperation({ summary: 'Reactivate a branch.' })
  activate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Branch> {
    return this.branches.setActive(user, id, true, auditContextFrom(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.branch.deactivate)
  @ApiOperation({ summary: 'Deactivate a branch (history preserved, no delete).' })
  deactivate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<Branch> {
    return this.branches.setActive(user, id, false, auditContextFrom(req));
  }

  @Get(':branchId/warehouses')
  @RequirePermissions(PERMISSIONS.warehouse.view)
  @ApiOperation({
    summary: 'List warehouses of a branch (403 when the branch is out of scope).',
  })
  listWarehouses(
    @CurrentUser() user: AuthUser,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: OrgQueryDto,
  ): Promise<Paginated<Warehouse>> {
    return this.warehouses.listForBranch(user, branchId, query);
  }

  @Post(':branchId/warehouses')
  @RequirePermissions(PERMISSIONS.warehouse.create)
  @ApiOperation({ summary: 'Create a warehouse in a branch (code unique per branch).' })
  createWarehouse(
    @CurrentUser() user: AuthUser,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: CreateWarehouseDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Warehouse> {
    return this.warehouses.create(user, branchId, dto, auditContextFrom(req));
  }
}
