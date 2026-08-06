import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ItemsModule } from '../items/items.module';
import { CountAdjustmentsService } from './count-adjustments.service';
import { CountSessionsController } from './count-sessions.controller';
import { CountSessionsService } from './count-sessions.service';

/**
 * Phase 6 physical inventory & cycle counts (spec §17, api-outline 7.1):
 * scoped sessions, an atomic expected-balance snapshot at start, blind and
 * barcode-assisted counting, recounts, variance reporting, and
 * create-adjustments — DRAFT adjustment stock transactions generated
 * through the EXISTING StockTransactionsService (counts never write
 * balances).
 *
 * Wire THIS module into AppModule. ItemsModule supplies the barcode
 * resolver for rapid scans; InventoryModule supplies the stock-transaction
 * machinery the generated adjustments flow through.
 */
@Module({
  imports: [InventoryModule, ItemsModule],
  controllers: [CountSessionsController],
  providers: [CountSessionsService, CountAdjustmentsService],
  exports: [CountSessionsService],
})
export class CountsModule {}
