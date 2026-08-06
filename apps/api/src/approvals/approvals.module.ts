import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApprovalDelegationsController } from './approval-delegations.controller';
import { ApprovalDelegationsService } from './approval-delegations.service';
import { ApprovalDocumentsService } from './approval-documents.service';
import { ApprovalEngineService } from './approval-engine.service';
import { ApprovalRequestsController } from './approval-requests.controller';
import { ApprovalRequestsService } from './approval-requests.service';
import { ApprovalWorkflowsController } from './approval-workflows.controller';
import { ApprovalWorkflowsService } from './approval-workflows.service';
import { ApproverResolutionService } from './approver-resolution.service';

/**
 * Phase 6 configurable approval framework (spec §19, api-outline 7.2):
 * workflow configuration (branch scope, amount/quantity thresholds, ordered
 * steps with parameterized approver resolution — ROLE | POSITION |
 * DEPT_HEAD | USER, the core GemCor requirement), the request inbox with
 * delegation-aware assignedToMe, decisions with full history, and
 * time-windowed delegations.
 *
 * Wire THIS module into AppModule. Document modules (inventory, transfers,
 * procurement) import it for ApprovalEngineService — the engine executes
 * finalized document transitions itself via ApprovalDocumentsService (plain
 * Prisma), so no dependency cycles exist.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    ApprovalWorkflowsController,
    ApprovalRequestsController,
    ApprovalDelegationsController,
  ],
  providers: [
    ApprovalEngineService,
    ApprovalDocumentsService,
    ApprovalWorkflowsService,
    ApprovalRequestsService,
    ApprovalDelegationsService,
    ApproverResolutionService,
  ],
  exports: [ApprovalEngineService],
})
export class ApprovalsModule {}
