import { PERMISSIONS } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/types/auth-request';
import { outstandingQuantity } from './purchase-order-rules';

/**
 * Shared select shapes + serializers for procurement documents. Lives outside
 * the services so the PO, receipt, return, and history services build
 * identical responses without circular dependencies.
 *
 * Cost/price fields (unit prices, discounts, taxes, totals, unit costs) are
 * serialized ONLY for callers holding procurement.po.view_cost
 * (api-outline §5 intro) — everyone else gets the document without money.
 */

const ACTOR_SELECT = { select: { id: true, displayName: true, email: true } };
const REF_SELECT = { select: { id: true, code: true, name: true } };
const SUPPLIER_REF_SELECT = {
  select: { id: true, code: true, legalName: true, tradeName: true },
};

export function canViewProcurementCost(user: AuthUser): boolean {
  return (
    user.isSuperAdmin ||
    user.permissions.includes(PERMISSIONS.procurementPo.viewCost)
  );
}

/** YYYY-MM-DD (values stored in @db.Date columns — no meaningful time). */
export function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const PO_LIST_SELECT = {
  id: true,
  poNumber: true,
  status: true,
  orderDate: true,
  expectedDeliveryDate: true,
  currencyCode: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  grandTotal: true,
  terms: true,
  notes: true,
  version: true,
  supplier: SUPPLIER_REF_SELECT,
  branch: REF_SELECT,
  destinationWarehouse: REF_SELECT,
  createdBy: ACTOR_SELECT,
  submittedAt: true,
  approvedBy: ACTOR_SELECT,
  approvedAt: true,
  canceledBy: ACTOR_SELECT,
  canceledAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PurchaseOrderSelect;

export const PO_LINE_SELECT = {
  id: true,
  lineNumber: true,
  item: {
    select: { id: true, sku: true, name: true, trackingMethod: true },
  },
  description: true,
  uom: REF_SELECT,
  quantity: true,
  unitPrice: true,
  discountAmount: true,
  taxAmount: true,
  lineTotal: true,
  receivedQuantity: true,
  canceledQuantity: true,
  notes: true,
} satisfies Prisma.PurchaseOrderLineSelect;

export const PO_DETAIL_SELECT = {
  ...PO_LIST_SELECT,
  lines: { orderBy: { lineNumber: 'asc' }, select: PO_LINE_SELECT },
  goodsReceipts: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      receiptNumber: true,
      status: true,
      receiptDate: true,
      postedAt: true,
    },
  },
} satisfies Prisma.PurchaseOrderSelect;

export type PoListRow = Prisma.PurchaseOrderGetPayload<{
  select: typeof PO_LIST_SELECT;
}>;
export type PoDetailRow = Prisma.PurchaseOrderGetPayload<{
  select: typeof PO_DETAIL_SELECT;
}>;
type PoLineRow = PoDetailRow['lines'][number];

export interface PurchaseOrderView
  extends Omit<
    PoListRow,
    | 'orderDate'
    | 'expectedDeliveryDate'
    | 'subtotal'
    | 'discountTotal'
    | 'taxTotal'
    | 'grandTotal'
  > {
  orderDate: string;
  expectedDeliveryDate: string | null;
  /** Present only with procurement.po.view_cost. */
  subtotal?: string;
  discountTotal?: string;
  taxTotal?: string;
  grandTotal?: string;
}

export interface PurchaseOrderLineView {
  id: string;
  lineNumber: number;
  item: PoLineRow['item'];
  description: string | null;
  uom: PoLineRow['uom'];
  quantity: string;
  receivedQuantity: string;
  canceledQuantity: string;
  outstandingQuantity: string;
  /** Present only with procurement.po.view_cost. */
  unitPrice?: string;
  discountAmount?: string;
  taxAmount?: string;
  lineTotal?: string;
  notes: string | null;
}

export interface PurchaseOrderDetailView extends PurchaseOrderView {
  lines: PurchaseOrderLineView[];
  goodsReceipts: Array<{
    id: string;
    receiptNumber: string;
    status: PoDetailRow['goodsReceipts'][number]['status'];
    receiptDate: string;
    postedAt: Date | null;
  }>;
}

