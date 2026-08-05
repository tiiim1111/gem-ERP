import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import {
  CreateMeterReadingDto,
  QueryMeterReadingsDto,
} from './dto/meter-reading.dto';
import { MeterReadingView } from './maintenance-views';
import { MeterReadingsService } from './meter-readings.service';

/**
 * Usage-meter history per asset (api-outline 6.2: /assets/:id/meter-readings
 * — asset-scoped routes owned by the maintenance module; the assets module
 * is untouched). Readings drive meter-interval maintenance plans.
 */
@ApiTags('assets')
@ApiCookieAuth()
@Controller('assets')
export class MeterReadingsController {
  constructor(private readonly readings: MeterReadingsService) {}

  @Get(':id/meter-readings')
  @RequirePermissions(PERMISSIONS.asset.view)
  @ApiOperation({
    summary: 'Meter history (filters: meterType, from, to).',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QueryMeterReadingsDto,
  ): Promise<Paginated<MeterReadingView>> {
    return this.readings.list(user, id, query);
  }

  @Post(':id/meter-readings')
  @RequirePermissions(PERMISSIONS.asset.update)
  @ApiOperation({
    summary:
      'Record a reading {readingValue, meterType?, readingAt?, notes?} — monotonic per (asset, meterType).',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateMeterReadingDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<MeterReadingView> {
    return this.readings.create(user, id, dto, auditContextFrom(req));
  }
}
