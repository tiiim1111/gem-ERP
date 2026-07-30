import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types/auth-request';
import { QueryLotsDto } from './dto/query-reads.dto';
import { LotDetailView, LotsService, LotView } from './lots.service';

@ApiTags('lots')
@ApiCookieAuth()
@Controller('lots')
export class LotsController {
  constructor(private readonly lots: LotsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({
    summary:
      'List lots (filters: itemId, warehouseId, expiresBefore, expiringWithinDays, isActive). ?fefo=true orders earliest expiry first — the FEFO pick suggestion.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLotsDto,
  ): Promise<Paginated<LotView>> {
    return this.lots.list(user, query);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({ summary: 'Lot detail with balances and movement history.' })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<LotDetailView> {
    return this.lots.getById(user, id);
  }
}
