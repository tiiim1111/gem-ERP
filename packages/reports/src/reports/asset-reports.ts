/**
 * Asset report definitions (api-outline §8): register, custody, movements,
 * condition, terminal states. All require asset.view on top of report.view;
 * acquisition costs appear only with asset.view_cost.
 */
import { AssetLifecycleStatus, Prisma } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import {
  branchWhere,
  dateOnly,
  dateRange,
  decimalString,
  effectiveBranchIds,
  isoDateTime,
} from '../filters';
import type { ReportContext, ReportDefinition, ReportPrisma } from '../types';

const REF = { select: { code: true, name: true } };

function employeeName(
  employee: { firstName: string; lastName: string; displayName: string | null } | null,
): string | null {
  if (!employee) {
    return null;
  }
  return employee.displayName ?? `${employee.firstName} ${employee.lastName}`;
}

// ---------------------------------------------------------------------------
// asset-register
// ---------------------------------------------------------------------------

export const assetRegister: ReportDefinition = {
  key: 'asset-register',
  title: 'Asset register',
  description:
    'Every serialized asset with tag, item, location, custody, warranty, and lifecycle status.',
  permission: PERMISSIONS.asset.view,
  costPermission: PERMISSIONS.asset.viewCost,
  filters: [
    'branchId',
    'warehouseId',
    'categoryId',
    'itemId',
    'employeeId',
    'departmentId',
    'supplierId',
    'status',
    'from',
    'to',
  ],
  statusOptions: Object.values(AssetLifecycleStatus),
  columns: [
    { key: 'assetTag', header: 'Asset tag', width: 1.4 },
    { key: 'serialNumber', header: 'Serial no.' },
    { key: 'itemSku', header: 'SKU' },
    { key: 'itemName', header: 'Item', width: 1.6 },
    { key: 'category', header: 'Category' },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'warehouse', header: 'Warehouse' },
    { key: 'location', header: 'Location' },
    { key: 'status', header: 'Status' },
    { key: 'condition', header: 'Condition' },
    { key: 'custodian', header: 'Custodian', width: 1.2 },
    { key: 'department', header: 'Department' },
    { key: 'acquisitionDate', header: 'Acquired' },
    { key: 'warrantyEndDate', header: 'Warranty end' },
    { key: 'supplier', header: 'Supplier', width: 1.2 },
    { key: 'acquisitionCost', header: 'Acquisition cost', cost: true },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const acquisition = dateRange(f);
    const where: Prisma.AssetWhereInput = {
      archivedAt: null,
      branchId: branchWhere(ctx),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}),
      ...(f.status ? { status: f.status as AssetLifecycleStatus } : {}),
      ...(f.employeeId ? { custodianId: f.employeeId } : {}),
      ...(f.departmentId ? { departmentId: f.departmentId } : {}),
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(acquisition ? { acquisitionDate: acquisition } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: { assetTag: 'asc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          assetTag: true,
          serialNumber: true,
          status: true,
          acquisitionDate: true,
          acquisitionCost: true,
          warrantyEndDate: true,
          item: {
            select: { sku: true, name: true, category: { select: { name: true } } },
          },
          branch: { select: { code: true } },
          warehouse: REF,
          storageLocation: REF,
          condition: { select: { name: true } },
          custodian: {
            select: { firstName: true, lastName: true, displayName: true },
          },
          department: { select: { name: true } },
          supplier: { select: { legalName: true } },
        },
      }),
      prisma.asset.count({ where }),
    ]);
    return {
      rows: rows.map((asset) => ({
        assetTag: asset.assetTag,
        serialNumber: asset.serialNumber,
        itemSku: asset.item.sku,
        itemName: asset.item.name,
        category: asset.item.category?.name ?? null,
        branch: asset.branch.code,
        warehouse: asset.warehouse?.name ?? null,
        location: asset.storageLocation?.code ?? null,
        status: asset.status,
        condition: asset.condition?.name ?? null,
        custodian: employeeName(asset.custodian),
        department: asset.department?.name ?? null,
        acquisitionDate: dateOnly(asset.acquisitionDate),
        warrantyEndDate: dateOnly(asset.warrantyEndDate),
        supplier: asset.supplier?.legalName ?? null,
        ...(ctx.includeCost
          ? { acquisitionCost: decimalString(asset.acquisitionCost) }
          : {}),
      })),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// asset-custody
// ---------------------------------------------------------------------------

export const assetCustody: ReportDefinition = {
  key: 'asset-custody',
  title: 'Asset custody & assignments',
  description:
    'Assignment history: who holds (or held) each asset, acknowledgment and return timestamps, and issue/return conditions.',
  permission: PERMISSIONS.asset.view,
  filters: [
    'branchId',
    'itemId',
    'employeeId',
    'departmentId',
    'status',
    'from',
    'to',
  ],
  statusOptions: [
    'PENDING_ACKNOWLEDGMENT',
    'ACTIVE',
    'RETURNED',
    'LOST',
    'CANCELED',
  ],
  columns: [
    { key: 'assetTag', header: 'Asset tag', width: 1.4 },
    { key: 'itemName', header: 'Item', width: 1.5 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'employee', header: 'Employee', width: 1.3 },
    { key: 'department', header: 'Department' },
    { key: 'projectRef', header: 'Project' },
    { key: 'status', header: 'Status' },
    { key: 'assignedAt', header: 'Assigned', width: 1.2 },
    { key: 'acknowledgedAt', header: 'Acknowledged', width: 1.2 },
    { key: 'expectedReturnAt', header: 'Expected return', width: 1.2 },
    { key: 'returnedAt', header: 'Returned', width: 1.2 },
    { key: 'conditionAtIssue', header: 'Condition at issue' },
    { key: 'conditionAtReturn', header: 'Condition at return' },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const assigned = dateRange(f);
    const where: Prisma.AssetAssignmentWhereInput = {
      asset: {
        branchId: branchWhere(ctx),
        ...(f.itemId ? { itemId: f.itemId } : {}),
      },
      ...(f.employeeId ? { employeeId: f.employeeId } : {}),
      ...(f.departmentId ? { departmentId: f.departmentId } : {}),
      ...(f.status
        ? { status: f.status as Prisma.AssetAssignmentWhereInput['status'] }
        : {}),
      ...(assigned ? { assignedAt: assigned } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.assetAssignment.findMany({
        where,
        orderBy: { assignedAt: 'desc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          status: true,
          assignedAt: true,
          acknowledgedAt: true,
          expectedReturnAt: true,
          returnedAt: true,
          projectRef: true,
          asset: {
            select: {
              assetTag: true,
              branch: { select: { code: true } },
              item: { select: { name: true } },
            },
          },
          employee: {
            select: { firstName: true, lastName: true, displayName: true },
          },
          department: { select: { name: true } },
          conditionAtIssue: { select: { name: true } },
          conditionAtReturn: { select: { name: true } },
        },
      }),
      prisma.assetAssignment.count({ where }),
    ]);
    return {
      rows: rows.map((assignment) => ({
        assetTag: assignment.asset.assetTag,
        itemName: assignment.asset.item.name,
        branch: assignment.asset.branch.code,
        employee: employeeName(assignment.employee),
        department: assignment.department?.name ?? null,
        projectRef: assignment.projectRef,
        status: assignment.status,
        assignedAt: isoDateTime(assignment.assignedAt),
        acknowledgedAt: isoDateTime(assignment.acknowledgedAt),
        expectedReturnAt: isoDateTime(assignment.expectedReturnAt),
        returnedAt: isoDateTime(assignment.returnedAt),
        conditionAtIssue: assignment.conditionAtIssue?.name ?? null,
        conditionAtReturn: assignment.conditionAtReturn?.name ?? null,
      })),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// asset-movements
// ---------------------------------------------------------------------------

export const assetMovements: ReportDefinition = {
  key: 'asset-movements',
  title: 'Asset movements & lifecycle',
  description:
    'Location and custody movement history per asset, including inter-branch transfers.',
  permission: PERMISSIONS.asset.view,
  filters: ['branchId', 'itemId', 'employeeId', 'from', 'to'],
  columns: [
    { key: 'movedAt', header: 'Moved at', width: 1.2 },
    { key: 'assetTag', header: 'Asset tag', width: 1.4 },
    { key: 'itemName', header: 'Item', width: 1.5 },
    { key: 'fromBranch', header: 'From branch', width: 0.8 },
    { key: 'toBranch', header: 'To branch', width: 0.8 },
    { key: 'fromWarehouse', header: 'From warehouse' },
    { key: 'toWarehouse', header: 'To warehouse' },
    { key: 'fromEmployee', header: 'From employee', width: 1.2 },
    { key: 'toEmployee', header: 'To employee', width: 1.2 },
    { key: 'transferNumber', header: 'Transfer no.' },
    { key: 'notes', header: 'Notes', width: 1.5 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const moved = dateRange(f);
    const scope = effectiveBranchIds(ctx);
    const where: Prisma.AssetMovementWhereInput = {
      // Visible when the movement touches an accessible branch on either end
      // or the asset currently belongs to one (outbound history stays
      // visible to the source branch).
      ...(scope === null
        ? {}
        : {
            OR: [
              { fromBranchId: { in: scope } },
              { toBranchId: { in: scope } },
              { asset: { branchId: { in: scope } } },
            ],
          }),
      ...(f.itemId ? { asset: { itemId: f.itemId } } : {}),
      ...(f.employeeId
        ? {
            AND: [
              {
                OR: [
                  { fromEmployeeId: f.employeeId },
                  { toEmployeeId: f.employeeId },
                ],
              },
            ],
          }
        : {}),
      ...(moved ? { movedAt: moved } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.assetMovement.findMany({
        where,
        orderBy: { movedAt: 'desc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          movedAt: true,
          notes: true,
          asset: { select: { assetTag: true, item: { select: { name: true } } } },
          fromBranch: { select: { code: true } },
          toBranch: { select: { code: true } },
          fromWarehouse: { select: { name: true } },
          toWarehouse: { select: { name: true } },
          fromEmployee: {
            select: { firstName: true, lastName: true, displayName: true },
          },
          toEmployee: {
            select: { firstName: true, lastName: true, displayName: true },
          },
          transfer: { select: { transferNumber: true } },
        },
      }),
      prisma.assetMovement.count({ where }),
    ]);
    return {
      rows: rows.map((movement) => ({
        movedAt: isoDateTime(movement.movedAt),
        assetTag: movement.asset.assetTag,
        itemName: movement.asset.item.name,
        fromBranch: movement.fromBranch?.code ?? null,
        toBranch: movement.toBranch?.code ?? null,
        fromWarehouse: movement.fromWarehouse?.name ?? null,
        toWarehouse: movement.toWarehouse?.name ?? null,
        fromEmployee: employeeName(movement.fromEmployee),
        toEmployee: employeeName(movement.toEmployee),
        transferNumber: movement.transfer?.transferNumber ?? null,
        notes: movement.notes,
      })),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// asset-condition
// ---------------------------------------------------------------------------

export const assetCondition: ReportDefinition = {
  key: 'asset-condition',
  title: 'Asset condition',
  description:
    'Current condition, inspection recency, and maintenance flags per asset.',
  permission: PERMISSIONS.asset.view,
  filters: ['branchId', 'warehouseId', 'categoryId', 'itemId', 'status', 'from', 'to'],
  statusOptions: Object.values(AssetLifecycleStatus),
  columns: [
    { key: 'assetTag', header: 'Asset tag', width: 1.4 },
    { key: 'itemName', header: 'Item', width: 1.6 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'status', header: 'Status' },
    { key: 'condition', header: 'Condition' },
    { key: 'criticality', header: 'Criticality' },
    { key: 'maintenanceRequired', header: 'Maintenance required' },
    { key: 'lastInspectionAt', header: 'Last inspection', width: 1.2 },
    { key: 'nextMaintenanceAt', header: 'Next maintenance', width: 1.2 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const inspected = dateRange(f);
    const where: Prisma.AssetWhereInput = {
      archivedAt: null,
      branchId: branchWhere(ctx),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}),
      ...(f.status ? { status: f.status as AssetLifecycleStatus } : {}),
      ...(inspected ? { lastInspectionAt: inspected } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: { assetTag: 'asc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          assetTag: true,
          status: true,
          maintenanceRequired: true,
          lastInspectionAt: true,
          nextMaintenanceAt: true,
          item: { select: { name: true } },
          branch: { select: { code: true } },
          condition: { select: { name: true } },
          criticality: { select: { name: true } },
        },
      }),
      prisma.asset.count({ where }),
    ]);
    return {
      rows: rows.map((asset) => ({
        assetTag: asset.assetTag,
        itemName: asset.item.name,
        branch: asset.branch.code,
        status: asset.status,
        condition: asset.condition?.name ?? null,
        criticality: asset.criticality?.name ?? null,
        maintenanceRequired: asset.maintenanceRequired,
        lastInspectionAt: isoDateTime(asset.lastInspectionAt),
        nextMaintenanceAt: isoDateTime(asset.nextMaintenanceAt),
      })),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// asset-terminal
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES = [
  AssetLifecycleStatus.RETIRED,
  AssetLifecycleStatus.DISPOSED,
  AssetLifecycleStatus.DAMAGED,
  AssetLifecycleStatus.LOST,
] as const;

export const assetTerminal: ReportDefinition = {
  key: 'asset-terminal',
  title: 'Retired / disposed / damaged / lost assets',
  description:
    'Assets in terminal or incident states with disposal details and acquisition value.',
  permission: PERMISSIONS.asset.view,
  costPermission: PERMISSIONS.asset.viewCost,
  filters: ['branchId', 'categoryId', 'itemId', 'status', 'from', 'to'],
  statusOptions: [...TERMINAL_STATUSES],
  columns: [
    { key: 'assetTag', header: 'Asset tag', width: 1.4 },
    { key: 'itemName', header: 'Item', width: 1.6 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'status', header: 'Status' },
    { key: 'condition', header: 'Condition' },
    { key: 'retiredAt', header: 'Retired', width: 1.2 },
    { key: 'disposedAt', header: 'Disposed', width: 1.2 },
    { key: 'disposalMethod', header: 'Disposal method' },
    { key: 'disposalNotes', header: 'Disposal notes', width: 1.5 },
    { key: 'acquisitionCost', header: 'Acquisition cost', cost: true },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const changed = dateRange(f);
    const where: Prisma.AssetWhereInput = {
      branchId: branchWhere(ctx),
      status: f.status
        ? (f.status as AssetLifecycleStatus)
        : { in: [...TERMINAL_STATUSES] },
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}),
      // from/to bound the last lifecycle change (updatedAt) — retirement,
      // disposal, damage, and loss all update the record when they land.
      ...(changed ? { updatedAt: changed } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.asset.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          assetTag: true,
          status: true,
          retiredAt: true,
          disposedAt: true,
          disposalNotes: true,
          acquisitionCost: true,
          item: { select: { name: true } },
          branch: { select: { code: true } },
          condition: { select: { name: true } },
          disposalMethod: { select: { name: true } },
        },
      }),
      prisma.asset.count({ where }),
    ]);
    return {
      rows: rows.map((asset) => ({
        assetTag: asset.assetTag,
        itemName: asset.item.name,
        branch: asset.branch.code,
        status: asset.status,
        condition: asset.condition?.name ?? null,
        retiredAt: isoDateTime(asset.retiredAt),
        disposedAt: isoDateTime(asset.disposedAt),
        disposalMethod: asset.disposalMethod?.name ?? null,
        disposalNotes: asset.disposalNotes,
        ...(ctx.includeCost
          ? { acquisitionCost: decimalString(asset.acquisitionCost) }
          : {}),
      })),
      total,
    };
  },
};
