import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import {
  auditContextFrom,
  AuthenticatedRequest,
  AuthUser,
} from '../common/types/auth-request';
import {
  AssignWorkOrderDto,
  CancelWorkOrderDto,
  CompleteWorkOrderDto,
  CompleteWorkOrderTaskDto,
  CreatePartsIssueDto,
  CreateWorkOrderDto,
  HoldWorkOrderDto,
  QueryWorkOrdersDto,
  ReplaceWorkOrderTasksDto,
  ResumeWorkOrderDto,
  ScheduleWorkOrderDto,
  UpdateWorkOrderDto,
  VerifyWorkOrderDto,
} from './dto/work-order.dto';
import {
  WorkOrderDetailView,
  WorkOrderPartView,
  WorkOrderView,
} from './maintenance-views';
import { WorkOrderPartsService } from './work-order-parts.service';
import { WorkOrdersService } from './work-orders.service';

/**
 * Maintenance work orders (api-outline 6.2, status-transitions §5).
 *
 * Permission mapping onto the @gemerp/shared catalog (which has granular
 * strings instead of the contract's single "manage"): create →
 * maintenance.work_order.create, PATCH → .update, manager actions
 * (assign/schedule/cancel) → .manage, verify → .verify. Execution actions
 * (start/hold/resume/complete/task tick-off) declare .view at the route and
 * enforce "manage OR the assigned technician" in the service — exactly the
 * contract's "manage or assigned technician" rule.
 */
@ApiTags('maintenance-work-orders')
@ApiCookieAuth()
@Controller('maintenance-work-orders')
export class WorkOrdersController {
  constructor(
    private readonly workOrders: WorkOrdersService,
    private readonly parts: WorkOrderPartsService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary:
      'List WOs (filters: status, typeId, priorityId, assetId, branchId, assignedToMe, dueBefore, from, to, number). view-only technicians see their own WOs; manage sees branch-wide. Cost fields need maintenance.work_order.view_cost.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryWorkOrdersDto,
  ): Promise<Paginated<WorkOrderView>> {
    return this.workOrders.list(user, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.create)
  @ApiOperation({
    summary:
      'Create a WO {assetId, typeId, priorityId?, problem, reportedById?, planId?} — number WO-{YYYY}-{SEQ5}; lands on OPEN.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.create(user, dto, auditContextFrom(req));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary: 'WO detail: checklist, diagnosis, parts, costs, downtime.',
  })
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.getById(user, id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.update)
  @ApiOperation({
    summary: 'Edit open fields (requires version) — never the status.',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.update(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.manage)
  @ApiOperation({
    summary:
      'Designate technician (user/employee), team, and/or vendor → Assigned (a Scheduled WO keeps its schedule).',
  })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.assign(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/schedule')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.manage)
  @ApiOperation({ summary: '{plannedStart, plannedEnd} → Scheduled.' })
  schedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScheduleWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.schedule(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary:
      '→ In Progress; the asset fires send-to-maintenance → Under Maintenance (blocked for In Transfer/Lost/Retired/Disposed). Manage or assigned technician.',
  })
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.start(user, id, auditContextFrom(req));
  }

  @Post(':id/hold')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary:
      '{reason: "On Hold"|"Awaiting Parts"|"Awaiting Vendor"} → the matching waiting status. Manage or assigned technician.',
  })
  hold(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.hold(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary:
      'Resume from On Hold / Awaiting Parts / Awaiting Vendor → In Progress. Manage or assigned technician.',
  })
  resume(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResumeWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.resume(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary:
      '→ Completed with explicit asset outcome (AVAILABLE|ASSIGNED|DAMAGED|RETIRED; Assigned needs the pre-WO assignment still active, Retired needs asset.retire + reason). Records resolution, final condition, costs, downtime, next maintenance date. Manage or assigned technician.',
  })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.complete(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.verify)
  @ApiOperation({
    summary:
      'Supervisor sign-off → Verified (verifier ≠ the completer; closes the WO for edits).',
  })
  verify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.verify(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.manage)
  @ApiOperation({
    summary:
      '{reason} → Canceled. Posted parts issues must be reversed first; the asset reverts to its pre-WO status.',
  })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelWorkOrderDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.cancel(user, id, dto, auditContextFrom(req));
  }

  @Put(':id/tasks')
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary:
      'Replace the checklist wholesale (before execution). Manage or assigned technician.',
  })
  replaceTasks(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceWorkOrderTasksDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.replaceTasks(user, id, dto, auditContextFrom(req));
  }

  @Post(':id/tasks/:taskId/complete')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary: 'Tick off one checklist task. Manage or assigned technician.',
  })
  completeTask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: CompleteWorkOrderTaskDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderDetailView> {
    return this.workOrders.completeTask(
      user,
      id,
      taskId,
      dto,
      auditContextFrom(req),
    );
  }

  @Get(':id/parts-issues')
  @RequirePermissions(PERMISSIONS.maintenanceWorkOrder.view)
  @ApiOperation({
    summary:
      'Parts consumed by this WO (each row is backed by a posted MAINTENANCE_ISSUE stock transaction).',
  })
  listParts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkOrderPartView[]> {
    return this.parts.list(user, id);
  }

  @Post(':id/parts-issues')
  @RequirePermissions(PERMISSIONS.inventory.issue)
  @ApiOperation({
    summary:
      'Issue parts to the WO: creates AND posts a MAINTENANCE_ISSUE stock transaction through the shared posting engine in one DB transaction (INSUFFICIENT_STOCK/LOT_EXPIRED roll everything back); costs roll into the WO. Optional Idempotency-Key for safe retries.',
  })
  createParts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePartsIssueDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: AuthenticatedRequest,
  ): Promise<WorkOrderPartView[]> {
    return this.parts.create(user, id, dto, idempotencyKey, auditContextFrom(req));
  }
}
