import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { GoodsReceiptPostingService } from './goods-receipt-posting.service';
import { GoodsReceiptsController } from './goods-receipts.controller';
import { GoodsReceiptsService } from './goods-receipts.service';

/**
 * Phase 4 goods receipts: receive against approved POs — drafts capture
 * quantities/serials/lots, posting materializes stock (via the Phase 3
 * StockPostingService), serialized assets, and lot records in one
 * transaction, and rolls the PO status forward.
 */
@Module({
  imports: [InventoryModule],
  controllers: [GoodsReceiptsController],
  providers: [GoodsReceiptsService, GoodsReceiptPostingService],
  exports: [GoodsReceiptsService],
})
export class GoodsReceiptsModule {}
