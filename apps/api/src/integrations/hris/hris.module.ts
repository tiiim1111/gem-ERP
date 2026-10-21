import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { HrisAdminService } from './hris-admin.service';
import { HrisClientService } from './hris-client.service';
import { HrisController } from './hris.controller';
import { HrisSyncScheduler } from './hris-sync.scheduler';
import { HrisSyncService } from './hris-sync.service';

/**
 * HRIS employee feed consumer (docs/hris-employee-api-phase2-decisions.md).
 *
 * The engine lives here rather than in the worker because this is where the
 * test tooling is, and the reconciliation is the part that most needs tests.
 * The worker's nightly BullMQ job and the admin UI both only queue a run row;
 * HrisSyncScheduler drains the queue so every trigger takes one path.
 *
 * Wire THIS module into AppModule.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [HrisController],
  providers: [HrisClientService, HrisSyncService, HrisAdminService, HrisSyncScheduler],
  exports: [HrisSyncService],
})
export class HrisModule {}
