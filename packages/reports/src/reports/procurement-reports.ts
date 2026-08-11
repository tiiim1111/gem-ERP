/**
 * Procurement report definitions (api-outline §8): supplier purchase history
 * and PO status with outstanding quantities. Both require
 * procurement.po.view; monetary columns require procurement.po.view_cost.
 */
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import {
  branchWhere,
  dateOnly,
  dateRange,
  decimalString,
} from '../filters';
import type { ReportContext, ReportDefinition, ReportPrisma } from '../types';

const ZERO = new Prisma.Decimal(0);

// ---------------------------------------------------------------------------
// supplier-purchases
// ---------------------------------------------------------------------------

export const supplierPurchases: ReportDefinition = {
  key: 'supplier-purchases',
  title: 'Supplier purchase history',
  description:
    'Purchase orders per supplier with ordered vs received quantity totals and document values.',
  permission: PERMISSIONS.procurementPo.view,
  costPermission: PERMISSIONS.procurementPo.viewCost,
  filters: ['branchId', 'warehouseId', 'supplierId', 'status', 'from', 'to'],
  statusOptions: Object.values(PurchaseOrderStatus),
  columns: [
    { key: 'poNumber', header: 'PO no.', width: 1.1 },
    { key: 'supplier', header: 'Supplier', width: 1.5 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'warehouse', header: 'Warehouse' },
    { key: 'orderDate', header: 'Order date' },
    { key: 'expectedDeliveryDate', header: 'Expected' },
    { key: 'status', header: 'Status', width: 1.1 },
    { key: 'lineCount', header: 'Lines', width: 0.6 },
    { key: 'orderedQty', header: 'Ordered qty', width: 0.9 },
    { key: 'receivedQty', header: 'Received qty', width: 0.9 },
    { key: 'receiptCount', header: 'Receipts', width: 0.7 },
    { key: 'subtotal', header: 'Subtotal', cost: true, width: 0.9 },
    { key: 'grandTotal', header: 'Grand total', cost: true, width: 0.9 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const orderDate = dateRange(f);
    const where: Prisma.PurchaseOrderWhereInput = {
      branchId: branchWhere(ctx),
      ...(f.warehouseId ? { destinationWarehouseId: f.warehouseId } : {}),
      ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      ...(f.status ? { status: f.status as PurchaseOrderStatus } : {}),
      ...(orderDate ? { orderDate } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        orderBy: [{ orderDate: 'desc' }, { poNumber: 'desc' }],
        skip: ctx.skip,
        take: ctx.take,
        select: {
          poNumber: true,
          status: true,
          orderDate: true,
          expectedDeliveryDate: true,
          subtotal: true,
          grandTotal: true,
          supplier: { select: { legalName: true } },
          branch: { select: { code: true } },
          destinationWarehouse: { select: { name: true } },
          lines: { select: { quantity: true, receivedQuantity: true } },
          goodsReceipts: { select: { id: true } },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    return {
      rows: rows.map((po) => {
        const ordered = po.lines.reduce((sum, l) => sum.add(l.quantity), ZERO);
        const received = po.lines.reduce(
          (sum, l) => sum.add(l.receivedQuantity),
          ZERO,
        );
        return {
          poNumber: po.poNumber,
          supplier: po.supplier.legalName,
          branch: po.branch.code,
          warehouse: po.destinationWarehouse.name,
          orderDate: dateOnly(po.orderDate),
          expectedDeliveryDate: dateOnly(po.expectedDeliveryDate),
          status: po.status,
          lineCount: po.lines.length,
          orderedQty: ordered.toString(),
          receivedQty: received.toString(),
          receiptCount: po.goodsReceipts.length,
          ...(ctx.includeCost
            ? {
                subtotal: po.subtotal.toString(),
                grandTotal: po.grandTotal.toString(),
              }
            : {}),
        };
      }),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// po-status
// ---------------------------------------------------------------------------

export const poStatus: ReportDefinition = {
  key: 'po-status',
  title: 'PO status & outstanding quantities',
  description:
    'Purchase-order lines with ordered, received, canceled, and outstanding quantities.',
  permission: PERMISSIONS.procurementPo.view,
  costPermission: PERMISSIONS.procurementPo.viewCost,
  filters: [
    'branchId',
    'warehouseId',
    'supplierId',
    'itemId',
    'categoryId',
    'status',
    'from',
    'to',
  ],
  statusOptions: Object.values(PurchaseOrderStatus),
  columns: [
    { key: 'poNumber', header: 'PO no.', width: 1.1 },
    { key: 'poStatus', header: 'PO status', width: 1.1 },
    { key: 'supplier', header: 'Supplier', width: 1.4 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'orderDate', header: 'Order date' },
    { key: 'expectedDeliveryDate', header: 'Expected' },
    { key: 'itemSku', header: 'SKU' },
    { key: 'itemName', header: 'Item', width: 1.5 },
    { key: 'uom', header: 'UOM', width: 0.6 },
    { key: 'orderedQty', header: 'Ordered', width: 0.8 },
    { key: 'receivedQty', header: 'Received', width: 0.8 },
    { key: 'canceledQty', header: 'Canceled', width: 0.8 },
    { key: 'outstandingQty', header: 'Outstanding', width: 0.9 },
    { key: 'unitPrice', header: 'Unit price', cost: true, width: 0.8 },
    { key: 'lineTotal', header: 'Line total', cost: true, width: 0.9 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const orderDate = dateRange(f);
    const where: Prisma.PurchaseOrderLineWhereInput = {
      purchaseOrder: {
        branchId: branchWhere(ctx),
        ...(f.warehouseId ? { destinationWarehouseId: f.warehouseId } : {}),
        ...(f.supplierId ? { supplierId: f.supplierId } : {}),
        ...(f.status ? { status: f.status as PurchaseOrderStatus } : {}),
        ...(orderDate ? { orderDate } : {}),
      },
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.purchaseOrderLine.findMany({
        where,
        orderBy: [
          { purchaseOrder: { orderDate: 'desc' } },
          { purchaseOrder: { poNumber: 'desc' } },
          { lineNumber: 'asc' },
        ],
        skip: ctx.skip,
        take: ctx.take,
        select: {
          quantity: true,
          receivedQuantity: true,
          canceledQuantity: true,
          unitPrice: true,
          lineTotal: true,
          item: { select: { sku: true, name: true } },
          uom: { select: { code: true } },
          purchaseOrder: {
            select: {
              poNumber: true,
              status: true,
              orderDate: true,
              expectedDeliveryDate: true,
              supplier: { select: { legalName: true } },
              branch: { select: { code: true } },
            },
          },
        },
      }),
      prisma.purchaseOrderLine.count({ where }),
    ]);
    return {
      rows: rows.map((line) => {
        const outstanding = Prisma.Decimal.max(
          line.quantity.sub(line.receivedQuantity).sub(line.canceledQuantity),
          ZERO,
        );
        return {
          poNumber: line.purchaseOrder.poNumber,
          poStatus: line.purchaseOrder.status,
          supplier: line.purchaseOrder.supplier.legalName,
          branch: line.purchaseOrder.branch.code,
          orderDate: dateOnly(line.purchaseOrder.orderDate),
          expectedDeliveryDate: dateOnly(line.purchaseOrder.expectedDeliveryDate),
          itemSku: line.item.sku,
          itemName: line.item.name,
          uom: line.uom.code,
          orderedQty: line.quantity.toString(),
          receivedQty: line.receivedQuantity.toString(),
          canceledQty: line.canceledQuantity.toString(),
          outstandingQty: outstanding.toString(),
          ...(ctx.includeCost
            ? {
                unitPrice: decimalString(line.unitPrice),
                lineTotal: decimalString(line.lineTotal),
              }
            : {}),
        };
      }),
      total,
    };
  },
};
