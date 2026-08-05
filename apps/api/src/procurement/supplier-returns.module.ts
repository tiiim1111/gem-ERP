import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SupplierReturnsController } from './supplier-returns.controller';
import { SupplierReturnsService } from './supplier-returns.service';

/**
 * Phase 4 supplier returns: return-to-supplier documents referencing
 * received stock; posting creates a linked RETURN_TO_SUPPLIER stock
 * transaction through the shared posting engine.
 */
@Module({
  imports: [InventoryModule],
  controllers: [SupplierReturnsController],
  providers: [SupplierReturnsService],
  exports: [SupplierReturnsService],
})
export class SupplierReturnsModule {}
