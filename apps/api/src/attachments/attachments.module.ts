import { Module } from '@nestjs/common';
import { AttachmentStorageService } from './attachment-storage.service';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

/**
 * Phase 3.5 generic attachments (api-outline §4.6, spec §23): polymorphic
 * file attachments for assets, items, employees, suppliers, purchase orders,
 * goods receipts, work orders, transfers, assignments, and stock
 * transactions. Metadata in Postgres, bytes in MinIO/S3 (S3_ENABLED=false
 * degrades to clean 503s). Cross-cutting services (Prisma, RBAC, audit) are
 * global. Wire THIS module into AppModule.
 */
@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, AttachmentStorageService],
  exports: [AttachmentsService, AttachmentStorageService],
})
export class AttachmentsModule {}
