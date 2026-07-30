import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types/auth-request';
import {
  QueryLowStockDto,
  QueryStockBalancesDto,
  QueryStockLedgerDto,
} from './dto/query-reads.dto';
import {
  ItemStockRollupView,
  LowStockRowView,
  StockBalanceView,
  StockLedgerEntryView,
  StockReadsService,
} from './stock-reads.service';

/**
 * Read-only stock projections (api-outline 4.2). Routes live at the API root
 * (/stock-balances, /stock-ledger, /stock-alerts/low-stock, /items/:id/stock)
 * so the controller carries no path prefix.
 */
@ApiTags('inventory')
@ApiCookieAuth()
@Controller()
export class StockReadsController {
  constructor(private readonly reads: StockReadsService) {}

  @Get('stock-balances')
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({
    summary:
      'Stock balances by branch/warehouse/location/item/lot: on-hand, available, reserved (0 until Phase 6), in-transit.',
  })
  balances(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryStockBalancesDto,
  ): Promise<Paginated<StockBalanceView>> {
    return this.reads.listBalances(user, query);
  }

  @Get('stock-ledger')
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({
    summary:
      'Immutable stock ledger — the append-only source of truth (filters: itemId, warehouseId, branchId, lotId, type, from, to).',
  })
  ledger(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryStockLedgerDto,
  ): Promise<Paginated<StockLedgerEntryView>> {
    return this.reads.listLedger(user, query);
  }

  @Get('stock-alerts/low-stock')
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({
    summary:
      'Items whose available stock is below the per-warehouse reorder level, with a reorder quantity suggestion.',
  })
  lowStock(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryLowStockDto,
  ): Promise<Paginated<LowStockRowView>> {
    return this.reads.lowStock(user, query);
  }

  @Get('items/:id/stock')
  @RequirePermissions(PERMISSIONS.inventory.view)
  @ApiOperation({
    summary: "Per-item balance rollup across the caller's accessible warehouses.",
  })
  itemStock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ItemStockRollupView> {
    return this.reads.itemStock(user, id);
  }
}
