import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Phase 7 dashboard + operational reports (api-outline §8):
 * GET /dashboard/summary, GET /reports (catalog), and the 16 report
 * endpoints (GET /reports/:key), all driven by the shared @gemerp/reports
 * registry — the same definitions the worker uses for background exports.
 *
 * Wire THIS module into AppModule (cross-cutting Prisma/RBAC/Audit modules
 * are global). ExportsModule and PrintablesModule are separate siblings.
 */
@Module({
  controllers: [DashboardController, ReportsController],
  providers: [DashboardService, ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
