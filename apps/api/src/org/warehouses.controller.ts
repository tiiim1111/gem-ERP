import {
  Body,
  Controller,
  Get,
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
import type { StorageLocation, Warehouse } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { StorageLocationQueryDto } from './dto/org-query.dto';
import { CreateStorageLocationDto } from './dto/storage-location.dto';
import { UpdateWarehouseDto } from './dto/warehouse.dto';
import { StorageLocationsService } from './storage-locations.service';
import { WarehousesService } from './warehouses.service';

@ApiTags('org')
@ApiCookieAuth()
@Controller('warehouses')
export class WarehousesController {
  constructor(
    private readonly warehouses: WarehousesService,
    private readonly locations: StorageLocationsService,
  ) {}

  @Get(':id')
  @RequirePermissions(PERMISSIONS.warehouse.view)
  @ApiOperation({ summary: 'Warehouse detail (404 when out of scope).' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Warehouse> {
    return this.warehouses.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.warehouse.update)
  @ApiOperation({
    summary:
      'Edit warehouse (name, description, active flag, default locations).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<Warehouse> {
    return this.warehouses.update(user, id, dto, auditContextFrom(req));
  }

  @Get(':warehouseId/storage-locations')
  @RequirePermissions(PERMISSIONS.storageLocation.view)
  @ApiOperation({
    summary:
      'List storage locations of a warehouse (flat list with parentId for tree building).',
  })
  listLocations(
    @CurrentUser() user: AuthUser,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Query() query: StorageLocationQueryDto,
  ): Promise<Paginated<StorageLocation>> {
    return this.locations.listForWarehouse(user, warehouseId, query);
  }

  @Post(':warehouseId/storage-locations')
  @RequirePermissions(PERMISSIONS.storageLocation.create)
  @ApiOperation({
    summary:
      'Create a storage location (supports parent-child nesting; BIN barcode auto-generated).',
  })
  createLocation(
    @CurrentUser() user: AuthUser,
    @Param('warehouseId', ParseUUIDPipe) warehouseId: string,
    @Body() dto: CreateStorageLocationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StorageLocation> {
    return this.locations.create(user, warehouseId, dto, auditContextFrom(req));
  }
}
