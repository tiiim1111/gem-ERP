import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module';
import { ScanController } from './scan.controller';
import { ScanService } from './scan.service';

/**
 * Phase 3 scanning: opaque QR token resolution and the shared raw-code
 * resolution pipeline (docs/barcode-strategy.md §6.3). Item/lot/bin families
 * delegate to the catalog resolver exported by ItemsModule.
 */
@Module({
  imports: [ItemsModule],
  controllers: [ScanController],
  providers: [ScanService],
  exports: [ScanService],
})
export class ScanModule {}
