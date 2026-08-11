import { Module } from '@nestjs/common';
import { PrintablesController } from './printables.controller';
import { PrintablesService } from './printables.service';

/**
 * Phase 7 printable documents (api-outline §8): PDF renders of the six key
 * forms — purchase order, receiving report, transfer document, asset
 * acknowledgment form, maintenance work order, and inventory count sheet.
 * Routes live under the parent resources' paths but are owned here so the
 * existing procurement/transfers/assets/maintenance/counts modules stay
 * untouched.
 *
 * Wire THIS module into AppModule.
 */
@Module({
  controllers: [PrintablesController],
  providers: [PrintablesService],
})
export class PrintablesModule {}
