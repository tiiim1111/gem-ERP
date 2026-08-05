import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import {
  AssetAssignmentStatus,
  AssetLifecycleStatus,
  MaintenanceWorkOrderStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { assertTransition } from '../assets/asset-status-machine';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  formatWorkOrderNumber,
  workOrderSequenceKey,
} from './maintenance-numbers';
import {
  computeDowntimeMinutes,
  downtimeHoursFromMinutes,
  nextDueAfterCompletion,
} from './maintenance-schedule';
import {
  canTransitionWo,
  computeWorkOrderTotalCost,
  holdTargetStatus,
  OPEN_WO_STATUSES,
  woTransitionError,
} from './work-order-rules';
import {
  canViewMaintenanceCost,
  toWorkOrderDetailView,
  toWorkOrderView,
  WO_DETAIL_SELECT,
  WO_LIST_SELECT,
  WorkOrderDetailView,
  WorkOrderView,
} from './maintenance-views';
import {
  AssignWorkOrderDto,
  CancelWorkOrderDto,
  CompleteWorkOrderDto,
  CompleteWorkOrderTaskDto,
  CreateWorkOrderDto,
  HoldWorkOrderDto,
  QueryWorkOrdersDto,
  ReplaceWorkOrderTasksDto,
  ResumeWorkOrderDto,
  ScheduleWorkOrderDto,
  UpdateWorkOrderDto,
  VerifyWorkOrderDto,
} from './dto/work-order.dto';

const S = MaintenanceWorkOrderStatus;

const SORTABLE = {
  workOrderNumber: 'workOrderNumber',
  status: 'status',
  scheduledStartAt: 'scheduledStartAt',
  createdAt: 'createdAt',
};

const OPEN_ASSIGNMENT_STATUSES: AssetAssignmentStatus[] = [
  AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
  AssetAssignmentStatus.ACTIVE,
];

/** Head row every action loads before mutating. */
const WO_HEAD_SELECT = {
  id: true,
  workOrderNumber: true,
  status: true,
  branchId: true,
  assetId: true,
  planId: true,
  createdById: true,
  completedById: true,
  assignedVendorId: true,
  assignedToEmployee: { select: { id: true, userId: true } },
  actualStartAt: true,
  assetStatusBeforeWo: true,
  laborCost: true,
  partsCost: true,
  externalCost: true,
  version: true,
} satisfies Prisma.MaintenanceWorkOrderSelect;

type WoHead = Prisma.MaintenanceWorkOrderGetPayload<{
  select: typeof WO_HEAD_SELECT;
}>;

