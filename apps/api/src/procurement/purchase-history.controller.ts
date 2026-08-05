import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types/auth-request';
import { QueryPurchaseHistoryDto } from './dto/query-purchase-history.dto';
import {
  PurchaseHistoryRow,
  PurchaseHistoryService,
} from './purchase-history.service';

@ApiTags('purchase-history')
@ApiCookieAuth()
@Controller('purchase-history')
export class PurchaseHistoryController {
  constructor(private readonly history: PurchaseHistoryService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.procurementPo.view)
  @ApiOperation({
    summary:
      'PO-line-grained purchase history: filters supplierId, itemId, branchId, warehouseId, purchaseOrderId, number, receiptNumber, status, from, to. Reports ordered/received/outstanding/canceled/returned quantities; costs need procurement.po.view_cost.',
  })
  search(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryPurchaseHistoryDto,
  ): Promise<Paginated<PurchaseHistoryRow>> {
    return this.history.search(user, query);
  }
}
