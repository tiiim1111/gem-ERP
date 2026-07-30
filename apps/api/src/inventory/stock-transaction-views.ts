import { PERMISSIONS } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/types/auth-request';

/**
 * Shared select shapes + serializers for stock transaction documents. Lives
 * outside the services so StockTransactionsService and StockPostingService can
 * both build identical responses without a circular dependency.
 *
 * Cost fields (unitCost/totalCost on lines and ledger entries) are serialized
 * ONLY for callers holding inventory.view_cost (api-outline 4.1).
 */

const ACTOR_SELECT = { select: { id: true, displayName: true, email: true } };

export const STOCK_TXN_LIST_SELECT = {
  id: true,
  transactionNumber: true,
  type: true,
  status: true,
  transactionDate: true,
  branch: { select: { id: true, code: true, name: true } },
  sourceBranch: { select: { id: true, code: true, name: true } },
  destinationBranch: { select: { id: true, code: true, name: true } },
  sourceWarehouse: { select: { id: true, code: true, name: true } },
  destinationWarehouse: { select: { id: true, code: true, name: true } },
  employee: {
    select: { id: true, employeeNumber: true, firstName: true, lastName: true },
  },
  department: { select: { id: true, code: true, name: true } },
  supplier: { select: { id: true, code: true, legalName: true } },
  reason: { select: { id: true, category: true, code: true, name: true } },
  transferId: true,
  workOrderId: true,
  projectRef: true,
  notes: true,
  reversalOfId: true,
  version: true,
  createdBy: ACTOR_SELECT,
  submittedAt: true,
  approvedBy: ACTOR_SELECT,
  approvedAt: true,
  postedBy: ACTOR_SELECT,
  postedAt: true,
  canceledBy: ACTOR_SELECT,
  canceledAt: true,
  reversedBy: ACTOR_SELECT,
  reversedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StockTransactionSelect;

export const STOCK_TXN_DETAIL_SELECT = {
  ...STOCK_TXN_LIST_SELECT,
  lines: {
    orderBy: { lineNumber: 'asc' },
    select: {
      id: true,
      lineNumber: true,
      item: {
        select: { id: true, sku: true, name: true, trackingMethod: true },
      },
      lot: { select: { id: true, lotNumber: true, expiryDate: true } },
      sourceLocation: { select: { id: true, code: true, name: true } },
      destinationLocation: { select: { id: true, code: true, name: true } },
      enteredUom: { select: { id: true, code: true, name: true } },
      enteredQuantity: true,
      baseQuantity: true,
      unitCost: true,
      totalCost: true,
      notes: true,
    },
  },
  ledgerEntries: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      transactionLineId: true,
      itemId: true,
      lotId: true,
      warehouseId: true,
      storageLocationId: true,
      quantityDelta: true,
      unitCost: true,
      postedAt: true,
    },
  },
  reversals: {
    select: { id: true, transactionNumber: true, status: true, postedAt: true },
  },
  reversalOf: { select: { id: true, transactionNumber: true } },
} satisfies Prisma.StockTransactionSelect;

export type StockTxnListRow = Prisma.StockTransactionGetPayload<{
  select: typeof STOCK_TXN_LIST_SELECT;
}>;
export type StockTxnDetailRow = Prisma.StockTransactionGetPayload<{
  select: typeof STOCK_TXN_DETAIL_SELECT;
}>;

export interface StockTransactionView
  extends Omit<StockTxnListRow, 'transactionDate'> {
  transactionDate: string;
}

export interface StockTransactionLineView {
  id: string;
  lineNumber: number;
  item: StockTxnDetailRow['lines'][number]['item'];
  lot: StockTxnDetailRow['lines'][number]['lot'];
  sourceLocation: StockTxnDetailRow['lines'][number]['sourceLocation'];
  destinationLocation: StockTxnDetailRow['lines'][number]['destinationLocation'];
  enteredUom: StockTxnDetailRow['lines'][number]['enteredUom'];
  enteredQuantity: string;
  baseQuantity: string;
  /** Present only with inventory.view_cost. */
  unitCost?: string | null;
  totalCost?: string | null;
  notes: string | null;
}

export interface StockLedgerEntryRefView {
  id: string;
  transactionLineId: string | null;
  itemId: string;
  lotId: string | null;
  warehouseId: string;
  storageLocationId: string | null;
  quantityDelta: string;
  /** Present only with inventory.view_cost. */
  unitCost?: string | null;
  postedAt: Date;
}

export interface StockTransactionDetailView extends StockTransactionView {
  lines: StockTransactionLineView[];
  ledgerEntries: StockLedgerEntryRefView[];
  reversals: StockTxnDetailRow['reversals'];
  reversalOf: StockTxnDetailRow['reversalOf'];
}

export function canViewInventoryCost(user: AuthUser): boolean {
  return (
    user.isSuperAdmin ||
    user.permissions.includes(PERMISSIONS.inventory.viewCost)
  );
}

/** YYYY-MM-DD (dates are @db.Date columns — no meaningful time part). */
function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function toStockTransactionView(
  row: StockTxnListRow,
): StockTransactionView {
  return { ...row, transactionDate: toDateOnly(row.transactionDate) };
}

export function toStockTransactionDetailView(
  row: StockTxnDetailRow,
  includeCost: boolean,
): StockTransactionDetailView {
  const { lines, ledgerEntries, reversals, reversalOf, ...head } = row;
  return {
    ...toStockTransactionView(head),
    lines: lines.map((line) => {
      const { unitCost, totalCost, ...rest } = line;
      return {
        ...rest,
        enteredQuantity: line.enteredQuantity.toString(),
        baseQuantity: line.baseQuantity.toString(),
        ...(includeCost
          ? {
              unitCost: unitCost?.toString() ?? null,
              totalCost: totalCost?.toString() ?? null,
            }
          : {}),
      };
    }),
    ledgerEntries: ledgerEntries.map((entry) => {
      const { unitCost, ...rest } = entry;
      return {
        ...rest,
        quantityDelta: entry.quantityDelta.toString(),
        ...(includeCost ? { unitCost: unitCost?.toString() ?? null } : {}),
      };
    }),
    reversals,
    reversalOf,
  };
}
