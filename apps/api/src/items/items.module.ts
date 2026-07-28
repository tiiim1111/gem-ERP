import { Module } from '@nestjs/common';
import { ItemBarcodesService } from './item-barcodes.service';
import { ItemWarehouseSettingsService } from './item-warehouse-settings.service';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  controllers: [ItemsController],
  providers: [ItemsService, ItemBarcodesService, ItemWarehouseSettingsService],
  exports: [ItemsService, ItemBarcodesService],
})
export class ItemsModule {}