export function toPurchaseOrderView(
  row: PoListRow,
  includeCost: boolean,
): PurchaseOrderView {
  const { subtotal, discountTotal, taxTotal, grandTotal, ...rest } = row;
  return {
    ...rest,
    orderDate: toDateOnly(row.orderDate) as string,
    expectedDeliveryDate: toDateOnly(row.expectedDeliveryDate),
    ...(includeCost
      ? {
          subtotal: subtotal.toString(),
          discountTotal: discountTotal.toString(),
          taxTotal: taxTotal.toString(),
          grandTotal: grandTotal.toString(),
        }
      : {}),
  };
}

export function toPurchaseOrderLineView(
  line: PoLineRow,
  includeCost: boolean,
): PurchaseOrderLineView {
  const { unitPrice, discountAmount, taxAmount, lineTotal, ...rest } = line;
  return {
    ...rest,
    quantity: line.quantity.toString(),
    receivedQuantity: line.receivedQuantity.toString(),
    canceledQuantity: line.canceledQuantity.toString(),
    outstandingQuantity: outstandingQuantity(line).toString(),
    ...(includeCost
      ? {
          unitPrice: unitPrice.toString(),
          discountAmount: discountAmount.toString(),
          taxAmount: taxAmount.toString(),
          lineTotal: lineTotal.toString(),
        }
      : {}),
  };
}

export function toPurchaseOrderDetailView(
  row: PoDetailRow,
  includeCost: boolean,
): PurchaseOrderDetailView {
  const { lines, goodsReceipts, ...head } = row;
  return {
    ...toPurchaseOrderView(head, includeCost),
    lines: lines.map((line) => toPurchaseOrderLineView(line, includeCost)),
    goodsReceipts: goodsReceipts.map((receipt) => ({
      ...receipt,
      receiptDate: toDateOnly(receipt.receiptDate) as string,
    })),
  };
}

// ---------------------------------------------------------------------------
// Goods receipts
// ---------------------------------------------------------------------------

export const GR_LIST_SELECT = {
  id: true,
  receiptNumber: true,
  status: true,
  receiptDate: true,
  supplierReference: true,
  notes: true,
  version: true,
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      status: true,
      supplier: SUPPLIER_REF_SELECT,
    },
  },
  branch: REF_SELECT,
  warehouse: REF_SELECT,
  createdBy: ACTOR_SELECT,
  postedBy: ACTOR_SELECT,
  postedAt: true,
  canceledBy: ACTOR_SELECT,
  canceledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GoodsReceiptSelect;

export const GR_DETAIL_SELECT = {
  ...GR_LIST_SELECT,
  lines: {
    orderBy: { lineNumber: 'asc' },
    select: {
      id: true,
      lineNumber: true,
      purchaseOrderLineId: true,
      item: {
        select: { id: true, sku: true, name: true, trackingMethod: true },
      },
      uom: REF_SELECT,
      receivedQuantity: true,
      baseQuantity: true,
      unitCost: true,
      serialNumbers: true,
      lot: { select: { id: true, lotNumber: true, expiryDate: true } },
      storageLocation: REF_SELECT,
      notes: true,
      assetsCreated: {
        select: { id: true, assetTag: true, serialNumber: true, status: true },
      },
    },
  },
  stockTransactions: {
    select: {
      id: true,
      transactionNumber: true,
      type: true,
      status: true,
      postedAt: true,
    },
  },
} satisfies Prisma.GoodsReceiptSelect;

export type GrListRow = Prisma.GoodsReceiptGetPayload<{
  select: typeof GR_LIST_SELECT;
}>;
export type GrDetailRow = Prisma.GoodsReceiptGetPayload<{
  select: typeof GR_DETAIL_SELECT;
}>;
type GrLineRow = GrDetailRow['lines'][number];

export interface GoodsReceiptView
  extends Omit<GrListRow, 'receiptDate'> {
  receiptDate: string;
}

export interface GoodsReceiptLineView {
  id: string;
  lineNumber: number;
  purchaseOrderLineId: string;
  item: GrLineRow['item'];
  uom: GrLineRow['uom'];
  receivedQuantity: string;
  baseQuantity: string;
  /** Present only with procurement.po.view_cost. */
  unitCost?: string | null;
  serialNumbers: string[];
  lot: GrLineRow['lot'];
  storageLocation: GrLineRow['storageLocation'];
  notes: string | null;
  assetsCreated: GrLineRow['assetsCreated'];
}

