import { Prisma } from '@prisma/client';
import {
  computeVarianceQuantity,
  effectiveCountedQuantity,
  shouldMaskExpected,
} from './count-rules';

/**
 * Response shaping for count sessions. Quantities serialize as strings;
 * blind sessions mask expected/variance until counting closes (REVIEW).
 */

const ACTOR_SELECT = { select: { id: true, displayName: true, email: true } };

export const COUNT_SESSION_LIST_SELECT = {
  id: true,
  countNumber: true,
  type: true,
  status: true,
  isBlind: true,
  branch: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  storageLocation: { select: { id: true, code: true, name: true } },
  category: { select: { id: true, code: true, name: true } },
  scopeItemIds: true,
  snapshotAt: true,
  startedAt: true,
  completedAt: true,
  adjustmentsCreatedAt: true,
  cancelReason: true,
  notes: true,
  version: true,
  createdBy: ACTOR_SELECT,
  approvedBy: ACTOR_SELECT,
  approvedAt: true,
  canceledBy: ACTOR_SELECT,
  canceledAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { lines: true, adjustmentTransactions: true } },
} satisfies Prisma.InventoryCountSessionSelect;

export const COUNT_LINE_SELECT = {
  id: true,
  itemId: true,
  assetId: true,
  lotId: true,
  warehouseId: true,
  storageLocationId: true,
  uomId: true,
  expectedQuantity: true,
  countedQuantity: true,
  recountQuantity: true,
  varianceQuantity: true,
  flag: true,
  assetFound: true,
  locationConfirmed: true,
  recountRequested: true,
  notes: true,
  countedAt: true,
  item: { select: { id: true, sku: true, name: true } },
  asset: {
    select: { id: true, assetTag: true, serialNumber: true, status: true },
  },
  lot: { select: { id: true, lotNumber: true, expiryDate: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  storageLocation: { select: { id: true, code: true, name: true } },
  uom: { select: { id: true, code: true, name: true } },
  condition: { select: { id: true, code: true, name: true } },
  countedBy: ACTOR_SELECT,
} satisfies Prisma.InventoryCountLineSelect;

export const COUNT_SESSION_DETAIL_SELECT = {
  ...COUNT_SESSION_LIST_SELECT,
  lines: {
    orderBy: { createdAt: 'asc' as const },
    select: COUNT_LINE_SELECT,
  },
  adjustmentTransactions: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      transactionNumber: true,
      type: true,
      status: true,
      sourceWarehouseId: true,
      destinationWarehouseId: true,
    },
  },
} satisfies Prisma.InventoryCountSessionSelect;

type SessionListRow = Prisma.InventoryCountSessionGetPayload<{
  select: typeof COUNT_SESSION_LIST_SELECT;
}>;
type SessionDetailRow = Prisma.InventoryCountSessionGetPayload<{
  select: typeof COUNT_SESSION_DETAIL_SELECT;
}>;
export type CountLineRow = Prisma.InventoryCountLineGetPayload<{
  select: typeof COUNT_LINE_SELECT;
}>;

function decimal(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

export function toCountSessionView(row: SessionListRow) {
  return {
    id: row.id,
    countNumber: row.countNumber,
    type: row.type,
    status: row.status,
    blind: row.isBlind,
    branch: row.branch,
    warehouse: row.warehouse,
    storageLocation: row.storageLocation,
    category: row.category,
    scopeItemIds: row.scopeItemIds,
    snapshotAt: row.snapshotAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    adjustmentsCreatedAt: row.adjustmentsCreatedAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    notes: row.notes,
    version: row.version,
    lineCount: row._count.lines,
    adjustmentCount: row._count.adjustmentTransactions,
    createdBy: row.createdBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    canceledBy: row.canceledBy,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export type CountSessionView = ReturnType<typeof toCountSessionView>;

export function toCountLineView(line: CountLineRow, mask: boolean) {
  const variance =
    line.varianceQuantity ??
    (line.itemId ? computeVarianceQuantity(line) : null);
  return {
    id: line.id,
    kind: line.assetId ? ('asset' as const) : ('item' as const),
    item: line.item,
    asset: line.asset,
    lot: line.lot,
    warehouse: line.warehouse,
    storageLocation: line.storageLocation,
    uom: line.uom,
    expectedQuantity: mask ? null : decimal(line.expectedQuantity),
    countedQuantity: decimal(line.countedQuantity),
    recountQuantity: decimal(line.recountQuantity),
    effectiveQuantity: decimal(effectiveCountedQuantity(line)),
    varianceQuantity: mask ? null : decimal(variance),
    flag: line.flag,
    assetFound: line.assetFound,
    locationConfirmed: line.locationConfirmed,
    condition: line.condition,
    recountRequested: line.recountRequested,
    notes: line.notes,
    countedBy: line.countedBy,
    countedAt: line.countedAt?.toISOString() ?? null,
  };
}
export type CountLineView = ReturnType<typeof toCountLineView>;

export function toCountSessionDetailView(row: SessionDetailRow) {
  const mask = shouldMaskExpected(row);
  return {
    ...toCountSessionView(row),
    lines: row.lines.map((line) => toCountLineView(line, mask)),
    adjustments: row.adjustmentTransactions.map((txn) => ({
      id: txn.id,
      transactionNumber: txn.transactionNumber,
      type: txn.type,
      status: txn.status,
      warehouseId: txn.sourceWarehouseId ?? txn.destinationWarehouseId,
    })),
  };
}
export type CountSessionDetailView = ReturnType<typeof toCountSessionDetailView>;
