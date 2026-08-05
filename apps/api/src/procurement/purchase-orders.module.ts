import { Module } from '@nestjs/common';
import { GoodsReceiptsModule } from './goods-receipts.module';
import { PurchaseHistoryController } from './purchase-history.controller';
import { PurchaseHistoryService } from './purchase-history.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Phase 4 purchase orders: PO-{YYYY}-{SEQ5} numbered drafts with
 * server-side Decimal totals, the Draft → Pending Approval → Approved →
 * Partially/Fully Received → Closed machine (auto-approval while the
 * Phase 6 engine is absent), plus the purchase-history search.
 */
@Module({
  imports: [GoodsReceiptsModule],
  controllers: [PurchaseOrdersController, PurchaseHistoryController],
  providers: [PurchaseOrdersService, PurchaseHistoryService],
  exports: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