/**
 * Maintenance work orders (spec §18, api-outline 6.2,
 * docs/status-transitions.md §5). The status machine lives in
 * work-order-rules.ts; asset lifecycle effects go through the assets state
 * machine (asset-status-machine.ts — single source of truth):
 *
 *  - start    → asset fires `send-to-maintenance` (→ Under Maintenance);
 *               the pre-WO status is snapshotted for cancellation.
 *  - complete → asset fires `maintenance-complete` with the EXPLICIT outcome
 *               (Available | Assigned | Damaged | Retired; guards below).
 *  - cancel   → asset reverts to its pre-WO status (work-order-canceled).
 *
 * Visibility (contract §6.2): maintenance.work_order.manage sees branch-wide;
 * technicians holding only maintenance.work_order.view see the WOs assigned
 * to them. Execution actions (start/hold/resume/complete/tick-off) allow
 * "manage OR the assigned technician".
 */
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    user: AuthUser,
    query: QueryWorkOrdersDto,
  ): Promise<Paginated<WorkOrderView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });

    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }
    const where: Prisma.MaintenanceWorkOrderWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
    };
    if (!this.canManage(user) || query.assignedToMe) {
      // Technician scoping: view-only callers are hard-limited to their own
      // WOs; assignedToMe applies the same filter voluntarily for managers.
      where.assignedToEmployee = { userId: user.id };
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.typeId) {
      where.typeId = query.typeId;
    }
    if (query.priorityId) {
      where.priorityId = query.priorityId;
    }
    if (query.assetId) {
      where.assetId = query.assetId;
    }
    if (query.number) {
      where.workOrderNumber = { contains: query.number, mode: 'insensitive' };
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.dueBefore) {
      const dueBefore = new Date(query.dueBefore);
      where.status = query.status ?? { in: [...OPEN_WO_STATUSES] };
      where.OR = [
        { scheduledEndAt: { lte: dueBefore } },
        { scheduledEndAt: null, scheduledStartAt: { lte: dueBefore } },
      ];
    }

    const includeCost = canViewMaintenanceCost(user);
    const [rows, total] = await Promise.all([
      this.prisma.maintenanceWorkOrder.findMany({
        where,
        orderBy,
        skip,
        take,
        select: WO_LIST_SELECT,
      }),
      this.prisma.maintenanceWorkOrder.count({ where }),
    ]);
    return paginated(
      rows.map((row) => toWorkOrderView(row, includeCost)),
      page,
      pageSize,
      total,
    );
  }

  async getById(user: AuthUser, id: string): Promise<WorkOrderDetailView> {
    await this.requireWo(user, id);
    const row = await this.prisma.maintenanceWorkOrder.findUniqueOrThrow({
      where: { id },
      select: WO_DETAIL_SELECT,
    });
    return toWorkOrderDetailView(row, canViewMaintenanceCost(user));
  }

  // -------------------------------------------------------------------------
  // Create / edit
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreateWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: dto.assetId },
      select: { id: true, assetTag: true, status: true, branchId: true, archivedAt: true },
    });
    if (
      !asset ||
      asset.archivedAt ||
      !this.branchScope.canAccess(user, asset.branchId)
    ) {
      throw AppException.notFound('Asset not found.');
    }
    // Create guard (status-transitions §5): the asset must not be terminal.
    if (
      asset.status === AssetLifecycleStatus.LOST ||
      asset.status === AssetLifecycleStatus.RETIRED ||
      asset.status === AssetLifecycleStatus.DISPOSED ||
      asset.status === AssetLifecycleStatus.DRAFT
    ) {
      throw AppException.invalidStateTransition(
        `Cannot open a work order for asset ${asset.assetTag}: it is ${asset.status}.`,
      );
    }
    await this.assertLookup(dto.typeId, 'MAINTENANCE_TYPE', 'typeId');
    if (dto.priorityId) {
      await this.assertLookup(dto.priorityId, 'MAINTENANCE_PRIORITY', 'priorityId');
    }
    if (dto.planId) {
      const plan = await this.prisma.maintenancePlan.findUnique({
        where: { id: dto.planId },
        select: { id: true, archivedAt: true },
      });
      if (!plan || plan.archivedAt) {
        throw AppException.validation([
          { field: 'planId', message: 'Maintenance plan does not exist.' },
        ]);
      }
    }
    if (dto.reportedById) {
      const reporter = await this.prisma.user.findUnique({
        where: { id: dto.reportedById },
        select: { id: true },
      });
      if (!reporter) {
        throw AppException.validation([
          { field: 'reportedById', message: 'Reporting user does not exist.' },
        ]);
      }
    }

    const now = new Date();
    const created = await this.prisma.$transaction(async (tx) => {
      const year = now.getUTCFullYear();
      const sequence = await this.sequences.next(tx, workOrderSequenceKey(year));
      return tx.maintenanceWorkOrder.create({
        data: {
          workOrderNumber: formatWorkOrderNumber(year, sequence),
          assetId: asset.id,
          planId: dto.planId ?? null,
          branchId: asset.branchId,
          typeId: dto.typeId,
          priorityId: dto.priorityId ?? null,
          // Problem/type/priority are complete at creation — the Draft→Open
          // guard — so the WO lands directly on OPEN (no `open` endpoint in
          // the contract).
          status: S.OPEN,
          problemDescription: dto.problem,
          reportedById: dto.reportedById ?? user.id,
          reportedAt: now,
          createdById: user.id,
        },
        select: { id: true, workOrderNumber: true },
      });
    });

    await this.audit.log({
      action: 'maintenance_work_order.created',
      resourceType: 'maintenance_work_order',
      resourceId: created.id,
      branchId: asset.branchId,
      newValues: {
        workOrderNumber: created.workOrderNumber,
        assetId: asset.id,
        assetTag: asset.assetTag,
        planId: dto.planId ?? null,
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    if (!canTransitionWo(wo.status, 'update')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'update'),
      );
    }
    if (dto.typeId) {
      await this.assertLookup(dto.typeId, 'MAINTENANCE_TYPE', 'typeId');
    }
    if (dto.priorityId) {
      await this.assertLookup(dto.priorityId, 'MAINTENANCE_PRIORITY', 'priorityId');
    }

    const claimed = await this.prisma.maintenanceWorkOrder.updateMany({
      where: { id, version: dto.version },
      data: {
        ...(dto.problem !== undefined
          ? { problemDescription: dto.problem }
          : {}),
        ...(dto.typeId !== undefined ? { typeId: dto.typeId } : {}),
        ...(dto.priorityId !== undefined ? { priorityId: dto.priorityId } : {}),
        ...(dto.diagnosis !== undefined ? { diagnosis: dto.diagnosis } : {}),
        ...(dto.actionTaken !== undefined
          ? { actionTaken: dto.actionTaken }
          : {}),
        ...(dto.resolution !== undefined ? { resolution: dto.resolution } : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.versionConflict();
    }

    await this.audit.log({
      action: 'maintenance_work_order.updated',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { version: dto.version },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Assign / schedule
  // -------------------------------------------------------------------------

  async assign(
    user: AuthUser,
    id: string,
    dto: AssignWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    if (!canTransitionWo(wo.status, 'assign')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'assign'),
      );
    }
    if (
      !dto.technicianUserId &&
      !dto.technicianEmployeeId &&
      !dto.team &&
      !dto.vendorId
    ) {
      throw AppException.validation([
        {
          field: 'technicianUserId',
          message:
            'Designate a technician (user or employee), a team, or a vendor.',
        },
      ]);
    }
    const employeeId = await this.resolveTechnician(dto);
    if (dto.vendorId) {
      await this.requireActiveVendor(dto.vendorId);
    }

    // Re-designating a SCHEDULED WO keeps its schedule; otherwise → ASSIGNED.
    const nextStatus = wo.status === S.SCHEDULED ? S.SCHEDULED : S.ASSIGNED;
    const claimed = await this.prisma.maintenanceWorkOrder.updateMany({
      where: { id, status: wo.status },
      data: {
        status: nextStatus,
        ...(employeeId !== undefined ? { assignedToEmployeeId: employeeId } : {}),
        ...(dto.team !== undefined ? { assignedTeam: dto.team } : {}),
        ...(dto.vendorId !== undefined ? { assignedVendorId: dto.vendorId } : {}),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The work order was modified concurrently. Refetch and retry.',
      );
    }

    await this.audit.log({
      action: 'maintenance_work_order.assigned',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { status: wo.status },
      newValues: {
        status: nextStatus,
        technicianEmployeeId: employeeId ?? null,
        team: dto.team ?? null,
        vendorId: dto.vendorId ?? null,
      },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async schedule(
    user: AuthUser,
    id: string,
    dto: ScheduleWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    if (!canTransitionWo(wo.status, 'schedule')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'schedule'),
      );
    }
    const plannedStart = new Date(dto.plannedStart);
    const plannedEnd = new Date(dto.plannedEnd);
    if (plannedEnd <= plannedStart) {
      throw AppException.validation([
        {
          field: 'plannedEnd',
          message: 'Planned end must be after the planned start.',
        },
      ]);
    }

    const claimed = await this.prisma.maintenanceWorkOrder.updateMany({
      where: { id, status: wo.status },
      data: {
        status: S.SCHEDULED,
        scheduledStartAt: plannedStart,
        scheduledEndAt: plannedEnd,
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The work order was modified concurrently. Refetch and retry.',
      );
    }

    await this.audit.log({
      action: 'maintenance_work_order.scheduled',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { status: wo.status },
      newValues: {
        status: S.SCHEDULED,
        plannedStart: dto.plannedStart,
        plannedEnd: dto.plannedEnd,
      },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Start / hold / resume
  // -------------------------------------------------------------------------

  async start(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    this.assertExecuteAllowed(user, wo);
    if (!canTransitionWo(wo.status, 'start')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'start'),
      );
    }
    const asset = await this.prisma.asset.findUniqueOrThrow({
      where: { id: wo.assetId },
      select: { id: true, assetTag: true, status: true },
    });
    // Asset machine is the single source of truth: send-to-maintenance fires
    // only from Available / Assigned / Damaged / Under Inspection — never
    // from In Transfer, Lost, Retired, Disposed (§18 guards).
    const target = assertTransition(asset.status, 'send-to-maintenance');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.maintenanceWorkOrder.updateMany({
        where: { id, status: wo.status },
        data: {
          status: S.IN_PROGRESS,
          actualStartAt: now,
          assetStatusBeforeWo: asset.status,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.invalidStateTransition(
          'The work order was modified concurrently. Refetch and retry.',
        );
      }
      const assetClaim = await tx.asset.updateMany({
        where: { id: asset.id, status: asset.status },
        data: { status: target },
      });
      if (assetClaim.count === 0) {
        throw AppException.invalidStateTransition(
          `Asset ${asset.assetTag} changed state concurrently. Refetch and retry.`,
        );
      }
      await tx.assetStatusHistory.create({
        data: {
          assetId: asset.id,
          fromStatus: asset.status,
          toStatus: target,
          changedAt: now,
          changedById: user.id,
          notes: `maintenance-start (work order ${wo.workOrderNumber})`,
        },
      });
    });

    await this.audit.log({
      action: 'maintenance_work_order.started',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { status: wo.status, assetStatus: asset.status },
      newValues: { status: S.IN_PROGRESS, assetStatus: target },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async hold(
    user: AuthUser,
    id: string,
    dto: HoldWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    this.assertExecuteAllowed(user, wo);
    if (!canTransitionWo(wo.status, 'hold')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'hold'),
      );
    }
    const target = holdTargetStatus(dto.reason);
    if (target === S.AWAITING_VENDOR && !wo.assignedVendorId) {
      throw AppException.validation([
        {
          field: 'reason',
          message:
            'Awaiting Vendor requires an assigned vendor — assign one first.',
        },
      ]);
    }

    const holdReason = dto.notes ? `${dto.reason}: ${dto.notes}` : dto.reason;
    const claimed = await this.prisma.maintenanceWorkOrder.updateMany({
      where: { id, status: wo.status },
      data: { status: target, holdReason, version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The work order was modified concurrently. Refetch and retry.',
      );
    }

    await this.audit.log({
      action: 'maintenance_work_order.held',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { status: wo.status },
      newValues: { status: target },
      reason: holdReason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  async resume(
    user: AuthUser,
    id: string,
    dto: ResumeWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    this.assertExecuteAllowed(user, wo);
    if (!canTransitionWo(wo.status, 'resume')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'resume'),
      );
    }

    const claimed = await this.prisma.maintenanceWorkOrder.updateMany({
      where: { id, status: wo.status },
      data: { status: S.IN_PROGRESS, holdReason: null, version: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The work order was modified concurrently. Refetch and retry.',
      );
    }

    await this.audit.log({
      action: 'maintenance_work_order.resumed',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { status: wo.status },
      newValues: { status: S.IN_PROGRESS, notes: dto.notes ?? null },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Complete
  // -------------------------------------------------------------------------

  async complete(
    user: AuthUser,
    id: string,
    dto: CompleteWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    this.assertExecuteAllowed(user, wo);
    if (!canTransitionWo(wo.status, 'complete')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'complete'),
      );
    }

    const outcome = dto.assetNextStatus;
    if (
      (outcome === AssetLifecycleStatus.DAMAGED ||
        outcome === AssetLifecycleStatus.RETIRED) &&
      !dto.reason
    ) {
      throw AppException.validation([
        {
          field: 'reason',
          message: `A ${outcome} outcome requires a reason (spec §25).`,
        },
      ]);
    }
    if (
      outcome === AssetLifecycleStatus.RETIRED &&
      !user.isSuperAdmin &&
      !user.permissions.includes(PERMISSIONS.asset.retire)
    ) {
      // Retirement routes through the retirement approval; until the Phase 6
      // engine lands, holding asset.retire is the gate (audited below).
      throw AppException.forbidden(
        'Retiring an asset from maintenance requires the asset.retire permission.',
      );
    }
    const asset = await this.prisma.asset.findUniqueOrThrow({
      where: { id: wo.assetId },
      select: { id: true, assetTag: true, status: true, custodianId: true },
    });
    // maintenance-complete fires only from Under Maintenance; the chosen
    // outcome is validated against the machine's outcome list.
    const target = assertTransition(asset.status, 'maintenance-complete', outcome);
    if (outcome === AssetLifecycleStatus.ASSIGNED) {
      const openAssignment = await this.prisma.assetAssignment.findFirst({
        where: {
          assetId: wo.assetId,
          status: { in: OPEN_ASSIGNMENT_STATUSES },
        },
        select: { id: true },
      });
      if (
        !openAssignment ||
        wo.assetStatusBeforeWo !== AssetLifecycleStatus.ASSIGNED
      ) {
        throw AppException.invalidStateTransition(
          'Outcome Assigned requires the pre-maintenance assignment to still be active.',
        );
      }
    }
    await this.assertLookup(dto.finalConditionId, 'ASSET_CONDITION', 'finalConditionId');

    const openRequiredTasks = await this.prisma.maintenanceWorkOrderTask.count({
      where: { workOrderId: id, isRequired: true, isCompleted: false },
    });
    if (openRequiredTasks > 0) {
      throw AppException.invalidStateTransition(
        `${openRequiredTasks} required checklist task(s) are not completed yet.`,
      );
    }

    const plan = wo.planId
      ? await this.prisma.maintenancePlan.findUnique({
          where: { id: wo.planId },
          select: {
            id: true,
            intervalDays: true,
            meterInterval: true,
            meterType: true,
            scheduleCron: true,
          },
        })
      : null;

    const now = new Date();
    const downtimeMinutes =
      dto.downtimeMinutes ??
      (wo.actualStartAt ? computeDowntimeMinutes(wo.actualStartAt, now) : 0);
    const laborCost = dto.laborCost ? new Prisma.Decimal(dto.laborCost) : null;
    const externalCost = dto.externalCost
      ? new Prisma.Decimal(dto.externalCost)
      : null;
    const totalCost = computeWorkOrderTotalCost(
      laborCost,
      wo.partsCost,
      externalCost,
    );
    const nextMaintenanceAt = plan
      ? nextDueAfterCompletion(
          plan,
          dto.nextMaintenanceDate ? new Date(dto.nextMaintenanceDate) : null,
          now,
        )
      : dto.nextMaintenanceDate
        ? new Date(dto.nextMaintenanceDate)
        : null;
    // Meter plans baseline the next interval on the meter value at service.
    const completionMeterReading =
      plan?.meterInterval != null
        ? (
            await this.prisma.assetMeterReading.findFirst({
              where: {
                assetId: wo.assetId,
                ...(plan.meterType ? { meterType: plan.meterType } : {}),
              },
              orderBy: { readingAt: 'desc' },
              select: { readingValue: true },
            })
          )?.readingValue ?? null
        : null;

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.maintenanceWorkOrder.updateMany({
        where: { id, status: wo.status },
        data: {
          status: S.COMPLETED,
          actualEndAt: now,
          completedById: user.id,
          diagnosis: dto.diagnosis ?? undefined,
          actionTaken: dto.actionTaken,
          resolution: dto.resolution,
          completionConditionId: dto.finalConditionId,
          outcomeStatus: target,
          laborCost,
          externalCost,
          totalCost,
          downtimeMinutes,
          downtimeHours: downtimeHoursFromMinutes(downtimeMinutes),
          nextMaintenanceAt,
          completionMeterReading,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.invalidStateTransition(
          'The work order was modified concurrently. Refetch and retry.',
        );
      }
      const assetClaim = await tx.asset.updateMany({
        where: { id: asset.id, status: asset.status },
        data: {
          status: target,
          conditionId: dto.finalConditionId,
          maintenanceRequired: target === AssetLifecycleStatus.DAMAGED,
          nextMaintenanceAt,
          ...(target === AssetLifecycleStatus.RETIRED
            ? { retiredAt: now, custodianId: null }
            : {}),
          ...(target === AssetLifecycleStatus.DAMAGED ||
          target === AssetLifecycleStatus.AVAILABLE
            ? { custodianId: null }
            : {}),
        },
      });
      if (assetClaim.count === 0) {
        throw AppException.invalidStateTransition(
          `Asset ${asset.assetTag} changed state concurrently. Refetch and retry.`,
        );
      }
      await tx.assetStatusHistory.create({
        data: {
          assetId: asset.id,
          fromStatus: asset.status,
          toStatus: target,
          changedAt: now,
          changedById: user.id,
          notes: `maintenance-complete (work order ${wo.workOrderNumber})${
            dto.reason ? `: ${dto.reason}` : ''
          }`,
        },
      });
      await tx.assetConditionHistory.create({
        data: {
          assetId: asset.id,
          conditionId: dto.finalConditionId,
          recordedAt: now,
          recordedById: user.id,
          source: 'maintenance',
          workOrderId: id,
          notes: dto.resolution,
        },
      });
      if (plan) {
        await tx.maintenancePlan.update({
          where: { id: plan.id },
          data: { nextDueAt: nextMaintenanceAt },
        });
      }
    });

    await this.audit.log({
      action: 'maintenance_work_order.completed',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { status: wo.status, assetStatus: asset.status },
      newValues: {
        status: S.COMPLETED,
        assetStatus: target,
        downtimeMinutes,
        totalCost: totalCost.toString(),
        nextMaintenanceAt: nextMaintenanceAt?.toISOString() ?? null,
        // Retired outcome: recorded as auto-advanced — the configurable
        // approval engine arrives in Phase 6 (status-transitions §7).
        retirementApproval:
          target === AssetLifecycleStatus.RETIRED ? 'auto (no workflow engine yet)' : undefined,
      },
      reason: dto.reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Verify / cancel
  // -------------------------------------------------------------------------

  async verify(
    user: AuthUser,
    id: string,
    dto: VerifyWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    if (!canTransitionWo(wo.status, 'verify')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'verify'),
      );
    }
    if (wo.completedById && wo.completedById === user.id) {
      throw new AppException(
        409,
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot verify a work order you completed yourself.',
      );
    }

    const claimed = await this.prisma.maintenanceWorkOrder.updateMany({
      where: { id, status: S.COMPLETED },
      data: {
        status: S.VERIFIED,
        verifiedById: user.id,
        verifiedAt: new Date(),
        version: { increment: 1 },
      },
    });
    if (claimed.count === 0) {
      throw AppException.invalidStateTransition(
        'The work order was modified concurrently. Refetch and retry.',
      );
    }

    await this.audit.log({
      action: 'maintenance_work_order.verified',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { status: wo.status },
      newValues: { status: S.VERIFIED, comment: dto.comment ?? null },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async cancel(
    user: AuthUser,
    id: string,
    dto: CancelWorkOrderDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    if (!canTransitionWo(wo.status, 'cancel')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'cancel'),
      );
    }
    // Consumed parts guard (status-transitions §5): posted, un-reversed parts
    // issues block cancellation — reverse them through inventory first.
    const postedParts = await this.prisma.maintenancePart.findFirst({
      where: { workOrderId: id, stockTransaction: { status: 'POSTED' } },
      select: { stockTransaction: { select: { transactionNumber: true } } },
    });
    if (postedParts) {
      throw AppException.invalidStateTransition(
        `Cannot cancel: parts issue ${postedParts.stockTransaction?.transactionNumber} is posted. ` +
          'Reverse it (POST /stock-transactions/:id/reverse) before canceling the work order.',
      );
    }

    const asset = await this.prisma.asset.findUniqueOrThrow({
      where: { id: wo.assetId },
      select: { id: true, assetTag: true, status: true },
    });
    const revertAsset =
      wo.assetStatusBeforeWo !== null &&
      asset.status === AssetLifecycleStatus.UNDER_MAINTENANCE;

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.maintenanceWorkOrder.updateMany({
        where: { id, status: wo.status },
        data: {
          status: S.CANCELED,
          canceledById: user.id,
          canceledAt: now,
          cancelReason: dto.reason,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.invalidStateTransition(
          'The work order was modified concurrently. Refetch and retry.',
        );
      }
      if (revertAsset && wo.assetStatusBeforeWo) {
        // work-order-canceled (status-transitions §1.1): the asset reverts to
        // exactly the status it held when the WO started.
        await tx.asset.updateMany({
          where: { id: asset.id, status: AssetLifecycleStatus.UNDER_MAINTENANCE },
          data: { status: wo.assetStatusBeforeWo },
        });
        await tx.assetStatusHistory.create({
          data: {
            assetId: asset.id,
            fromStatus: AssetLifecycleStatus.UNDER_MAINTENANCE,
            toStatus: wo.assetStatusBeforeWo,
            changedAt: now,
            changedById: user.id,
            notes: `work-order-canceled (work order ${wo.workOrderNumber}): ${dto.reason}`,
          },
        });
      }
    });

    await this.audit.log({
      action: 'maintenance_work_order.canceled',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      oldValues: { status: wo.status, assetStatus: asset.status },
      newValues: {
        status: S.CANCELED,
        assetStatus: revertAsset ? wo.assetStatusBeforeWo : asset.status,
      },
      reason: dto.reason,
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Checklist tasks
  // -------------------------------------------------------------------------

  async replaceTasks(
    user: AuthUser,
    id: string,
    dto: ReplaceWorkOrderTasksDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    this.assertExecuteAllowed(user, wo);
    if (!canTransitionWo(wo.status, 'replace-tasks')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'replace-tasks'),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.maintenanceWorkOrderTask.deleteMany({ where: { workOrderId: id } });
      let sequence = 0;
      for (const task of dto.tasks) {
        sequence += 1;
        await tx.maintenanceWorkOrderTask.create({
          data: {
            workOrderId: id,
            sequence,
            name: task.name,
            isRequired: task.isRequired ?? true,
            notes: task.notes ?? null,
          },
        });
      }
      await tx.maintenanceWorkOrder.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
    });

    await this.audit.log({
      action: 'maintenance_work_order.tasks_replaced',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      newValues: { taskCount: dto.tasks.length },
      ...ctx,
    });
    return this.getById(user, id);
  }

  async completeTask(
    user: AuthUser,
    id: string,
    taskId: string,
    dto: CompleteWorkOrderTaskDto,
    ctx: AuditContext,
  ): Promise<WorkOrderDetailView> {
    const wo = await this.requireWo(user, id);
    this.assertExecuteAllowed(user, wo);
    if (!canTransitionWo(wo.status, 'complete-task')) {
      throw AppException.invalidStateTransition(
        woTransitionError(wo.status, 'complete-task'),
      );
    }
    const task = await this.prisma.maintenanceWorkOrderTask.findUnique({
      where: { id: taskId },
      select: { id: true, workOrderId: true, isCompleted: true, name: true },
    });
    if (!task || task.workOrderId !== id) {
      throw AppException.notFound('Checklist task not found.');
    }
    if (task.isCompleted) {
      return this.getById(user, id); // idempotent tick-off
    }

    await this.prisma.maintenanceWorkOrderTask.update({
      where: { id: taskId },
      data: {
        isCompleted: true,
        completedAt: new Date(),
        completedById: user.id,
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
    });

    await this.audit.log({
      action: 'maintenance_work_order.task_completed',
      resourceType: 'maintenance_work_order',
      resourceId: id,
      branchId: wo.branchId,
      newValues: { taskId, taskName: task.name },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Scope / actor helpers (shared with the parts service)
  // -------------------------------------------------------------------------

  canManage(user: AuthUser): boolean {
    return (
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.maintenanceWorkOrder.manage)
    );
  }

  isAssignedTechnician(user: AuthUser, wo: WoHead): boolean {
    return wo.assignedToEmployee?.userId === user.id;
  }

  /**
   * Execution actions (start/hold/resume/complete/tick-off/parts) require
   * manage OR being the WO's assigned technician (contract §6.2).
   */
  assertExecuteAllowed(user: AuthUser, wo: WoHead): void {
    if (!this.canManage(user) && !this.isAssignedTechnician(user, wo)) {
      throw AppException.forbidden(
        'Only maintenance managers or the assigned technician can do this.',
      );
    }
  }

  /**
   * Load + scope a WO: branch scope always; view-only callers additionally
   * must be the assigned technician (out-of-scope reads are a 404 — no
   * existence leak).
   */
  async requireWo(user: AuthUser, id: string): Promise<WoHead> {
    const wo = await this.prisma.maintenanceWorkOrder.findUnique({
      where: { id },
      select: WO_HEAD_SELECT,
    });
    if (
      !wo ||
      !this.branchScope.canAccess(user, wo.branchId) ||
      (!this.canManage(user) && !this.isAssignedTechnician(user, wo))
    ) {
      throw AppException.notFound('Work order not found.');
    }
    return wo;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Resolve the technician designation to an employee id (or undefined). */
  private async resolveTechnician(
    dto: AssignWorkOrderDto,
  ): Promise<string | undefined> {
    if (dto.technicianEmployeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: dto.technicianEmployeeId },
        select: { id: true, status: true, archivedAt: true },
      });
      if (!employee || employee.archivedAt || employee.status !== 'ACTIVE') {
        throw AppException.validation([
          {
            field: 'technicianEmployeeId',
            message: 'Technician must be an active employee.',
          },
        ]);
      }
      return employee.id;
    }
    if (dto.technicianUserId) {
      const employee = await this.prisma.employee.findFirst({
        where: { userId: dto.technicianUserId, archivedAt: null },
        select: { id: true, status: true },
      });
      if (!employee || employee.status !== 'ACTIVE') {
        throw AppException.validation([
          {
            field: 'technicianUserId',
            message:
              'The user has no active employee record — technicians are assigned through their employee profile.',
          },
        ]);
      }
      return employee.id;
    }
    return undefined;
  }

  private async requireActiveVendor(vendorId: string): Promise<void> {
    const vendor = await this.prisma.supplier.findUnique({
      where: { id: vendorId },
      select: { id: true, code: true, isActive: true, archivedAt: true },
    });
    if (!vendor || vendor.archivedAt || !vendor.isActive) {
      throw AppException.validation([
        {
          field: 'vendorId',
          message: 'Vendor does not exist or is inactive.',
        },
      ]);
    }
  }

  private async assertLookup(
    lookupId: string,
    category: string,
    field: string,
  ): Promise<void> {
    const value = await this.prisma.lookupValue.findUnique({
      where: { id: lookupId },
      select: { id: true, category: true, isActive: true },
    });
    if (!value || value.category !== category || !value.isActive) {
      throw AppException.validation([
        { field, message: `Must be an active ${category} lookup value.` },
      ]);
    }
  }
}
