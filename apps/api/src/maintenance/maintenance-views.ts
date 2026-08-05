import { PERMISSIONS } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/types/auth-request';

/**
 * Shared select shapes + serializers for maintenance resources. Lives outside
 * the services so plans, work orders, and parts build identical responses
 * without circular dependencies (procurement-views pattern).
 *
 * Cost fields (plan estimated cost; WO labor/parts/external/total; part unit
 * and total cost) are serialized ONLY for callers holding
 * maintenance.work_order.view_cost — everyone else gets the document without
 * money. Durations, meters, and quantities are not money and stay visible.
 */

const ACTOR_SELECT = { select: { id: true, displayName: true, email: true } };
const REF_SELECT = { select: { id: true, code: true, name: true } };
const LOOKUP_REF_SELECT = { select: { id: true, code: true, name: true } };
const ASSET_REF_SELECT = {
  select: {
    id: true,
    assetTag: true,
    serialNumber: true,
    status: true,
    item: { select: { id: true, sku: true, name: true } },
  },
};
const EMPLOYEE_REF_SELECT = {
  select: {
    id: true,
    employeeNumber: true,
    firstName: true,
    lastName: true,
    displayName: true,
    userId: true,
  },
};
const VENDOR_REF_SELECT = {
  select: { id: true, code: true, legalName: true, tradeName: true },
};

export function canViewMaintenanceCost(user: AuthUser): boolean {
  return (
    user.isSuperAdmin ||
    user.permissions.includes(PERMISSIONS.maintenanceWorkOrder.viewCost)
  );
}

const str = (value: { toString(): string } | null): string | null =>
  value === null ? null : value.toString();

// ---------------------------------------------------------------------------
// Maintenance plans
// ---------------------------------------------------------------------------

export const PLAN_LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  maintenanceType: LOOKUP_REF_SELECT,
  intervalDays: true,
  meterInterval: true,
  meterType: true,
  scheduleCron: true,
  assignedTeam: true,
  vendor: VENDOR_REF_SELECT,
  estimatedDurationHours: true,
  estimatedCost: true,
  reminderLeadDays: true,
  nextDueAt: true,
  isActive: true,
  version: true,
  createdBy: ACTOR_SELECT,
  createdAt: true,
  updatedAt: true,
  _count: { select: { assetLinks: true, tasks: true } },
} satisfies Prisma.MaintenancePlanSelect;

export const PLAN_DETAIL_SELECT = {
  ...PLAN_LIST_SELECT,
  tasks: {
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      sequence: true,
      name: true,
      description: true,
      isRequired: true,
    },
  },
  assetLinks: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, asset: ASSET_REF_SELECT },
  },
} satisfies Prisma.MaintenancePlanSelect;

export type PlanListRow = Prisma.MaintenancePlanGetPayload<{
  select: typeof PLAN_LIST_SELECT;
}>;
export type PlanDetailRow = Prisma.MaintenancePlanGetPayload<{
  select: typeof PLAN_DETAIL_SELECT;
}>;

export interface MaintenancePlanView
  extends Omit<
    PlanListRow,
    'meterInterval' | 'estimatedDurationHours' | 'estimatedCost' | '_count'
  > {
  meterInterval: string | null;
  estimatedDurationHours: string | null;
  /** Present only with maintenance.work_order.view_cost. */
  estimatedCost?: string | null;
  coveredAssetCount: number;
  taskCount: number;
}

export interface MaintenancePlanDetailView extends MaintenancePlanView {
  tasks: PlanDetailRow['tasks'];
  assets: Array<PlanDetailRow['assetLinks'][number]['asset']>;
}

export function toMaintenancePlanView(
  row: PlanListRow,
  includeCost: boolean,
): MaintenancePlanView {
  const { meterInterval, estimatedDurationHours, estimatedCost, _count, ...rest } =
    row;
  return {
    ...rest,
    meterInterval: str(meterInterval),
    estimatedDurationHours: str(estimatedDurationHours),
    ...(includeCost ? { estimatedCost: str(estimatedCost) } : {}),
    coveredAssetCount: _count.assetLinks,
    taskCount: _count.tasks,
  };
}

export function toMaintenancePlanDetailView(
  row: PlanDetailRow,
  includeCost: boolean,
): MaintenancePlanDetailView {
  const { tasks, assetLinks, ...head } = row;
  return {
    ...toMaintenancePlanView(head, includeCost),
    tasks,
    assets: assetLinks.map((link) => link.asset),
  };
}

// ---------------------------------------------------------------------------
// Work orders
// ---------------------------------------------------------------------------

