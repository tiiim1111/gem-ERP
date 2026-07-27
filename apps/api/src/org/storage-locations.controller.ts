import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@gemerp/shared';
import type { StorageLocation } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import { UpdateStorageLocationDto } from './dto/storage-location.dto';
import { StorageLocationsService } from './storage-locations.service';

@ApiTags('org')
@ApiCookieAuth()
@Controller('storage-locations')
export class StorageLocationsController {
  constructor(private readonly locations: StorageLocationsService) {}

  @Get(':id')
  @RequirePermissions(PERMISSIONS.storageLocation.view)
  @ApiOperation({ summary: 'Storage location detail (404 when out of scope).' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StorageLocation> {
    return this.locations.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.storageLocation.update)
  @ApiOperation({
    summary: 'Edit storage location (re-parenting is cycle-checked).',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStorageLocationDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<StorageLocation> {
    return this.locations.update(user, id, dto, auditContextFrom(req));
  }
}
