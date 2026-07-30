import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

/**
 * Phase 3 transfer documents (spec §16): intra-branch moves and the
 * controlled inter-branch dispatch/receive flow. All stock effects run
 * through the InventoryModule posting engine.
 */
@Module({
  imports: [InventoryModule],
  controllers: [TransfersController],
  providers: [TransfersService],
  exports: [TransfersService],
})
export class TransfersModule {}
