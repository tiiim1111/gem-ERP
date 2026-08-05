import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Paginated } from '@gemerp/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  formatMaintenancePlanCode,
  MAINTENANCE_PLAN_CODE_SEQUENCE_KEY,
} from './maintenance-numbers';
import { initialNextDueAt } from './maintenance-schedule';
import {
  MaintenancePlanDetailView,
  MaintenancePlanView,
  PLAN_DETAIL_SELECT,
  PLAN_LIST_SELECT,
  canViewMaintenanceCost,
  toMaintenancePlanDetailView,
  toMaintenancePlanView,
} from './maintenance-views';
import {
  CreateMaintenancePlanDto,
  PlanTaskDto,
  QueryMaintenancePlansDto,
  ReplacePlanAssetsDto,
  UpdateMaintenancePlanDto,
} from './dto/maintenance-plan.dto';

const SORTABLE = {
  code: 'code',
  name: 'name',
  nextDueAt: 'nextDueAt',
  createdAt: 'createdAt',
};

/**
 * Preventive maintenance plans (spec §18, api-outline 6.1): frequency by
 * date interval / usage meter / cron schedule, internal team or vendor,
 * checklist template, estimated duration & cost, reminder lead time, and the
 * replaceable covered-asset set. Plans are permission-gated catalog records;
 * branch scope applies through the covered assets (each covered asset must
 * be in the actor's branch scope).
 */
