import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

/**
 * Phase 4 suppliers: global supplier master (CRUD, activate/deactivate,
 * soft archive — never delete), contact people, SUPPLIER_CATEGORY lookup
 * categories, and the purchase & delivery history rollup.
 * Cross-cutting services (Prisma, RBAC, audit, sequences) are global.
 */
@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
