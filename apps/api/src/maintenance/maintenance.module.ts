import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { MaintenancePlansController } from './maintenance-plans.controller';
import { MaintenancePlansService } from './maintenance-plans.service';
import { MeterReadingsController } from './meter-readings.controller';
import { MeterReadingsService } from './meter-readings.service';
import { WorkOrderPartsService } from './work-order-parts.service';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';

/**
 * Phase 5 maintenance aggregate (spec §18, api-outline §6): preventive
 * maintenance plans (frequency, checklist, covered assets), work orders
 * (full status lifecycle with asset Under-Maintenance integration), parts
 * consumption through the shared inventory posting engine, and asset meter
 * readings. Wire THIS module into AppModule — everything comes along.
 *
 * InventoryModule is imported ONLY for its exported StockPostingService
 * (parts issues post through the one true ledger engine). Asset lifecycle
 * validation reuses the assets module's pure state machine
 * (asset-status-machine.ts). Cross-cutting services (Prisma, RBAC, audit,
 * sequences) are global.
 */
@Module({
  imports: [InventoryModule],
  controllers: [
    MaintenancePlansController,
    WorkOrdersController,
    MeterReadingsController,
  ],
  providers: [
    MaintenancePlansService,
    WorkOrdersService,
    WorkOrderPartsService,
    MeterReadingsService,
  ],
  exports: [WorkOrdersService],
})
export class MaintenanceModule {}
