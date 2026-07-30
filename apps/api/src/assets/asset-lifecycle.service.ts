import { Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@gemerp/shared';
import {
  AcknowledgmentType,
  AssetAssignmentStatus,
  AssetLifecycleStatus,
  EmployeeStatus,
  type Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { assertTransition, type AssetEvent } from './asset-status-machine';
import {
  AssetDetailView,
  AssetRow,
  AssetsService,
} from './assets.service';
import {
  AcknowledgeAssetDto,
  AssignAssetDto,
  CompleteMaintenanceDto,
  DisposeAssetDto,
  InspectAssetDto,
  ReasonDto,
  ReportIncidentDto,
  ReturnAssetDto,
  StatusNoteDto,
  TransferAssetDto,
} from './dto/asset-actions.dto';

const OPEN_ASSIGNMENT_STATUSES: AssetAssignmentStatus[] = [
  AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
  AssetAssignmentStatus.ACTIVE,
];

/**
 * Lifecycle action endpoints for serialized assets
 * (docs/status-transitions.md §1). Every action:
 *
 * 1. loads the asset branch-scoped (out of scope → 404),
 * 2. validates the event against the state machine (illegal → 409
 *    INVALID_STATE_TRANSITION),
 * 3. performs the status change plus its side effects (assignment rows,
 *    movements, condition history, status history) in ONE database
 *    transaction,
 * 4. audit-logs with old/new values and the captured reason.
 *
 * Approval-framework routing for damage/loss/recovery/retirement/disposal
 * (spec §19) arrives with the approvals module in Phase 6; until then these
 * events execute directly under their permissions and are fully audited.
 */
@Injectable()
export class AssetLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetsService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
  ) {}

  /** POST /assets/:id/activate — Draft → Available. */
  async activate(
    user: AuthUser,
    id: string,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const target = assertTransition(row.status, 'activate');
    this.assets.assertActivatable({
      warehouseId: row.warehouse?.id ?? null,
      conditionId: row.condition?.id ?? null,
      serialRequired: false,
    });

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({ where: { id }, data: { status: target } });
      await this.writeStatusHistory(tx, row, target, now, ctx, 'activate');
    });
    await this.logTransition('asset.activated', row, target, ctx);
    return this.assets.getById(user, id);
  }

  /** POST /assets/:id/reserve — Available → Reserved. */
  async reserve(
    user: AuthUser,
    id: string,
    dto: StatusNoteDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    return this.simpleTransition(user, id, 'reserve', 'asset.reserved', ctx, {
      notes: dto.notes,
    });
  }

  /** POST /assets/:id/release — Reserved → Available. */
  async release(
    user: AuthUser,
    id: string,
    dto: StatusNoteDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    return this.simpleTransition(
      user,
      id,
      'release',
      'asset.reservation_released',
      ctx,
      { notes: dto.notes },
    );
  }

  /**
   * POST /assets/:id/assign — Available/Reserved → Assigned.
   * Creates the custody record (pending acknowledgment for employees),
   * condition-at-issuance, and the custody movement.
   */
  async assign(
    user: AuthUser,
    id: string,
    dto: AssignAssetDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const target = assertTransition(row.status, 'assign');
    const targetCount = [
      dto.employeeId,
      dto.departmentId,
      dto.locationId,
      dto.projectRef,
    ].filter((value) => value !== undefined).length;
    if (targetCount !== 1) {
      throw AppException.validation([
        {
          field: 'employeeId',
          message:
            'Provide exactly one assignment target: employeeId, departmentId, locationId, or projectRef.',
        },
      ]);
    }
    await this.assets.assertLookup(dto.conditionId, 'ASSET_CONDITION', 'conditionId');
    const employee = dto.employeeId
      ? await this.requireActiveEmployee(dto.employeeId, row.branch.id)
      : null;
    if (dto.locationId) {
      await this.assets.assertWarehouseAndLocation(
        row.branch.id,
        undefined,
        dto.locationId,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.assetAssignment.create({
        data: {
          assetId: id,
          // Employee custody starts pending their acknowledgment (spec §15);
          // department/location/project assignments have no acknowledging
          // person and are active immediately.
          status: employee
            ? AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT
            : AssetAssignmentStatus.ACTIVE,
          employeeId: dto.employeeId ?? null,
          departmentId: dto.departmentId ?? null,
          locationId: dto.locationId ?? null,
          projectRef: dto.projectRef ?? null,
          assignedAt: now,
          assignedById: this.requireActor(ctx),
          expectedReturnAt: dto.expectedReturnDate
            ? new Date(dto.expectedReturnDate)
            : null,
          conditionAtIssueId: dto.conditionId,
          issueNotes: dto.notes ?? null,
        },
      });
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          custodianId: dto.employeeId ?? null,
          departmentId: dto.departmentId ?? row.department?.id ?? null,
          conditionId: dto.conditionId,
        },
      });
      await tx.assetMovement.create({
        data: {
          assetId: id,
          movedAt: now,
          fromBranchId: row.branch.id,
          toBranchId: row.branch.id,
          fromWarehouseId: row.warehouse?.id ?? null,
          fromLocationId: row.storageLocation?.id ?? null,
          toEmployeeId: dto.employeeId ?? null,
          toLocationId: dto.locationId ?? null,
          assignmentId: assignment.id,
          movedById: ctx.actorUserId ?? null,
          notes: dto.notes ?? 'assign',
        },
      });
      await tx.assetConditionHistory.create({
        data: {
          assetId: id,
          conditionId: dto.conditionId,
          recordedAt: now,
          recordedById: ctx.actorUserId ?? null,
          source: 'issuance',
          notes: dto.notes ?? null,
        },
      });
      await this.writeStatusHistory(tx, row, target, now, ctx, 'assign');
    });

    await this.logTransition('asset.assigned', row, target, ctx, {
      employeeId: dto.employeeId ?? null,
      departmentId: dto.departmentId ?? null,
      locationId: dto.locationId ?? null,
      projectRef: dto.projectRef ?? null,
      expectedReturnDate: dto.expectedReturnDate ?? null,
    });
    return this.assets.getById(user, id);
  }

  /**
   * POST /assets/:id/acknowledge — the custodian employee's linked user
   * confirms receipt; or an authorized user (asset.assign) captures a
   * signed/verbal acknowledgment on their behalf (notes required).
   */
  async acknowledge(
    user: AuthUser,
    id: string,
    dto: AcknowledgeAssetDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const assignment = await this.prisma.assetAssignment.findFirst({
      where: {
        assetId: id,
        status: AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
      },
      orderBy: { assignedAt: 'desc' },
      select: { id: true, employeeId: true },
    });
    if (!assignment || !assignment.employeeId) {
      throw AppException.invalidStateTransition(
        'There is no assignment pending acknowledgment on this asset.',
      );
    }

    const linkedEmployee = await this.prisma.employee.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    const isCustodian = linkedEmployee?.id === assignment.employeeId;
    const mayCapture =
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.asset.assign) ||
      user.permissions.includes(PERMISSIONS.asset.acknowledge);
    if (!isCustodian && !mayCapture) {
      throw AppException.forbidden(
        'Only the custodian employee or a user with asset.assign may acknowledge.',
      );
    }
    if (!isCustodian && !dto.notes) {
      throw AppException.validation([
        {
          field: 'notes',
          message:
            'Captured acknowledgments (recorded on the employee’s behalf) require notes describing how consent was obtained.',
        },
      ]);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.assetAssignment.update({
        where: { id: assignment.id },
        data: { status: AssetAssignmentStatus.ACTIVE, acknowledgedAt: now },
      });
      await tx.assetAcknowledgment.create({
        data: {
          assignmentId: assignment.id,
          assetId: id,
          employeeId: assignment.employeeId!,
          type: AcknowledgmentType.ISSUE,
          acknowledgedAt: now,
          acknowledgedByUserId: user.id,
          method: isCustodian ? 'USER_CONFIRMED' : 'CAPTURED',
          notes: dto.notes ?? null,
        },
      });
    });
    await this.audit.log({
      action: 'asset.acknowledged',
      resourceType: 'asset',
      resourceId: id,
      branchId: row.branch.id,
      newValues: {
        assignmentId: assignment.id,
        method: isCustodian ? 'USER_CONFIRMED' : 'CAPTURED',
      },
      ...ctx,
    });
    return this.assets.getById(user, id);
  }

  /**
   * POST /assets/:id/return — Assigned → Available (or Damaged when the
   * returned condition is failed). Closes the custody record with
   * condition-at-return and records the movement back into storage.
   */
  async return_(
    user: AuthUser,
    id: string,
    dto: ReturnAssetDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const condition = await this.requireCondition(dto.conditionId);
    const damaged = dto.damaged ?? condition.code === 'DEFECTIVE';
    const event: AssetEvent = damaged ? 'return-damaged' : 'return';
    const target = assertTransition(row.status, event);
    if (damaged && !dto.notes) {
      throw AppException.validation([
        {
          field: 'notes',
          message: 'A damaged return requires notes describing the damage.',
        },
      ]);
    }
    if (dto.warehouseId || dto.locationId) {
      await this.assets.assertWarehouseAndLocation(
        row.branch.id,
        dto.warehouseId,
        dto.locationId,
      );
    }

    const now = new Date();
    const openAssignment = await this.prisma.assetAssignment.findFirst({
      where: { assetId: id, status: { in: OPEN_ASSIGNMENT_STATUSES } },
      orderBy: { assignedAt: 'desc' },
      select: { id: true, employeeId: true },
    });

    await this.prisma.$transaction(async (tx) => {
      if (openAssignment) {
        await tx.assetAssignment.update({
          where: { id: openAssignment.id },
          data: {
            status: AssetAssignmentStatus.RETURNED,
            returnedAt: now,
            returnReceivedById: ctx.actorUserId ?? null,
            conditionAtReturnId: dto.conditionId,
            returnNotes: dto.notes ?? null,
          },
        });
        if (openAssignment.employeeId) {
          await tx.assetAcknowledgment.create({
            data: {
              assignmentId: openAssignment.id,
              assetId: id,
              employeeId: openAssignment.employeeId,
              type: AcknowledgmentType.RETURN,
              acknowledgedAt: now,
              acknowledgedByUserId: ctx.actorUserId ?? null,
              method: 'CAPTURED',
              notes: dto.notes ?? null,
            },
          });
        }
      }
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          custodianId: null,
          conditionId: dto.conditionId,
          ...(dto.warehouseId ? { warehouseId: dto.warehouseId } : {}),
          ...(dto.locationId !== undefined
            ? { storageLocationId: dto.locationId ?? null }
            : {}),
          ...(damaged ? { maintenanceRequired: true } : {}),
        },
      });
      await tx.assetMovement.create({
        data: {
          assetId: id,
          movedAt: now,
          fromBranchId: row.branch.id,
          toBranchId: row.branch.id,
          fromEmployeeId: row.custodian?.id ?? null,
          toWarehouseId: dto.warehouseId ?? row.warehouse?.id ?? null,
          toLocationId: dto.locationId ?? null,
          assignmentId: openAssignment?.id ?? null,
          movedById: ctx.actorUserId ?? null,
          notes: dto.notes ?? 'return',
        },
      });
      await tx.assetConditionHistory.create({
        data: {
          assetId: id,
          conditionId: dto.conditionId,
          recordedAt: now,
          recordedById: ctx.actorUserId ?? null,
          source: 'return',
          notes: dto.notes ?? null,
        },
      });
      await this.writeStatusHistory(tx, row, target, now, ctx, event, dto.notes);
    });

    await this.logTransition('asset.returned', row, target, ctx, {
      conditionCode: condition.code,
      damaged,
    });
    return this.assets.getById(user, id);
  }

  /**
   * POST /assets/:id/transfer — employee-to-employee reassignment
   * (Assigned → Assigned) or an administrative location/warehouse/branch
   * move of an Available asset. Both write from/to movement rows.
   */
  async transfer(
    user: AuthUser,
    id: string,
    dto: TransferAssetDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    if (dto.employeeId && (dto.branchId || dto.warehouseId || dto.locationId)) {
      throw AppException.validation([
        {
          field: 'employeeId',
          message:
            'A transfer is either a custody reassignment (employeeId) or a location move (branchId/warehouseId/locationId) — not both.',
        },
      ]);
    }
    if (dto.employeeId) {
      return this.reassign(user, id, dto, ctx);
    }
    if (!dto.branchId && !dto.warehouseId && !dto.locationId) {
      throw AppException.validation([
        {
          field: 'employeeId',
          message:
            'Provide employeeId (reassignment) or a destination branchId/warehouseId/locationId (move).',
        },
      ]);
    }
    return this.move(user, id, dto, ctx);
  }

  /** POST /assets/:id/send-to-inspection */
  async sendToInspection(
    user: AuthUser,
    id: string,
    dto: StatusNoteDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    return this.simpleTransition(
      user,
      id,
      'send-to-inspection',
      'asset.sent_to_inspection',
      ctx,
      { notes: dto.notes },
    );
  }

  /** POST /assets/:id/inspect — record the outcome (pass/fail). */
  async inspect(
    user: AuthUser,
    id: string,
    dto: InspectAssetDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const event: AssetEvent =
      dto.outcome === 'PASS' ? 'inspection-pass' : 'inspection-fail';
    const target = assertTransition(row.status, event);
    if (dto.outcome === 'FAIL' && !dto.notes) {
      throw AppException.validation([
        {
          field: 'notes',
          message: 'A failed inspection requires findings in notes.',
        },
      ]);
    }
    await this.assets.assertLookup(dto.conditionId, 'ASSET_CONDITION', 'conditionId');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          conditionId: dto.conditionId,
          lastInspectionAt: now,
          maintenanceRequired:
            dto.maintenanceRequired ?? dto.outcome === 'FAIL',
        },
      });
      await tx.assetConditionHistory.create({
        data: {
          assetId: id,
          conditionId: dto.conditionId,
          recordedAt: now,
          recordedById: ctx.actorUserId ?? null,
          source: 'inspection',
          notes: dto.notes ?? null,
        },
      });
      await this.writeStatusHistory(tx, row, target, now, ctx, event, dto.notes);
    });
    await this.logTransition('asset.inspected', row, target, ctx, {
      outcome: dto.outcome,
    });
    return this.assets.getById(user, id);
  }

  /** POST /assets/:id/send-to-maintenance — status flag only (WOs are Phase 5). */
  async sendToMaintenance(
    user: AuthUser,
    id: string,
    dto: StatusNoteDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    return this.simpleTransition(
      user,
      id,
      'send-to-maintenance',
      'asset.sent_to_maintenance',
      ctx,
      { notes: dto.notes, maintenanceRequired: false },
    );
  }

  /**
   * POST /assets/:id/complete-maintenance — outcome chosen explicitly
   * (spec §18). ASSIGNED requires the pre-maintenance assignment to still be
   * open; RETIRED additionally requires asset.retire.
   */
  async completeMaintenance(
    user: AuthUser,
    id: string,
    dto: CompleteMaintenanceDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const outcome = dto.outcome as AssetLifecycleStatus;
    const target = assertTransition(row.status, 'maintenance-complete', outcome);
    if (
      (outcome === AssetLifecycleStatus.DAMAGED ||
        outcome === AssetLifecycleStatus.RETIRED) &&
      !dto.reason
    ) {
      throw AppException.validation([
        {
          field: 'reason',
          message: `A ${dto.outcome} maintenance outcome requires a reason.`,
        },
      ]);
    }
    if (
      outcome === AssetLifecycleStatus.RETIRED &&
      !user.isSuperAdmin &&
      !user.permissions.includes(PERMISSIONS.asset.retire)
    ) {
      throw AppException.forbidden(
        'Retiring an asset from maintenance requires the asset.retire permission.',
      );
    }
    if (outcome === AssetLifecycleStatus.ASSIGNED) {
      const openAssignment = await this.prisma.assetAssignment.findFirst({
        where: { assetId: id, status: { in: OPEN_ASSIGNMENT_STATUSES } },
        select: { id: true },
      });
      if (!openAssignment) {
        throw AppException.invalidStateTransition(
          'Outcome Assigned requires the pre-maintenance assignment to still be active.',
        );
      }
    }
    await this.assets.assertLookup(dto.conditionId, 'ASSET_CONDITION', 'conditionId');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          maintenanceRequired: outcome === AssetLifecycleStatus.DAMAGED,
          ...(dto.conditionId ? { conditionId: dto.conditionId } : {}),
          ...(outcome === AssetLifecycleStatus.RETIRED
            ? { retiredAt: now, custodianId: null }
            : {}),
        },
      });
      if (dto.conditionId) {
        await tx.assetConditionHistory.create({
          data: {
            assetId: id,
            conditionId: dto.conditionId,
            recordedAt: now,
            recordedById: ctx.actorUserId ?? null,
            source: 'maintenance',
            notes: dto.reason ?? null,
          },
        });
      }
      await this.writeStatusHistory(
        tx,
        row,
        target,
        now,
        ctx,
        'maintenance-complete',
        dto.reason,
      );
    });
    await this.logTransition('asset.maintenance_completed', row, target, ctx, {
      outcome: dto.outcome,
      reason: dto.reason ?? null,
    });
    return this.assets.getById(user, id);
  }

  /** POST /assets/:id/report-damage — → Damaged (reason mandatory). */
  async reportDamage(
    user: AuthUser,
    id: string,
    dto: ReportIncidentDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const target = assertTransition(row.status, 'report-damage');
    await this.assets.assertLookup(dto.conditionId, 'ASSET_CONDITION', 'conditionId');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.closeOpenAssignment(tx, id, now, ctx, {
        status: AssetAssignmentStatus.RETURNED,
        conditionId: dto.conditionId ?? null,
        notes: `Closed by damage report: ${dto.description}`,
      });
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          custodianId: null,
          maintenanceRequired: true,
          ...(dto.conditionId ? { conditionId: dto.conditionId } : {}),
        },
      });
      if (dto.conditionId) {
        await tx.assetConditionHistory.create({
          data: {
            assetId: id,
            conditionId: dto.conditionId,
            recordedAt: now,
            recordedById: ctx.actorUserId ?? null,
            source: 'damage-report',
            notes: dto.description,
          },
        });
      }
      await this.writeStatusHistory(
        tx,
        row,
        target,
        now,
        ctx,
        'report-damage',
        dto.description,
      );
    });
    await this.logTransition('asset.damage_reported', row, target, ctx, {
      description: dto.description,
    });
    return this.assets.getById(user, id);
  }

  /**
   * POST /assets/:id/report-loss — → Lost (reason mandatory). The active
   * assignment is closed and flagged LOST — never marked "returned".
   */
  async reportLoss(
    user: AuthUser,
    id: string,
    dto: ReportIncidentDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const target = assertTransition(row.status, 'report-loss');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.closeOpenAssignment(tx, id, now, ctx, {
        status: AssetAssignmentStatus.LOST,
        conditionId: null,
        notes: `Loss declaration: ${dto.description}`,
      });
      await tx.asset.update({
        where: { id },
        data: { status: target, custodianId: null },
      });
      await tx.assetMovement.create({
        data: {
          assetId: id,
          movedAt: now,
          fromBranchId: row.branch.id,
          fromWarehouseId: row.warehouse?.id ?? null,
          fromLocationId: row.storageLocation?.id ?? null,
          fromEmployeeId: row.custodian?.id ?? null,
          movedById: ctx.actorUserId ?? null,
          notes: `Reported lost: ${dto.description}`,
        },
      });
      await this.writeStatusHistory(
        tx,
        row,
        target,
        now,
        ctx,
        'report-loss',
        dto.description,
      );
    });
    await this.logTransition('asset.loss_reported', row, target, ctx, {
      description: dto.description,
    });
    return this.assets.getById(user, id);
  }

  /** POST /assets/:id/recover — Lost → Under Inspection (authorized). */
  async recover(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    return this.simpleTransition(user, id, 'recover', 'asset.recovered', ctx, {
      notes: dto.reason,
      reason: dto.reason,
    });
  }

  /**
   * POST /assets/:id/retire — Available/Damaged → Retired; from Lost this is
   * the write-off event. Reason mandatory.
   */
  async retire(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const event: AssetEvent =
      row.status === AssetLifecycleStatus.LOST ? 'write-off' : 'retire';
    const target = assertTransition(row.status, event);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: { status: target, retiredAt: now, custodianId: null },
      });
      await this.writeStatusHistory(tx, row, target, now, ctx, event, dto.reason);
    });
    await this.logTransition('asset.retired', row, target, ctx, {
      event,
      reason: dto.reason,
    });
    return this.assets.getById(user, id);
  }

  /** POST /assets/:id/dispose — Retired → Disposed (method + reason). */
  async dispose(
    user: AuthUser,
    id: string,
    dto: DisposeAssetDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const target = assertTransition(row.status, 'dispose');
    await this.assets.assertLookup(
      dto.disposalMethodId,
      'DISPOSAL_METHOD',
      'disposalMethodId',
    );

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          disposedAt: now,
          disposalMethodId: dto.disposalMethodId,
          disposalNotes: dto.reason,
        },
      });
      await this.writeStatusHistory(tx, row, target, now, ctx, 'dispose', dto.reason);
    });
    await this.logTransition('asset.disposed', row, target, ctx, {
      disposalMethodId: dto.disposalMethodId,
      reason: dto.reason,
    });
    return this.assets.getById(user, id);
  }

  /**
   * POST /assets/:id/reverse-disposal — authorized reversal (asset.dispose).
   * The original disposal is never deleted: it stays in status history and in
   * the audit trail; the reversal itself is recorded with its reason.
   */
  async reverseDisposal(
    user: AuthUser,
    id: string,
    dto: ReasonDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const target = assertTransition(row.status, 'reverse-disposal');

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          disposedAt: null,
          disposalMethodId: null,
          disposalNotes: `Disposal reversed: ${dto.reason}`,
        },
      });
      await this.writeStatusHistory(
        tx,
        row,
        target,
        now,
        ctx,
        'reverse-disposal',
        dto.reason,
      );
    });
    await this.logTransition('asset.disposal_reversed', row, target, ctx, {
      reason: dto.reason,
      originalDisposedAt: row.disposedAt,
      originalDisposalMethodId: row.disposalMethod?.id ?? null,
    });
    return this.assets.getById(user, id);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Employee-to-employee reassignment (Assigned → Assigned). */
  private async reassign(
    user: AuthUser,
    id: string,
    dto: TransferAssetDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const target = assertTransition(row.status, 'reassign');
    const employee = await this.requireActiveEmployee(
      dto.employeeId!,
      row.branch.id,
    );
    if (row.custodian?.id === employee.id) {
      throw AppException.validation([
        {
          field: 'employeeId',
          message: 'The asset is already assigned to this employee.',
        },
      ]);
    }
    if (dto.conditionId) {
      await this.assets.assertLookup(dto.conditionId, 'ASSET_CONDITION', 'conditionId');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.closeOpenAssignment(tx, id, now, ctx, {
        status: AssetAssignmentStatus.RETURNED,
        conditionId: dto.conditionId ?? null,
        notes: `Reassigned to ${employee.employeeNumber}`,
      });
      const assignment = await tx.assetAssignment.create({
        data: {
          assetId: id,
          status: AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
          employeeId: employee.id,
          assignedAt: now,
          assignedById: this.requireActor(ctx),
          expectedReturnAt: dto.expectedReturnDate
            ? new Date(dto.expectedReturnDate)
            : null,
          conditionAtIssueId: dto.conditionId ?? row.condition?.id ?? null,
          issueNotes: dto.notes ?? null,
        },
      });
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          custodianId: employee.id,
          ...(dto.conditionId ? { conditionId: dto.conditionId } : {}),
        },
      });
      await tx.assetMovement.create({
        data: {
          assetId: id,
          movedAt: now,
          fromBranchId: row.branch.id,
          toBranchId: row.branch.id,
          fromEmployeeId: row.custodian?.id ?? null,
          toEmployeeId: employee.id,
          assignmentId: assignment.id,
          movedById: ctx.actorUserId ?? null,
          notes: dto.notes ?? 'reassign',
        },
      });
      if (dto.conditionId) {
        await tx.assetConditionHistory.create({
          data: {
            assetId: id,
            conditionId: dto.conditionId,
            recordedAt: now,
            recordedById: ctx.actorUserId ?? null,
            source: 'reassignment',
            notes: dto.notes ?? null,
          },
        });
      }
      await this.writeStatusHistory(tx, row, target, now, ctx, 'reassign', dto.notes);
    });
    await this.logTransition('asset.reassigned', row, target, ctx, {
      fromEmployeeId: row.custodian?.id ?? null,
      toEmployeeId: employee.id,
    });
    return this.assets.getById(user, id);
  }

  /**
   * Administrative location/warehouse/branch move of an Available asset.
   * Branch moves require access to BOTH branches. Custodied, in-maintenance,
   * or in-transfer assets cannot be moved this way (state machine).
   */
  private async move(
    user: AuthUser,
    id: string,
    dto: TransferAssetDto,
    ctx: AuditContext,
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    if (row.status !== AssetLifecycleStatus.AVAILABLE) {
      throw AppException.invalidStateTransition(
        `Only Available assets can be moved directly. ` +
          'Assigned assets must be returned or reassigned; use transfer documents for dispatched moves.',
      );
    }
    const toBranchId = dto.branchId ?? row.branch.id;
    if (dto.branchId && dto.branchId !== row.branch.id) {
      // Cross-branch move: actor needs access on both ends (outline 1.7).
      this.branchScope.assertBranchAccess(user, dto.branchId);
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
        select: { id: true },
      });
      if (!branch) {
        throw AppException.notFound('Destination branch not found.');
      }
      if (!dto.warehouseId) {
        throw AppException.validation([
          {
            field: 'warehouseId',
            message: 'A destination warehouse is required for a branch move.',
          },
        ]);
      }
    }
    await this.assets.assertWarehouseAndLocation(
      toBranchId,
      dto.warehouseId ?? (dto.branchId ? undefined : row.warehouse?.id),
      dto.locationId,
    );

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          branchId: toBranchId,
          ...(dto.warehouseId ? { warehouseId: dto.warehouseId } : {}),
          ...(dto.locationId !== undefined
            ? { storageLocationId: dto.locationId ?? null }
            : {}),
        },
      });
      await tx.assetMovement.create({
        data: {
          assetId: id,
          movedAt: now,
          fromBranchId: row.branch.id,
          toBranchId,
          fromWarehouseId: row.warehouse?.id ?? null,
          toWarehouseId: dto.warehouseId ?? row.warehouse?.id ?? null,
          fromLocationId: row.storageLocation?.id ?? null,
          toLocationId: dto.locationId ?? null,
          movedById: ctx.actorUserId ?? null,
          notes: dto.notes ?? 'location move',
        },
      });
    });
    await this.audit.log({
      action: 'asset.transferred',
      resourceType: 'asset',
      resourceId: id,
      branchId: toBranchId,
      oldValues: {
        branchId: row.branch.id,
        warehouseId: row.warehouse?.id ?? null,
        storageLocationId: row.storageLocation?.id ?? null,
      },
      newValues: {
        branchId: toBranchId,
        warehouseId: dto.warehouseId ?? row.warehouse?.id ?? null,
        storageLocationId: dto.locationId ?? null,
      },
      ...ctx,
    });
    return this.assets.getById(user, id);
  }

  /** Status-only transitions sharing one code path. */
  private async simpleTransition(
    user: AuthUser,
    id: string,
    event: AssetEvent,
    auditAction: string,
    ctx: AuditContext,
    options: {
      notes?: string;
      reason?: string;
      maintenanceRequired?: boolean;
    } = {},
  ): Promise<AssetDetailView> {
    const row = await this.assets.requireInScope(user, id);
    const target = assertTransition(row.status, event);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.update({
        where: { id },
        data: {
          status: target,
          ...(options.maintenanceRequired !== undefined
            ? { maintenanceRequired: options.maintenanceRequired }
            : {}),
        },
      });
      await this.writeStatusHistory(tx, row, target, now, ctx, event, options.notes);
    });
    await this.logTransition(auditAction, row, target, ctx, {
      ...(options.reason ? { reason: options.reason } : {}),
    });
    return this.assets.getById(user, id);
  }

  private async writeStatusHistory(
    tx: Prisma.TransactionClient,
    row: AssetRow,
    toStatus: AssetLifecycleStatus,
    at: Date,
    ctx: AuditContext,
    event: AssetEvent,
    notes?: string,
  ): Promise<void> {
    await tx.assetStatusHistory.create({
      data: {
        assetId: row.id,
        fromStatus: row.status,
        toStatus,
        changedAt: at,
        changedById: ctx.actorUserId ?? null,
        notes: notes ? `${event}: ${notes}` : event,
      },
    });
  }

  private async closeOpenAssignment(
    tx: Prisma.TransactionClient,
    assetId: string,
    at: Date,
    ctx: AuditContext,
    options: {
      status: AssetAssignmentStatus;
      conditionId: string | null;
      notes: string;
    },
  ): Promise<void> {
    await tx.assetAssignment.updateMany({
      where: { assetId, status: { in: OPEN_ASSIGNMENT_STATUSES } },
      data: {
        status: options.status,
        // A LOST closure is deliberately NOT a return (spec §15).
        ...(options.status === AssetAssignmentStatus.RETURNED
          ? {
              returnedAt: at,
              returnReceivedById: ctx.actorUserId ?? null,
              conditionAtReturnId: options.conditionId,
            }
          : {}),
        returnNotes: options.notes,
      },
    });
  }

  /** Active ASSET_CONDITION lookup value (returns its code for damage mapping). */
  private async requireCondition(
    conditionId: string,
  ): Promise<{ id: string; code: string }> {
    const value = await this.prisma.lookupValue.findUnique({
      where: { id: conditionId },
      select: { id: true, code: true, category: true, isActive: true },
    });
    if (!value || value.category !== 'ASSET_CONDITION' || !value.isActive) {
      throw AppException.validation([
        {
          field: 'conditionId',
          message: 'Must reference an active ASSET_CONDITION lookup value.',
        },
      ]);
    }
    return { id: value.id, code: value.code };
  }

  private async requireActiveEmployee(
    employeeId: string,
    branchId: string,
  ): Promise<{ id: string; employeeNumber: string }> {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeNumber: true,
        status: true,
        branchId: true,
        archivedAt: true,
      },
    });
    if (!employee || employee.archivedAt) {
      throw AppException.validation([
        { field: 'employeeId', message: 'Employee does not exist.' },
      ]);
    }
    if (employee.status !== EmployeeStatus.ACTIVE) {
      throw AppException.validation([
        {
          field: 'employeeId',
          message: 'Assets can only be assigned to ACTIVE employees.',
        },
      ]);
    }
    if (employee.branchId !== branchId) {
      throw AppException.validation([
        {
          field: 'employeeId',
          message:
            'The employee belongs to a different branch. Transfer the asset first.',
        },
      ]);
    }
    return { id: employee.id, employeeNumber: employee.employeeNumber };
  }

  private requireActor(ctx: AuditContext): string {
    if (!ctx.actorUserId) {
      throw AppException.unauthenticated();
    }
    return ctx.actorUserId;
  }

  private async logTransition(
    action: string,
    row: AssetRow,
    toStatus: AssetLifecycleStatus,
    ctx: AuditContext,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.log({
      action,
      resourceType: 'asset',
      resourceId: row.id,
      branchId: row.branch.id,
      oldValues: { status: row.status },
      newValues: { status: toStatus },
      metadata: { assetTag: row.assetTag, ...metadata },
      ...ctx,
    });
  }
}