@Injectable()
export class MaintenancePlansService {
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
    query: QueryMaintenancePlansDto,
  ): Promise<Paginated<MaintenancePlanView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });

    const where: Prisma.MaintenancePlanWhereInput = { archivedAt: null };
    if (query.q) {
      where.OR = [
        { code: { contains: query.q, mode: 'insensitive' } },
        { name: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.assetId) {
      where.assetLinks = { some: { assetId: query.assetId } };
    }
    if (query.dueBefore) {
      where.nextDueAt = { lte: new Date(query.dueBefore) };
    }

    const includeCost = canViewMaintenanceCost(user);
    const [rows, total] = await Promise.all([
      this.prisma.maintenancePlan.findMany({
        where,
        orderBy,
        skip,
        take,
        select: PLAN_LIST_SELECT,
      }),
      this.prisma.maintenancePlan.count({ where }),
    ]);
    return paginated(
      rows.map((row) => toMaintenancePlanView(row, includeCost)),
      page,
      pageSize,
      total,
    );
  }

  async getById(user: AuthUser, id: string): Promise<MaintenancePlanDetailView> {
    await this.requirePlan(id); // 404 for missing/archived plans
    const row = await this.prisma.maintenancePlan.findUniqueOrThrow({
      where: { id },
      select: PLAN_DETAIL_SELECT,
    });
    return toMaintenancePlanDetailView(row, canViewMaintenanceCost(user));
  }

  // -------------------------------------------------------------------------
  // Create / update
  // -------------------------------------------------------------------------

  async create(
    user: AuthUser,
    dto: CreateMaintenancePlanDto,
    ctx: AuditContext,
  ): Promise<MaintenancePlanDetailView> {
    this.assertFrequency(dto);
    await this.assertLookup(dto.maintenanceTypeId, 'MAINTENANCE_TYPE', 'maintenanceTypeId');
    if (dto.vendorId) {
      await this.requireActiveVendor(dto.vendorId);
    }
    const assetIds = [...new Set(dto.assetIds ?? [])];
    if (assetIds.length > 0) {
      await this.assertCoverableAssets(user, assetIds);
    }

    const now = new Date();
    const nextDueAt = initialNextDueAt(
      {
        intervalDays: dto.intervalDays ?? null,
        meterInterval: dto.meterInterval
          ? new Prisma.Decimal(dto.meterInterval)
          : null,
        scheduleCron: dto.scheduleCron ?? null,
      },
      dto.nextDueAt ? new Date(dto.nextDueAt) : null,
      now,
    );
    if (dto.scheduleCron && !dto.intervalDays && !nextDueAt) {
      throw AppException.validation([
        {
          field: 'nextDueAt',
          message:
            'Cron-schedule plans need an explicit nextDueAt (no cron parser is wired yet).',
        },
      ]);
    }

    const created = await this.prisma
      .$transaction(async (tx) => {
        const code =
          dto.code ??
          formatMaintenancePlanCode(
            await this.sequences.next(tx, MAINTENANCE_PLAN_CODE_SEQUENCE_KEY),
          );
        const plan = await tx.maintenancePlan.create({
          data: {
            code,
            name: dto.name,
            description: dto.description ?? null,
            maintenanceTypeId: dto.maintenanceTypeId,
            intervalDays: dto.intervalDays ?? null,
            meterInterval: dto.meterInterval
              ? new Prisma.Decimal(dto.meterInterval)
              : null,
            meterType: dto.meterType ?? null,
            scheduleCron: dto.scheduleCron ?? null,
            assignedTeam: dto.assignedTeam ?? null,
            vendorId: dto.vendorId ?? null,
            estimatedDurationHours: dto.estimatedDurationHours
              ? new Prisma.Decimal(dto.estimatedDurationHours)
              : null,
            estimatedCost: dto.estimatedCost
              ? new Prisma.Decimal(dto.estimatedCost)
              : null,
            reminderLeadDays: dto.reminderLeadDays ?? null,
            nextDueAt,
            createdById: user.id,
          },
          select: { id: true, code: true },
        });
        await this.writeTasks(tx, plan.id, dto.tasks ?? []);
        if (assetIds.length > 0) {
          await tx.maintenancePlanAsset.createMany({
            data: assetIds.map((assetId) => ({ planId: plan.id, assetId })),
          });
        }
        return plan;
      })
      .catch((error) => {
        this.rethrowDuplicateCode(error, dto.code);
        throw error;
      });

    await this.audit.log({
      action: 'maintenance_plan.created',
      resourceType: 'maintenance_plan',
      resourceId: created.id,
      newValues: {
        code: created.code,
        name: dto.name,
        assetCount: assetIds.length,
        taskCount: dto.tasks?.length ?? 0,
      },
      ...ctx,
    });
    return this.getById(user, created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateMaintenancePlanDto,
    ctx: AuditContext,
  ): Promise<MaintenancePlanDetailView> {
    const existing = await this.requirePlan(id);
    if (dto.maintenanceTypeId) {
      await this.assertLookup(dto.maintenanceTypeId, 'MAINTENANCE_TYPE', 'maintenanceTypeId');
    }
    if (dto.vendorId) {
      await this.requireActiveVendor(dto.vendorId);
    }
    const merged = {
      intervalDays:
        dto.intervalDays !== undefined ? dto.intervalDays : existing.intervalDays,
      meterInterval:
        dto.meterInterval !== undefined
          ? dto.meterInterval
            ? new Prisma.Decimal(dto.meterInterval)
            : null
          : existing.meterInterval,
      scheduleCron:
        dto.scheduleCron !== undefined ? dto.scheduleCron : existing.scheduleCron,
    };
    if (
      merged.intervalDays === null &&
      merged.meterInterval === null &&
      merged.scheduleCron === null
    ) {
      throw AppException.validation([
        {
          field: 'intervalDays',
          message:
            'A plan needs at least one frequency mechanism: intervalDays, meterInterval, or scheduleCron.',
        },
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.maintenancePlan.updateMany({
        where: { id, version: dto.version },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.maintenanceTypeId !== undefined
            ? { maintenanceTypeId: dto.maintenanceTypeId }
            : {}),
          ...(dto.intervalDays !== undefined
            ? { intervalDays: dto.intervalDays }
            : {}),
          ...(dto.meterInterval !== undefined
            ? { meterInterval: merged.meterInterval }
            : {}),
          ...(dto.meterType !== undefined ? { meterType: dto.meterType } : {}),
          ...(dto.scheduleCron !== undefined
            ? { scheduleCron: dto.scheduleCron }
            : {}),
          ...(dto.assignedTeam !== undefined
            ? { assignedTeam: dto.assignedTeam }
            : {}),
          ...(dto.vendorId !== undefined ? { vendorId: dto.vendorId } : {}),
          ...(dto.estimatedDurationHours !== undefined
            ? {
                estimatedDurationHours: dto.estimatedDurationHours
                  ? new Prisma.Decimal(dto.estimatedDurationHours)
                  : null,
              }
            : {}),
          ...(dto.estimatedCost !== undefined
            ? {
                estimatedCost: dto.estimatedCost
                  ? new Prisma.Decimal(dto.estimatedCost)
                  : null,
              }
            : {}),
          ...(dto.reminderLeadDays !== undefined
            ? { reminderLeadDays: dto.reminderLeadDays }
            : {}),
          ...(dto.nextDueAt !== undefined
            ? { nextDueAt: dto.nextDueAt ? new Date(dto.nextDueAt) : null }
            : {}),
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        throw AppException.versionConflict();
      }
      if (dto.tasks) {
        await tx.maintenancePlanTask.deleteMany({ where: { planId: id } });
        await this.writeTasks(tx, id, dto.tasks);
      }
    });

    await this.audit.log({
      action: 'maintenance_plan.updated',
      resourceType: 'maintenance_plan',
      resourceId: id,
      oldValues: { version: dto.version },
      newValues: { tasksReplaced: Boolean(dto.tasks) },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Activate / deactivate
  // -------------------------------------------------------------------------

  async setActive(
    user: AuthUser,
    id: string,
    active: boolean,
    ctx: AuditContext,
  ): Promise<MaintenancePlanDetailView> {
    const plan = await this.requirePlan(id);
    if (plan.isActive === active) {
      return this.getById(user, id); // idempotent toggle
    }
    // Re-activating a stale interval plan re-anchors its due date on today —
    // otherwise years of "overdue" would fire the moment it wakes up.
    const nextDueAt =
      active && plan.nextDueAt === null && plan.intervalDays !== null
        ? initialNextDueAt(
            {
              intervalDays: plan.intervalDays,
              meterInterval: plan.meterInterval,
              scheduleCron: plan.scheduleCron,
            },
            null,
            new Date(),
          )
        : undefined;

    await this.prisma.maintenancePlan.update({
      where: { id },
      data: {
        isActive: active,
        ...(nextDueAt !== undefined ? { nextDueAt } : {}),
        version: { increment: 1 },
      },
    });
    await this.audit.log({
      action: active
        ? 'maintenance_plan.activated'
        : 'maintenance_plan.deactivated',
      resourceType: 'maintenance_plan',
      resourceId: id,
      oldValues: { isActive: plan.isActive },
      newValues: { isActive: active },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // PUT :id/assets — replace the covered-asset set
  // -------------------------------------------------------------------------

  async replaceAssets(
    user: AuthUser,
    id: string,
    dto: ReplacePlanAssetsDto,
    ctx: AuditContext,
  ): Promise<MaintenancePlanDetailView> {
    await this.requirePlan(id);
    const assetIds = [...new Set(dto.assetIds)];
    if (assetIds.length > 0) {
      await this.assertCoverableAssets(user, assetIds);
    }

    const previous = await this.prisma.maintenancePlanAsset.findMany({
      where: { planId: id },
      select: { assetId: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.maintenancePlanAsset.deleteMany({ where: { planId: id } });
      if (assetIds.length > 0) {
        await tx.maintenancePlanAsset.createMany({
          data: assetIds.map((assetId) => ({ planId: id, assetId })),
        });
      }
      await tx.maintenancePlan.update({
        where: { id },
        data: { version: { increment: 1 } },
      });
    });

    await this.audit.log({
      action: 'maintenance_plan.assets_replaced',
      resourceType: 'maintenance_plan',
      resourceId: id,
      oldValues: { assetIds: previous.map((link) => link.assetId) },
      newValues: { assetIds },
      ...ctx,
    });
    return this.getById(user, id);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private assertFrequency(dto: CreateMaintenancePlanDto): void {
    if (!dto.intervalDays && !dto.meterInterval && !dto.scheduleCron) {
      throw AppException.validation([
        {
          field: 'intervalDays',
          message:
            'A plan needs at least one frequency mechanism: intervalDays, meterInterval, or scheduleCron.',
        },
      ]);
    }
  }

  /**
   * Covered assets must exist, be un-archived, not terminal (Retired/Disposed
   * assets cannot be maintained), and sit in the actor's branch scope.
   */
  private async assertCoverableAssets(
    user: AuthUser,
    assetIds: string[],
  ): Promise<void> {
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: {
        id: true,
        assetTag: true,
        status: true,
        branchId: true,
        archivedAt: true,
      },
    });
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const errors: ApiErrorDetail[] = [];
    assetIds.forEach((assetId, index) => {
      const asset = byId.get(assetId);
      const field = `assetIds[${index}]`;
      if (!asset || asset.archivedAt) {
        errors.push({ field, message: 'Asset does not exist.' });
        return;
      }
      if (!this.branchScope.canAccess(user, asset.branchId)) {
        errors.push({ field, message: 'Asset does not exist.' }); // no existence leak
        return;
      }
      if (
        asset.status === 'RETIRED' ||
        asset.status === 'DISPOSED' ||
        asset.status === 'LOST'
      ) {
        errors.push({
          field,
          message: `Asset ${asset.assetTag} is ${asset.status} and cannot be covered by a maintenance plan.`,
        });
      }
    });
    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
  }

  private async writeTasks(
    tx: Prisma.TransactionClient,
    planId: string,
    tasks: PlanTaskDto[],
  ): Promise<void> {
    let sequence = 0;
    for (const task of tasks) {
      sequence += 1;
      await tx.maintenancePlanTask.create({
        data: {
          planId,
          sequence,
          name: task.name,
          description: task.description ?? null,
          isRequired: task.isRequired ?? true,
        },
      });
    }
  }

  private async requirePlan(id: string) {
    const plan = await this.prisma.maintenancePlan.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        isActive: true,
        archivedAt: true,
        intervalDays: true,
        meterInterval: true,
        scheduleCron: true,
        nextDueAt: true,
      },
    });
    if (!plan || plan.archivedAt) {
      throw AppException.notFound('Maintenance plan not found.');
    }
    return plan;
  }

  private async requireActiveVendor(vendorId: string): Promise<void> {
    const vendor = await this.prisma.supplier.findUnique({
      where: { id: vendorId },
      select: { id: true, code: true, isActive: true, archivedAt: true },
    });
    if (!vendor || vendor.archivedAt) {
      throw AppException.validation([
        { field: 'vendorId', message: 'Vendor does not exist.' },
      ]);
    }
    if (!vendor.isActive) {
      throw AppException.validation([
        {
          field: 'vendorId',
          message: `Vendor ${vendor.code} is inactive — reactivate it before assigning maintenance.`,
        },
      ]);
    }
  }

  private async assertLookup(
    id: string,
    category: string,
    field: string,
  ): Promise<void> {
    const value = await this.prisma.lookupValue.findUnique({
      where: { id },
      select: { id: true, category: true, isActive: true },
    });
    if (!value || value.category !== category || !value.isActive) {
      throw AppException.validation([
        {
          field,
          message: `Must be an active ${category} lookup value.`,
        },
      ]);
    }
  }

  private rethrowDuplicateCode(error: unknown, code: string | undefined): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw AppException.duplicateCode(
        `Maintenance plan code ${code ?? ''} is already in use.`.replace('  ', ' '),
      );
    }
  }
}