export interface GoodsReceiptDetailView extends GoodsReceiptView {
  lines: GoodsReceiptLineView[];
  stockTransactions: GrDetailRow['stockTransactions'];
}

export function toGoodsReceiptView(row: GrListRow): GoodsReceiptView {
  return { ...row, receiptDate: toDateOnly(row.receiptDate) as string };
}

export function toGoodsReceiptDetailView(
  row: GrDetailRow,
  includeCost: boolean,
): GoodsReceiptDetailView {
  const { lines, stockTransactions, ...head } = row;
  return {
    ...toGoodsReceiptView(head),
    lines: lines.map((line) => {
      const { unitCost, ...rest } = line;
      return {
        ...rest,
        receivedQuantity: line.receivedQuantity.toString(),
        baseQuantity: line.baseQuantity.toString(),
        ...(includeCost ? { unitCost: unitCost?.toString() ?? null } : {}),
      };
    }),
    stockTransactions,
  };
}

// ---------------------------------------------------------------------------
// Supplier returns
// ---------------------------------------------------------------------------

export const SUPPLIER_RETURN_LIST_SELECT = {
  id: true,
  returnNumber: true,
  status: true,
  returnDate: true,
  supplier: SUPPLIER_REF_SELECT,
  branch: REF_SELECT,
  warehouse: REF_SELECT,
  goodsReceipt: { select: { id: true, receiptNumber: true } },
  reason: { select: { id: true, category: true, code: true, name: true } },
  notes: true,
  version: true,
  createdBy: ACTOR_SELECT,
  approvedBy: ACTOR_SELECT,
  approvedAt: true,
  postedBy: ACTOR_SELECT,
  postedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SupplierReturnSelect;

export const SUPPLIER_RETURN_DETAIL_SELECT = {
  ...SUPPLIER_RETURN_LIST_SELECT,
  lines: {
    orderBy: { lineNumber: 'asc' },
    select: {
      id: true,
      lineNumber: true,
      item: {
        select: { id: true, sku: true, name: true, trackingMethod: true },
      },
      lot: { select: { id: true, lotNumber: true, expiryDate: true } },
      uom: REF_SELECT,
      storageLocation: REF_SELECT,
      quantity: true,
      baseQuantity: true,
      unitCost: true,
      notes: true,
    },
  },
} satisfies Prisma.SupplierReturnSelect;

export type SupplierReturnListRow = Prisma.SupplierReturnGetPayload<{
  select: typeof SUPPLIER_RETURN_LIST_SELECT;
}>;
export type SupplierReturnDetailRow = Prisma.SupplierReturnGetPayload<{
  select: typeof SUPPLIER_RETURN_DETAIL_SELECT;
}>;
type SupplierReturnLineRow = SupplierReturnDetailRow['lines'][number];

export interface SupplierReturnView
  extends Omit<SupplierReturnListRow, 'returnDate'> {
  returnDate: string;
}

export interface SupplierReturnLineView {
  id: string;
  lineNumber: number;
  item: SupplierReturnLineRow['item'];
  lot: SupplierReturnLineRow['lot'];
  uom: SupplierReturnLineRow['uom'];
  storageLocation: SupplierReturnLineRow['storageLocation'];
  quantity: string;
  baseQuantity: string;
  /** Present only with procurement.po.view_cost. */
  unitCost?: string | null;
  notes: string | null;
}

export interface SupplierReturnDetailView extends SupplierReturnView {
  lines: SupplierReturnLineView[];
}

export function toSupplierReturnView(
  row: SupplierReturnListRow,
): SupplierReturnView {
  return { ...row, returnDate: toDateOnly(row.returnDate) as string };
}

export function toSupplierReturnDetailView(
  row: SupplierReturnDetailRow,
  includeCost: boolean,
): SupplierReturnDetailView {
  const { lines, ...head } = row;
  return {
    ...toSupplierReturnView(head),
    lines: lines.map((line) => {
      const { unitCost, ...rest } = line;
      return {
        ...rest,
        quantity: line.quantity.toString(),
        baseQuantity: line.baseQuantity.toString(),
        ...(includeCost ? { unitCost: unitCost?.toString() ?? null } : {}),
      };
    }),
  };
}
