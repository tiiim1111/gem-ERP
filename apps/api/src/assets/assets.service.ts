import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import {
  AssetAssignmentStatus,
  AssetLifecycleStatus,
  TrackingMethod,
  type Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { SequenceService } from '../sequences/sequence.service';
import {
  assetTagSequenceKey,
  assetTagYear,
  formatAssetTag,
  generateScanToken,
} from './asset-tag.util';
import { permittedActions, type AssetEvent } from './asset-status-machine';
import { QueryAssetsDto } from './dto/query-assets.dto';
import { RegisterAssetDto } from './dto/register-asset.dto';
import { UpdateAssetDto } from './dto/update-asset.dto';

export const ASSET_SELECT = {
  id: true,
  assetTag: true,
  serialNumber: true,
  status: true,
  maintenanceRequired: true,
  lastInspectionAt: true,
  nextMaintenanceAt: true,
  acquisitionDate: true,
  acquisitionCost: true,
  warrantyStartDate: true,
  warrantyEndDate: true,
  retiredAt: true,
  disposedAt: true,
  disposalNotes: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  item: {
    select: {
      id: true,
      sku: true,
      name: true,
      model: true,
      businessCategory: true,
      trackingMethod: true,
      category: { select: { id: true, code: true, name: true } },
    },
  },
  branch: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  storageLocation: { select: { id: true, code: true, name: true } },
  custodian: {
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  department: { select: { id: true, code: true, name: true } },
  condition: { select: { id: true, code: true, name: true } },
  criticality: { select: { id: true, code: true, name: true } },
  disposalMethod: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, legalName: true } },
} satisfies Prisma.AssetSelect;

export type AssetRow = Prisma.AssetGetPayload<{ select: typeof ASSET_SELECT }>;

/**
 * Public asset shape. `scanToken` is deliberately never serialized — it only
 * ever leaves the API inside a rendered QR label. `acquisitionCost` appears
 * only with asset.view_cost. `version` is the optimistic-concurrency token
 * (derived — see versionOf).
 */
export interface AssetView
  extends Omit<AssetRow, 'acquisitionCost' | 'updatedAt'> {
  acquisitionCost?: string | null;
  version: number;
  updatedAt: Date;
}

export interface AssetDetailView extends AssetView {
  openAssignment: AssignmentView | null;
  permittedActions: AssetEvent[];
}

