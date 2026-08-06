import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { LotsController } from './lots.controller';
import { LotsService } from './lots.service';
import { StockPostingService } from './stock-posting.service';
import { StockReadsController } from './stock-reads.controller';
import { StockReadsService } from './stock-reads.service';
import { StockTransactionsController } from './stock-transactions.controller';
import { StockTransactionsService } from './stock-transactions.service';

/**
 * Phase 3 inventory core: stock transaction documents, the posting engine
 * (immutable ledger + guarded balance projections), and the read-side
 * projections (balances, ledger, lots, low stock). Phase 6 wires the
 * approval engine into submit/approve/reject.
 */
@Module({
  imports: [ApprovalsModule],
  controllers: [StockTransactionsController, StockReadsController, LotsController],
  providers: [
    StockTransactionsService,
    StockPostingService,
    StockReadsService,
    LotsService,
  ],
  exports: [StockTransactionsService, StockPostingService],
})
export class InventoryModule {}
