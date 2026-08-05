import { Module } from '@nestjs/common';
import { GoodsReceiptsModule } from './goods-receipts.module';
import { PurchaseOrdersModule } from './purchase-orders.module';
import { SupplierReturnsModule } from './supplier-returns.module';
import { SuppliersModule } from './suppliers.module';

/**
 * Phase 4 procurement aggregate (spec §14, api-outline §5): suppliers,
 * purchase orders (+ purchase history), goods receipts, and supplier
 * returns. Wire THIS module into AppModule — the sub-modules come along.
 */
@Module({
  imports: [
    SuppliersModule,
    PurchaseOrdersModule,
    GoodsReceiptsModule,
    SupplierReturnsModule,
  ],
})
export class ProcurementModule {}