export const WO_LIST_SELECT = {
  id: true,
  workOrderNumber: true,
  status: true,
  asset: ASSET_REF_SELECT,
  branch: REF_SELECT,
  plan: { select: { id: true, code: true, name: true } },
  type: LOOKUP_REF_SELECT,
  priority: LOOKUP_REF_SELECT,
  problemDescription: true,
  reportedBy: ACTOR_SELECT,
  reportedAt: true,
  assignedToEmployee: EMPLOYEE_REF_SELECT,
  assignedVendor: VENDOR_REF_SELECT,
  assignedTeam: true,
  scheduledStartAt: true,
  scheduledEndAt: true,
  actualStartAt: true,
  actualEndAt: true,
  holdReason: true,
  cancelReason: true,
  assetStatusBeforeWo: true,
  outcomeStatus: true,
  completionCondition: LOOKUP_REF_SELECT,
  nextMaintenanceAt: true,
  downtimeMinutes: true,
  laborCost: true,
  partsCost: true,
  externalCost: true,
  totalCost: true,
  completedBy: ACTOR_SELECT,
  verifiedBy: ACTOR_SELECT,
  verifiedAt: true,
  canceledBy: ACTOR_SELECT,
  canceledAt: true,
  version: true,
  createdBy: ACTOR_SELECT,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MaintenanceWorkOrderSelect;

export const WO_TASK_SELECT = {
  id: true,
  sequence: true,
  name: true,
  isRequired: true,
  isCompleted: true,
  completedAt: true,
  completedBy: ACTOR_SELECT,
  notes: true,
} satisfies Prisma.MaintenanceWorkOrderTaskSelect;

export const WO_PART_SELECT = {
  id: true,
  item: { select: { id: true, sku: true, name: true } },
  lot: { select: { id: true, lotNumber: true, expiryDate: true } },
  uom: REF_SELECT,
  quantity: true,
  baseQuantity: true,
  unitCost: true,
  totalCost: true,
  stockTransaction: {
    select: {
      id: true,
      transactionNumber: true,
      type: true,
      status: true,
      postedAt: true,
    },
  },
  notes: true,
  createdAt: true,
} satisfies Prisma.MaintenancePartSelect;

export const WO_DETAIL_SELECT = {
  ...WO_LIST_SELECT,
  diagnosis: true,
  actionTaken: true,
  resolution: true,
  completionMeterReading: true,
  tasks: { orderBy: { sequence: 'asc' }, select: WO_TASK_SELECT },
  parts: { orderBy: { createdAt: 'asc' }, select: WO_PART_SELECT },
} satisfies Prisma.MaintenanceWorkOrderSelect;

export type WoListRow = Prisma.MaintenanceWorkOrderGetPayload<{
  select: typeof WO_LIST_SELECT;
}>;
export type WoDetailRow = Prisma.MaintenanceWorkOrderGetPayload<{
  select: typeof WO_DETAIL_SELECT;
}>;
export type WoPartRow = Prisma.MaintenancePartGetPayload<{
  select: typeof WO_PART_SELECT;
}>;

export interface WorkOrderView
  extends Omit<
    WoListRow,
    'laborCost' | 'partsCost' | 'externalCost' | 'totalCost'
  > {
  /** Present only with maintenance.work_order.view_cost. */
  laborCost?: string | null;
  partsCost?: string | null;
  externalCost?: string | null;
  totalCost?: string | null;
}

export interface WorkOrderPartView
  extends Omit<
    WoPartRow,
    'quantity' | 'baseQuantity' | 'unitCost' | 'totalCost'
  > {
  quantity: string;
  baseQuantity: string | null;
  /** Present only with maintenance.work_order.view_cost. */
  unitCost?: string | null;
  totalCost?: string | null;
}

export interface WorkOrderDetailView extends WorkOrderView {
  diagnosis: string | null;
  actionTaken: string | null;
  resolution: string | null;
  completionMeterReading: string | null;
  tasks: WoDetailRow['tasks'];
  parts: WorkOrderPartView[];
}

export function toWorkOrderView(
  row: WoListRow,
  includeCost: boolean,
): WorkOrderView {
  const { laborCost, partsCost, externalCost, totalCost, ...rest } = row;
  return {
    ...rest,
    ...(includeCost
      ? {
          laborCost: str(laborCost),
          partsCost: str(partsCost),
          externalCost: str(externalCost),
          totalCost: str(totalCost),
        }
      : {}),
  };
}

export function toWorkOrderPartView(
  part: WoPartRow,
  includeCost: boolean,
): WorkOrderPartView {
  const { quantity, baseQuantity, unitCost, totalCost, ...rest } = part;
  return {
    ...rest,
    quantity: quantity.toString(),
    baseQuantity: str(baseQuantity),
    ...(includeCost
      ? { unitCost: str(unitCost), totalCost: str(totalCost) }
      : {}),
  };
}

export function toWorkOrderDetailView(
  row: WoDetailRow,
  includeCost: boolean,
): WorkOrderDetailView {
  const {
    diagnosis,
    actionTaken,
    resolution,
    completionMeterReading,
    tasks,
    parts,
    ...head
  } = row;
  return {
    ...toWorkOrderView(head, includeCost),
    diagnosis,
    actionTaken,
    resolution,
    completionMeterReading: str(completionMeterReading),
    tasks,
    parts: parts.map((part) => toWorkOrderPartView(part, includeCost)),
  };
}

// ---------------------------------------------------------------------------
// Meter readings
// ---------------------------------------------------------------------------

export const METER_READING_SELECT = {
  id: true,
  meterType: true,
  readingValue: true,
  readingAt: true,
  recordedBy: ACTOR_SELECT,
  notes: true,
  createdAt: true,
} satisfies Prisma.AssetMeterReadingSelect;

export type MeterReadingRow = Prisma.AssetMeterReadingGetPayload<{
  select: typeof METER_READING_SELECT;
}>;

export interface MeterReadingView extends Omit<MeterReadingRow, 'readingValue'> {
  readingValue: string;
}

export function toMeterReadingView(row: MeterReadingRow): MeterReadingView {
  return { ...row, readingValue: row.readingValue.toString() };
}