const ASSIGNMENT_SELECT = {
  id: true,
  status: true,
  projectRef: true,
  assignedAt: true,
  expectedReturnAt: true,
  issueNotes: true,
  acknowledgedAt: true,
  returnedAt: true,
  returnNotes: true,
  createdAt: true,
  employee: {
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  department: { select: { id: true, code: true, name: true } },
  location: { select: { id: true, code: true, name: true } },
  assignedBy: { select: { id: true, email: true, displayName: true } },
  returnReceivedBy: { select: { id: true, email: true, displayName: true } },
  conditionAtIssue: { select: { id: true, code: true, name: true } },
  conditionAtReturn: { select: { id: true, code: true, name: true } },
  acknowledgments: {
    select: {
      id: true,
      type: true,
      acknowledgedAt: true,
      method: true,
      notes: true,
      acknowledgedByUser: {
        select: { id: true, email: true, displayName: true },
      },
    },
    orderBy: { acknowledgedAt: 'asc' as const },
  },
} satisfies Prisma.AssetAssignmentSelect;

export type AssignmentView = Prisma.AssetAssignmentGetPayload<{
  select: typeof ASSIGNMENT_SELECT;
}>;

export interface AssetHistoryEntry {
  kind: 'status' | 'condition' | 'movement';
  at: Date;
  detail: Record<string, unknown>;
}

const SORTABLE = {
  assetTag: 'assetTag',
  status: 'status',
  serialNumber: 'serialNumber',
  acquisitionDate: 'acquisitionDate',
  warrantyEndDate: 'warrantyEndDate',
  createdAt: 'createdAt',
};

/**
 * Optimistic-concurrency token for assets.
 *
 * The assets table has no integer `version` column (schema gap vs
 * api-outline 1.6), so the token is derived from `updatedAt` (epoch ms,
 * millisecond-precise in Postgres timestamp(3)). PATCH compares it atomically
 * via a conditional update — semantics match the integer-version contract:
 * stale token → 409 VERSION_CONFLICT.
 */
export function versionOf(updatedAt: Date): number {
  return updatedAt.getTime();
}

const OPEN_ASSIGNMENT_STATUSES: AssetAssignmentStatus[] = [
  AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
  AssetAssignmentStatus.ACTIVE,
];

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
    private readonly audit: AuditService,
    private readonly sequences: SequenceService,
  ) {}

  async list(
    user: AuthUser,
    query: QueryAssetsDto,
  ): Promise<Paginated<AssetView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'assetTag',
      direction: 'asc',
    });

    const where: Prisma.AssetWhereInput = { archivedAt: null };
    if (query.branchId) {
      // Explicitly requesting an out-of-scope branch is a 403 (outline 1.7).
      this.branchScope.assertBranchAccess(user, query.branchId);
      where.branchId = query.branchId;
    } else {
      const filter = this.branchScope.branchFilter(user);
      if (filter) {
        where.branchId = filter;
      }
    }
    if (query.q) {
      where.OR = [
        { assetTag: { contains: query.q, mode: 'insensitive' } },
        { serialNumber: { contains: query.q, mode: 'insensitive' } },
        { item: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.conditionId) {
      where.conditionId = query.conditionId;
    }
    if (query.itemId) {
      where.itemId = query.itemId;
    }
    if (query.categoryId) {
      where.item = { ...(where.item as object), categoryId: query.categoryId };
    }
    if (query.custodianEmployeeId) {
      where.custodianId = query.custodianEmployeeId;
    }
    if (query.departmentId) {
      where.departmentId = query.departmentId;
    }
    if (query.warrantyExpiringDays) {
      const horizon = new Date(
        Date.now() + query.warrantyExpiringDays * 24 * 60 * 60 * 1000,
      );
      where.warrantyEndDate = { gte: new Date(), lte: horizon };
    }

    const canViewCost = this.canViewCost(user);
    const [rows, total] = await Promise.all([
      this.prisma.asset.findMany({
        where,
        orderBy,
        skip,
        take,
        select: ASSET_SELECT,
      }),
      this.prisma.asset.count({ where }),
    ]);
    return paginated(
      rows.map((row) => this.toView(row, canViewCost)),
      page,
      pageSize,
      total,
    );
  }

  async getById(user: AuthUser, id: string): Promise<AssetDetailView> {
    const row = await this.requireInScope(user, id);
    const openAssignment = await this.prisma.assetAssignment.findFirst({
      where: { assetId: id, status: { in: OPEN_ASSIGNMENT_STATUSES } },
      orderBy: { assignedAt: 'desc' },
      select: ASSIGNMENT_SELECT,
    });
    return {
      ...this.toView(row, this.canViewCost(user)),
      openAssignment,
      permittedActions: permittedActions(row.status, user),
    };
  }

  /**
   * Register one or many asset instances (POST /assets). Tags are allocated
   * from the (branch, category, year) sequence counter inside the same
   * transaction as the inserts; scan tokens are generated per instance.
   */
  async register(
    user: AuthUser,
    dto: RegisterAssetDto,
    ctx: AuditContext,
  ): Promise<AssetView[]> {
    const quantity = dto.quantity ?? 1;
    const item = await this.prisma.item.findUnique({
      where: { id: dto.itemId },
      select: {
        id: true,
        sku: true,
        name: true,
        trackingMethod: true,
        isActive: true,
        archivedAt: true,
        requiresSerialNumber: true,
        category: { select: { id: true, code: true } },
      },
    });
    if (!item || item.archivedAt) {
      throw AppException.validation([
        { field: 'itemId', message: 'Item does not exist.' },
      ]);
    }
    if (item.trackingMethod !== TrackingMethod.SERIAL) {
      throw AppException.validation([
        {
          field: 'itemId',
          message: `Item ${item.sku} is not serial-tracked. Only SERIAL-tracked items register asset instances.`,
        },
      ]);
    }
    if (!item.isActive) {
      throw AppException.validation([
        { field: 'itemId', message: `Item ${item.sku} is inactive.` },
      ]);
    }
    if (!item.category) {
      throw AppException.validation([
        {
          field: 'itemId',
          message: `Item ${item.sku} has no category — the category code is required for the asset tag pattern.`,
        },
      ]);
    }

    const branch = await this.prisma.branch.findUnique({
      where: { id: dto.branchId },
      select: { id: true, code: true },
    });
    if (!branch) {
      throw AppException.notFound('Branch not found.');
    }
    this.branchScope.assertBranchAccess(user, dto.branchId);
    await this.assertWarehouseAndLocation(
      dto.branchId,
      dto.warehouseId,
      dto.storageLocationId,
    );
    await this.assertLookup(dto.conditionId, 'ASSET_CONDITION', 'conditionId');
    await this.assertLookup(
      dto.criticalityId,
      'MAINTENANCE_PRIORITY',
      'criticalityId',
    );
    await this.assertDepartment(dto.departmentId);
    await this.assertSupplier(dto.supplierId);

    const serials = this.resolveSerials(dto, quantity);
    await this.assertSerialsFree(item.id, serials.filter(Boolean) as string[]);

    const initialStatus: AssetLifecycleStatus =
      dto.initialStatus === 'AVAILABLE'
        ? AssetLifecycleStatus.AVAILABLE
        : AssetLifecycleStatus.DRAFT;
    if (initialStatus === AssetLifecycleStatus.AVAILABLE) {
      this.assertActivatable({
        warehouseId: dto.warehouseId ?? null,
        conditionId: dto.conditionId ?? null,
        serialRequired: item.requiresSerialNumber,
        serials,
      });
    }

    const now = new Date();
    const year = assetTagYear(now);
    const sequenceKey = assetTagSequenceKey(branch.code, item.category.code, year);

    const created = await this.prisma.$transaction(async (tx) => {
      const rows: AssetRow[] = [];
      for (let index = 0; index < quantity; index += 1) {
        const sequence = await this.sequences.next(tx, sequenceKey);
        const assetTag = formatAssetTag(
          branch.code,
          item.category!.code,
          year,
          sequence,
        );
        const row = await tx.asset.create({
          data: {
            assetTag,
            scanToken: generateScanToken(),
            serialNumber: serials[index] ?? null,
            itemId: item.id,
            status: initialStatus,
            conditionId: dto.conditionId ?? null,
            criticalityId: dto.criticalityId ?? null,
            branchId: dto.branchId,
            warehouseId: dto.warehouseId ?? null,
            storageLocationId: dto.storageLocationId ?? null,
            departmentId: dto.departmentId ?? null,
            acquisitionDate: dto.acquisitionDate
              ? new Date(dto.acquisitionDate)
              : null,
            acquisitionCost: dto.acquisitionCost ?? null,
            supplierId: dto.supplierId ?? null,
            warrantyStartDate: dto.warrantyStartDate
              ? new Date(dto.warrantyStartDate)
              : null,
            warrantyEndDate: dto.warrantyEndDate
              ? new Date(dto.warrantyEndDate)
              : null,
            nextMaintenanceAt: dto.nextMaintenanceAt
              ? new Date(dto.nextMaintenanceAt)
              : null,
            notes: dto.notes ?? null,
          },
          select: ASSET_SELECT,
        });

        // register → Draft (and activate → Available when requested).
        await tx.assetStatusHistory.create({
          data: {
            assetId: row.id,
            fromStatus: null,
            toStatus: AssetLifecycleStatus.DRAFT,
            changedAt: now,
            changedById: ctx.actorUserId ?? null,
            notes: 'register',
          },
        });
        if (initialStatus === AssetLifecycleStatus.AVAILABLE) {
          await tx.assetStatusHistory.create({
            data: {
              assetId: row.id,
              fromStatus: AssetLifecycleStatus.DRAFT,
              toStatus: AssetLifecycleStatus.AVAILABLE,
              changedAt: now,
              changedById: ctx.actorUserId ?? null,
              notes: 'activate (registered directly as Available)',
            },
          });
        }
        if (dto.conditionId) {
          await tx.assetConditionHistory.create({
            data: {
              assetId: row.id,
              conditionId: dto.conditionId,
              recordedAt: now,
              recordedById: ctx.actorUserId ?? null,
              source: 'registration',
            },
          });
        }
        rows.push(row);
      }
      return rows;
    });

    for (const row of created) {
      await this.audit.log({
        action: 'asset.registered',
        resourceType: 'asset',
        resourceId: row.id,
        branchId: dto.branchId,
        newValues: this.snapshot(row),
        metadata: { bulkCount: quantity },
        ...ctx,
      });
    }

    const canViewCost = this.canViewCost(user);
    return created.map((row) => this.toView(row, canViewCost));
  }

  /** PATCH /assets/:id — non-lifecycle fields; Draft is fully editable. */
  async update(
    user: AuthUser,
    id: string,
    dto: UpdateAssetDto,
    ctx: AuditContext,
  ): Promise<AssetView> {
    const existing = await this.requireInScope(user, id);
    if (existing.archivedAt) {
      throw AppException.invalidStateTransition(
        'This asset record is archived and can no longer be modified.',
      );
    }
    if (existing.status === AssetLifecycleStatus.DISPOSED) {
      throw AppException.invalidStateTransition(
        'A disposed asset cannot be edited. Use reverse-disposal (authorized) first.',
      );
    }

    const isDraft = existing.status === AssetLifecycleStatus.DRAFT;
    const draftOnlyFields = [
      'conditionId',
      'warehouseId',
      'storageLocationId',
      'departmentId',
      'acquisitionDate',
      'acquisitionCost',
      'supplierId',
    ] as const;
    if (!isDraft) {
      const offending = draftOnlyFields.filter(
        (field) => dto[field] !== undefined,
      );
      if (offending.length > 0) {
        throw AppException.validation(
          offending.map((field) => ({
            field,
            message: `${field} is editable only while the asset is Draft. Use the lifecycle/transfer actions instead.`,
          })),
        );
      }
    }

    if (dto.serialNumber !== undefined && dto.serialNumber !== null) {
      if (dto.serialNumber !== existing.serialNumber) {
        await this.assertSerialsFree(existing.item.id, [dto.serialNumber], id);
      }
    }
    if (dto.warehouseId !== undefined || dto.storageLocationId !== undefined) {
      await this.assertWarehouseAndLocation(
        existing.branch.id,
        dto.warehouseId ?? existing.warehouse?.id,
        dto.storageLocationId ?? undefined,
      );
    }
    await this.assertLookup(
      dto.conditionId ?? undefined,
      'ASSET_CONDITION',
      'conditionId',
    );
    await this.assertLookup(
      dto.criticalityId ?? undefined,
      'MAINTENANCE_PRIORITY',
      'criticalityId',
    );
    await this.assertDepartment(dto.departmentId ?? undefined);
    await this.assertSupplier(dto.supplierId ?? undefined);

    const data: Prisma.AssetUncheckedUpdateManyInput = {
      ...(dto.serialNumber !== undefined
        ? { serialNumber: dto.serialNumber }
        : {}),
      ...(dto.conditionId !== undefined ? { conditionId: dto.conditionId } : {}),
      ...(dto.criticalityId !== undefined
        ? { criticalityId: dto.criticalityId }
        : {}),
      ...(dto.warehouseId !== undefined ? { warehouseId: dto.warehouseId } : {}),
      ...(dto.storageLocationId !== undefined
        ? { storageLocationId: dto.storageLocationId }
        : {}),
      ...(dto.departmentId !== undefined
        ? { departmentId: dto.departmentId }
        : {}),
      ...(dto.acquisitionDate !== undefined
        ? {
            acquisitionDate: dto.acquisitionDate
              ? new Date(dto.acquisitionDate)
              : null,
          }
        : {}),
      ...(dto.acquisitionCost !== undefined
        ? { acquisitionCost: dto.acquisitionCost }
        : {}),
      ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
      ...(dto.warrantyStartDate !== undefined
        ? {
            warrantyStartDate: dto.warrantyStartDate
              ? new Date(dto.warrantyStartDate)
              : null,
          }
        : {}),
      ...(dto.warrantyEndDate !== undefined
        ? {
            warrantyEndDate: dto.warrantyEndDate
              ? new Date(dto.warrantyEndDate)
              : null,
          }
        : {}),
      ...(dto.nextMaintenanceAt !== undefined
        ? {
            nextMaintenanceAt: dto.nextMaintenanceAt
              ? new Date(dto.nextMaintenanceAt)
              : null,
          }
        : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    // Atomic optimistic-concurrency update: 0 rows touched = stale version.
    const result = await this.prisma.asset.updateMany({
      where: { id, updatedAt: new Date(dto.version) },
      data,
    });
    if (result.count === 0) {
      throw AppException.versionConflict();
    }

    const updated = await this.requireInScope(user, id);
    await this.audit.log({
      action: 'asset.updated',
      resourceType: 'asset',
      resourceId: id,
      branchId: updated.branch.id,
      oldValues: this.snapshot(existing),
      newValues: this.snapshot(updated),
      ...ctx,
    });
    return this.toView(updated, this.canViewCost(user));
  }

  /** GET /assets/:id/history — unified status/condition/location timeline. */
  async history(user: AuthUser, id: string): Promise<AssetHistoryEntry[]> {
    await this.requireInScope(user, id);
    const [statusRows, conditionRows, movementRows] = await Promise.all([
      this.prisma.assetStatusHistory.findMany({
        where: { assetId: id },
        orderBy: { changedAt: 'desc' },
        select: {
          fromStatus: true,
          toStatus: true,
          changedAt: true,
          notes: true,
          reason: { select: { code: true, name: true } },
          changedBy: { select: { id: true, displayName: true } },
        },
      }),
      this.prisma.assetConditionHistory.findMany({
        where: { assetId: id },
        orderBy: { recordedAt: 'desc' },
        select: {
          recordedAt: true,
          source: true,
          notes: true,
          condition: { select: { code: true, name: true } },
          recordedBy: { select: { id: true, displayName: true } },
        },
      }),
      this.prisma.assetMovement.findMany({
        where: { assetId: id },
        orderBy: { movedAt: 'desc' },
        select: {
          movedAt: true,
          notes: true,
          fromBranch: { select: { code: true, name: true } },
          toBranch: { select: { code: true, name: true } },
          fromWarehouse: { select: { code: true, name: true } },
          toWarehouse: { select: { code: true, name: true } },
          fromLocation: { select: { code: true, name: true } },
          toLocation: { select: { code: true, name: true } },
          fromEmployee: {
            select: { employeeNumber: true, firstName: true, lastName: true },
          },
          toEmployee: {
            select: { employeeNumber: true, firstName: true, lastName: true },
          },
          movedBy: { select: { id: true, displayName: true } },
        },
      }),
    ]);

    const entries: AssetHistoryEntry[] = [
      ...statusRows.map((row) => ({
        kind: 'status' as const,
        at: row.changedAt,
        detail: row as unknown as Record<string, unknown>,
      })),
      ...conditionRows.map((row) => ({
        kind: 'condition' as const,
        at: row.recordedAt,
        detail: row as unknown as Record<string, unknown>,
      })),
      ...movementRows.map((row) => ({
        kind: 'movement' as const,
        at: row.movedAt,
        detail: row as unknown as Record<string, unknown>,
      })),
    ];
    return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /** GET /assets/:id/assignments — custody history + acknowledgments. */
  async assignments(user: AuthUser, id: string): Promise<AssignmentView[]> {
    await this.requireInScope(user, id);
    return this.prisma.assetAssignment.findMany({
      where: { assetId: id },
      orderBy: { assignedAt: 'desc' },
      select: ASSIGNMENT_SELECT,
    });
  }

  // ------------------------------------------------------------------
  // Shared helpers (used by the lifecycle service as well)
  // ------------------------------------------------------------------

  /** Direct fetch: out-of-scope records are 404 (no existence leak). */
  async requireInScope(user: AuthUser, id: string): Promise<AssetRow> {
    const row = await this.prisma.asset.findUnique({
      where: { id },
      select: ASSET_SELECT,
    });
    if (!row || !this.branchScope.canAccess(user, row.branch.id)) {
      throw AppException.notFound('Asset not found.');
    }
    return row;
  }

  canViewCost(user: AuthUser): boolean {
    return (
      user.isSuperAdmin || user.permissions.includes(PERMISSIONS.asset.viewCost)
    );
  }

  toView(row: AssetRow, includeCost: boolean): AssetView {
    const { acquisitionCost, ...rest } = row;
    return {
      ...rest,
      ...(includeCost
        ? { acquisitionCost: acquisitionCost?.toString() ?? null }
        : {}),
      version: versionOf(row.updatedAt),
    };
  }

  /** Audit snapshot — cost included (audit access is itself permission-gated). */
  snapshot(row: AssetRow): Record<string, unknown> {
    return {
      assetTag: row.assetTag,
      serialNumber: row.serialNumber,
      status: row.status,
      itemId: row.item.id,
      branchId: row.branch.id,
      warehouseId: row.warehouse?.id ?? null,
      storageLocationId: row.storageLocation?.id ?? null,
      custodianId: row.custodian?.id ?? null,
      departmentId: row.department?.id ?? null,
      conditionId: row.condition?.id ?? null,
      criticalityId: row.criticality?.id ?? null,
      acquisitionDate: row.acquisitionDate,
      acquisitionCost: row.acquisitionCost?.toString() ?? null,
      supplierId: row.supplier?.id ?? null,
      warrantyStartDate: row.warrantyStartDate,
      warrantyEndDate: row.warrantyEndDate,
      maintenanceRequired: row.maintenanceRequired,
      retiredAt: row.retiredAt,
      disposedAt: row.disposedAt,
      disposalMethodId: row.disposalMethod?.id ?? null,
      notes: row.notes,
    };
  }

  async assertLookup(
    id: string | undefined,
    category: string,
    field: string,
  ): Promise<void> {
    if (!id) {
      return;
    }
    const value = await this.prisma.lookupValue.findUnique({
      where: { id },
      select: { id: true, category: true, isActive: true },
    });
    if (!value || value.category !== category || !value.isActive) {
      throw AppException.validation([
        {
          field,
          message: `Must reference an active ${category} lookup value.`,
        },
      ]);
    }
  }

  async assertWarehouseAndLocation(
    branchId: string,
    warehouseId?: string,
    storageLocationId?: string,
  ): Promise<void> {
    if (warehouseId) {
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: warehouseId },
        select: { id: true, branchId: true, isActive: true },
      });
      if (!warehouse || warehouse.branchId !== branchId || !warehouse.isActive) {
        throw AppException.validation([
          {
            field: 'warehouseId',
            message: 'Warehouse does not exist in this branch or is inactive.',
          },
        ]);
      }
    }
    if (storageLocationId) {
      const location = await this.prisma.storageLocation.findUnique({
        where: { id: storageLocationId },
        select: {
          id: true,
          warehouseId: true,
          isActive: true,
          warehouse: { select: { branchId: true } },
        },
      });
      const locationOk =
        location &&
        location.isActive &&
        location.warehouse.branchId === branchId &&
        (!warehouseId || location.warehouseId === warehouseId);
      if (!locationOk) {
        throw AppException.validation([
          {
            field: 'storageLocationId',
            message:
              'Storage location does not exist in the given warehouse/branch or is inactive.',
          },
        ]);
      }
    }
  }

  private async assertDepartment(departmentId?: string): Promise<void> {
    if (!departmentId) {
      return;
    }
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { id: true, isActive: true },
    });
    if (!department || !department.isActive) {
      throw AppException.validation([
        {
          field: 'departmentId',
          message: 'Department does not exist or is inactive.',
        },
      ]);
    }
  }

  private async assertSupplier(supplierId?: string): Promise<void> {
    if (!supplierId) {
      return;
    }
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { id: true },
    });
    if (!supplier) {
      throw AppException.validation([
        { field: 'supplierId', message: 'Supplier does not exist.' },
      ]);
    }
  }

  /** Serial list per instance: single field, bulk array, or none. */
  private resolveSerials(
    dto: RegisterAssetDto,
    quantity: number,
  ): Array<string | null> {
    if (dto.serialNumbers !== undefined) {
      if (dto.serialNumbers.length !== quantity) {
        throw AppException.validation([
          {
            field: 'serialNumbers',
            message: `serialNumbers must contain exactly ${quantity} entries to match quantity.`,
          },
        ]);
      }
      const trimmed = dto.serialNumbers.map((serial) => serial.trim());
      if (trimmed.some((serial) => serial.length === 0)) {
        throw AppException.validation([
          { field: 'serialNumbers', message: 'Serial numbers cannot be blank.' },
        ]);
      }
      const unique = new Set(trimmed);
      if (unique.size !== trimmed.length) {
        throw AppException.validation([
          {
            field: 'serialNumbers',
            message: 'Serial numbers within one registration must be unique.',
          },
        ]);
      }
      return trimmed;
    }
    if (dto.serialNumber !== undefined) {
      if (quantity > 1) {
        throw AppException.validation([
          {
            field: 'serialNumber',
            message:
              'Use serialNumbers (array) when registering more than one instance.',
          },
        ]);
      }
      return [dto.serialNumber];
    }
    return Array.from({ length: quantity }, () => null);
  }

  /**
   * Manufacturer serials must be unique per item. The schema enforces
   * uniqueness across ALL assets of the item (including retired/disposed) via
   * @@unique([itemId, serialNumber]) — stricter than "unique while active",
   * which is acceptable: serials never legitimately reappear on a new unit.
   */
  private async assertSerialsFree(
    itemId: string,
    serials: string[],
    excludeAssetId?: string,
  ): Promise<void> {
    if (serials.length === 0) {
      return;
    }
    const clash = await this.prisma.asset.findFirst({
      where: {
        itemId,
        serialNumber: { in: serials },
        ...(excludeAssetId ? { id: { not: excludeAssetId } } : {}),
      },
      select: { assetTag: true, serialNumber: true },
    });
    if (clash) {
      throw AppException.duplicateCode(
        `Serial number "${clash.serialNumber}" is already registered on asset ${clash.assetTag}.`,
      );
    }
  }

  /** Activation guard: required fields complete before an asset goes live. */
  assertActivatable(input: {
    warehouseId: string | null;
    conditionId: string | null;
    serialRequired: boolean;
    serials?: Array<string | null>;
  }): void {
    const details: Array<{ field: string; message: string }> = [];
    if (!input.warehouseId) {
      details.push({
        field: 'warehouseId',
        message: 'A warehouse must be set before the asset becomes Available.',
      });
    }
    if (!input.conditionId) {
      details.push({
        field: 'conditionId',
        message: 'A condition must be recorded before the asset becomes Available.',
      });
    }
    if (
      input.serialRequired &&
      input.serials &&
      input.serials.some((serial) => !serial)
    ) {
      details.push({
        field: 'serialNumber',
        message:
          'This item requires a manufacturer serial number before activation.',
      });
    }
    if (details.length > 0) {
      throw AppException.validation(details, 'Asset is not ready for activation.');
    }
  }
}
