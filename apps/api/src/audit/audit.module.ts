import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Global: AuditService is a cross-cutting dependency of every module that
 * mutates data. The audit trail itself is append-only — this module exposes
 * only the read/search endpoint.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
