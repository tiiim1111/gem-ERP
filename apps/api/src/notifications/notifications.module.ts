import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Phase 6 in-app notifications (spec §20, api-outline 7.3): self-scoped
 * read/unread endpoints plus the channel-ready NotificationsService other
 * modules (approval engine) emit through. External channels (email/SMS)
 * are on hold per GemCor — the service interface is ready for them.
 *
 * Wire THIS module into AppModule.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
