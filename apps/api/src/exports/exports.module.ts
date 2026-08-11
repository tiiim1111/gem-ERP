import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

/**
 * Phase 7 background exports (api-outline §8): POST /exports enqueues a
 * permission-verified job; GET /exports(/:id) are owner-scoped; the download
 * streams from object storage through the API (bucket never public — same
 * AttachmentStorageService the attachments module uses, S3_ENABLED=false
 * degrades to clean 503s). Processing happens in apps/worker's
 * report-exports queue using the same @gemerp/reports registry.
 *
 * Wire THIS module into AppModule.
 */
@Module({
  imports: [AttachmentsModule],
  controllers: [ExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
