import { Module } from '@nestjs/common';
import { AssetLifecycleService } from './asset-lifecycle.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { EmployeeAssetsController } from './employee-assets.controller';
import { EmployeeAssetsService } from './employee-assets.service';
import { LabelService } from './label.service';

/**
 * Phase 3 serialized assets: registration + tags/scan tokens, the lifecycle
 * state machine, custody (assign/acknowledge/return/transfer), incidents,
 * retirement/disposal, labels, and the employee custody sub-resources.
 * Cross-cutting services (Prisma, RBAC, audit, sequences, config) are global.
 */
@Module({
  controllers: [AssetsController, EmployeeAssetsController],
  providers: [
    AssetsService,
    AssetLifecycleService,
    LabelService,
    EmployeeAssetsService,
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
