/**
 * Inventory report definitions (api-outline §8): stock on hand, stock
 * movement (ledger), low stock / reorder, consumption, expiring lots. All
 * require inventory.view on top of report.view; costs/values only with
 * inventory.view_cost.
 */
import { Prisma, StockDocumentStatus, StockTransactionType } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import {
  branchWhere,
  dateOnly,
  dateRange,
  decimalString,
  fromDate,
  isoDateTime,
  toDate,
} from '../filters';
import type {
  ReportContext,
  ReportDefinition,
  ReportPrisma,
  ReportRow,
} from '../types';

const ZERO = new Prisma.Decimal(0);

function employeeName(
  employee: { firstName: string; lastName: string; displayName: string | null } | null,
): string | null {
  if (!employee) {
    return null;
  }
  return employee.displayName ?? `${employee.firstName} ${employee.lastName}`;
}

/** Item unit cost used for inventory valuation: last purchase, else standard. */
function valuationCost(item: {
  lastPurchaseCost: Prisma.Decimal | null;
  standardCost: Prisma.Decimal | null;
}): Prisma.Decimal | null {
  return item.lastPurchaseCost ?? item.standardCost;
}

// ---------------------------------------------------------------------------
// stock-on-hand
// ---------------------------------------------------------------------------

export const stockOnHand: ReportDefinition = {
  key: 'stock-on-hand',
  title: 'Stock on hand',
  description:
    'On-hand, reserved, in-transit, and available quantities by branch, warehouse, location, item, and lot.',
  permission: PERMISSIONS.inventory.view,
  costPermission: PERMISSIONS.inventory.viewCost,
  filters: ['branchId', 'warehouseId', 'categoryId', 'itemId'],
  columns: [
    { key: 'itemSku', header: 'SKU' },
    { key: 'itemName', header: 'Item', width: 1.6 },
    { key: 'category', header: 'Category' },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'warehouse', header: 'Warehouse' },
    { key: 'location', header: 'Location' },
    { key: 'lotNumber', header: 'Lot' },
    { key: 'lotExpiry', header: 'Lot expiry' },
    { key: 'uom', header: 'UOM', width: 0.6 },
    { key: 'onHandQty', header: 'On hand', width: 0.8 },
    { key: 'reservedQty', header: 'Reserved', width: 0.8 },
    { key: 'inTransitQty', header: 'In transit', width: 0.8 },
    { key: 'availableQty', header: 'Available', width: 0.8 },
    { key: 'unitCost', header: 'Unit cost', cost: true, width: 0.8 },
    { key: 'totalValue', header: 'Total value', cost: true, width: 0.9 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const where: Prisma.StockBalanceWhereInput = {
      branchId: branchWhere(ctx),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}),
      OR: [
        { onHandQty: { not: 0 } },
        { reservedQty: { not: 0 } },
        { inTransitQty: { not: 0 } },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.stockBalance.findMany({
        where,
        orderBy: [
          { item: { sku: 'asc' } },
          { warehouse: { code: 'asc' } },
          { storageLocationId: 'asc' },
          { lotId: 'asc' },
        ],
        skip: ctx.skip,
        take: ctx.take,
        select: {
          onHandQty: true,
          reservedQty: true,
          inTransitQty: true,
          item: {
            select: {
              sku: true,
              name: true,
              standardCost: true,
              lastPurchaseCost: true,
              category: { select: { name: true } },
              baseUom: { select: { code: true } },
            },
          },
          branch: { select: { code: true } },
          warehouse: { select: { name: true } },
          storageLocation: { select: { code: true } },
          lot: { select: { lotNumber: true, expiryDate: true } },
        },
      }),
      prisma.stockBalance.count({ where }),
    ]);
    return {
      rows: rows.map((balance) => {
        const cost = valuationCost(balance.item);
        return {
          itemSku: balance.item.sku,
          itemName: balance.item.name,
          category: balance.item.category?.name ?? null,
          branch: balance.branch.code,
          warehouse: balance.warehouse.name,
          location: balance.storageLocation?.code ?? null,
          lotNumber: balance.lot?.lotNumber ?? null,
          lotExpiry: dateOnly(balance.lot?.expiryDate ?? null),
          uom: balance.item.baseUom.code,
          onHandQty: balance.onHandQty.toString(),
          reservedQty: balance.reservedQty.toString(),
          inTransitQty: balance.inTransitQty.toString(),
          availableQty: balance.onHandQty.sub(balance.reservedQty).toString(),
          ...(ctx.includeCost
            ? {
                unitCost: decimalString(cost),
                totalValue: cost
                  ? balance.onHandQty.mul(cost).toDecimalPlaces(2).toString()
                  : null,
              }
            : {}),
        } satisfies ReportRow;
      }),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// stock-movement
// ---------------------------------------------------------------------------

export const stockMovement: ReportDefinition = {
  key: 'stock-movement',
  title: 'Stock movement ledger',
  description:
    'Immutable stock ledger entries: every posted quantity delta with its transaction, item, warehouse, location, and lot.',
  permission: PERMISSIONS.inventory.view,
  costPermission: PERMISSIONS.inventory.viewCost,
  filters: ['branchId', 'warehouseId', 'categoryId', 'itemId', 'from', 'to'],
  columns: [
    { key: 'postedAt', header: 'Posted at', width: 1.2 },
    { key: 'transactionNumber', header: 'Transaction', width: 1.2 },
    { key: 'type', header: 'Type', width: 1.3 },
    { key: 'itemSku', header: 'SKU' },
    { key: 'itemName', header: 'Item', width: 1.6 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'warehouse', header: 'Warehouse' },
    { key: 'location', header: 'Location' },
    { key: 'lotNumber', header: 'Lot' },
    { key: 'quantityDelta', header: 'Qty delta', width: 0.8 },
    { key: 'unitCost', header: 'Unit cost', cost: true, width: 0.8 },
    { key: 'totalCost', header: 'Total cost', cost: true, width: 0.9 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const posted = dateRange(f);
    const where: Prisma.StockLedgerEntryWhereInput = {
      branchId: branchWhere(ctx),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}),
      ...(posted ? { postedAt: posted } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockLedgerEntry.findMany({
        where,
        orderBy: { postedAt: 'desc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          postedAt: true,
          quantityDelta: true,
          unitCost: true,
          transaction: { select: { transactionNumber: true, type: true } },
          item: { select: { sku: true, name: true } },
          branch: { select: { code: true } },
          warehouse: { select: { name: true } },
          storageLocation: { select: { code: true } },
          lot: { select: { lotNumber: true } },
        },
      }),
      prisma.stockLedgerEntry.count({ where }),
    ]);
    return {
      rows: rows.map((entry) => ({
        postedAt: isoDateTime(entry.postedAt),
        transactionNumber: entry.transaction.transactionNumber,
        type: entry.transaction.type,
        itemSku: entry.item.sku,
        itemName: entry.item.name,
        branch: entry.branch.code,
        warehouse: entry.warehouse.name,
        location: entry.storageLocation?.code ?? null,
        lotNumber: entry.lot?.lotNumber ?? null,
        quantityDelta: entry.quantityDelta.toString(),
        ...(ctx.includeCost
          ? {
              unitCost: decimalString(entry.unitCost),
              totalCost: entry.unitCost
                ? entry.quantityDelta
                    .mul(entry.unitCost)
                    .toDecimalPlaces(2)
                    .toString()
                : null,
            }
          : {}),
      })),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// low-stock
// ---------------------------------------------------------------------------

export const lowStock: ReportDefinition = {
  key: 'low-stock',
  title: 'Low stock & reorder recommendations',
  description:
    'Items at or below their per-warehouse reorder level, with recommended order quantities.',
  permission: PERMISSIONS.inventory.view,
  filters: ['branchId', 'warehouseId', 'categoryId', 'itemId'],
  columns: [
    { key: 'itemSku', header: 'SKU' },
    { key: 'itemName', header: 'Item', width: 1.6 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'warehouse', header: 'Warehouse' },
    { key: 'uom', header: 'UOM', width: 0.6 },
    { key: 'onHandQty', header: 'On hand', width: 0.8 },
    { key: 'reservedQty', header: 'Reserved', width: 0.8 },
    { key: 'availableQty', header: 'Available', width: 0.8 },
    { key: 'reorderLevel', header: 'Reorder level', width: 0.9 },
    { key: 'shortfall', header: 'Shortfall', width: 0.8 },
    { key: 'reorderQuantity', header: 'Reorder qty', width: 0.9 },
    { key: 'recommendedOrderQty', header: 'Recommended order', width: 1 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const settings = await prisma.itemWarehouseSetting.findMany({
      where: {
        reorderLevel: { not: null },
        warehouse: {
          branchId: branchWhere(ctx),
          ...(f.warehouseId ? { id: f.warehouseId } : {}),
        },
        item: {
          isActive: true,
          ...(f.itemId ? { id: f.itemId } : {}),
          ...(f.categoryId ? { categoryId: f.categoryId } : {}),
        },
      },
      select: {
        itemId: true,
        warehouseId: true,
        reorderLevel: true,
        reorderQuantity: true,
        item: {
          select: {
            sku: true,
            name: true,
            baseUom: { select: { code: true } },
          },
        },
        warehouse: {
          select: { name: true, branch: { select: { code: true } } },
        },
      },
    });
    if (settings.length === 0) {
      return { rows: [], total: 0 };
    }
    const sums = await prisma.stockBalance.groupBy({
      by: ['itemId', 'warehouseId'],
      where: {
        warehouseId: { in: [...new Set(settings.map((s) => s.warehouseId))] },
        itemId: { in: [...new Set(settings.map((s) => s.itemId))] },
      },
      _sum: { onHandQty: true, reservedQty: true },
    });
    const sumByKey = new Map(
      sums.map((sum) => [`${sum.itemId}|${sum.warehouseId}`, sum._sum]),
    );
    const lowRows = settings
      .map((setting) => {
        const sum = sumByKey.get(`${setting.itemId}|${setting.warehouseId}`);
        const onHand = sum?.onHandQty ?? ZERO;
        const reserved = sum?.reservedQty ?? ZERO;
        const reorderLevel = setting.reorderLevel as Prisma.Decimal;
        return { setting, onHand, reserved, reorderLevel };
      })
      .filter(({ onHand, reorderLevel }) => onHand.lte(reorderLevel))
      .sort((a, b) => {
        const shortA = a.reorderLevel.sub(a.onHand);
        const shortB = b.reorderLevel.sub(b.onHand);
        return shortB.cmp(shortA) || a.setting.item.sku.localeCompare(b.setting.item.sku);
      });
    const page = lowRows.slice(ctx.skip, ctx.skip + ctx.take);
    return {
      rows: page.map(({ setting, onHand, reserved, reorderLevel }) => {
        const shortfall = reorderLevel.sub(onHand);
        return {
          itemSku: setting.item.sku,
          itemName: setting.item.name,
          branch: setting.warehouse.branch.code,
          warehouse: setting.warehouse.name,
          uom: setting.item.baseUom.code,
          onHandQty: onHand.toString(),
          reservedQty: reserved.toString(),
          availableQty: onHand.sub(reserved).toString(),
          reorderLevel: reorderLevel.toString(),
          shortfall: shortfall.toString(),
          reorderQuantity: decimalString(setting.reorderQuantity),
          recommendedOrderQty: (setting.reorderQuantity ?? shortfall).toString(),
        } satisfies ReportRow;
      }),
      total: lowRows.length,
    };
  },
};

// ---------------------------------------------------------------------------
// consumption
// ---------------------------------------------------------------------------

const ISSUE_TYPES = [
  StockTransactionType.ISSUE_TO_EMPLOYEE,
  StockTransactionType.ISSUE_TO_DEPARTMENT,
  StockTransactionType.MAINTENANCE_ISSUE,
] as const;

export const consumption: ReportDefinition = {
  key: 'consumption',
  title: 'Issuance & consumption',
  description:
    'Posted issue lines by employee, department, project, work order, and period.',
  permission: PERMISSIONS.inventory.view,
  costPermission: PERMISSIONS.inventory.viewCost,
  filters: [
    'branchId',
    'warehouseId',
    'categoryId',
    'itemId',
    'employeeId',
    'departmentId',
    'from',
    'to',
  ],
  columns: [
    { key: 'postedAt', header: 'Posted at', width: 1.2 },
    { key: 'transactionNumber', header: 'Transaction', width: 1.2 },
    { key: 'type', header: 'Type', width: 1.3 },
    { key: 'itemSku', header: 'SKU' },
    { key: 'itemName', header: 'Item', width: 1.5 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'quantity', header: 'Qty (base)', width: 0.8 },
    { key: 'uom', header: 'UOM', width: 0.6 },
    { key: 'employee', header: 'Employee', width: 1.2 },
    { key: 'department', header: 'Department' },
    { key: 'projectRef', header: 'Project' },
    { key: 'workOrderNumber', header: 'Work order' },
    { key: 'unitCost', header: 'Unit cost', cost: true, width: 0.8 },
    { key: 'totalCost', header: 'Total cost', cost: true, width: 0.9 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const posted = dateRange(f);
    const where: Prisma.StockTransactionLineWhereInput = {
      transaction: {
        status: StockDocumentStatus.POSTED,
        type: { in: [...ISSUE_TYPES] },
        branchId: branchWhere(ctx),
        ...(f.warehouseId ? { sourceWarehouseId: f.warehouseId } : {}),
        ...(f.employeeId ? { employeeId: f.employeeId } : {}),
        ...(f.departmentId ? { departmentId: f.departmentId } : {}),
        ...(posted ? { postedAt: posted } : {}),
      },
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.stockTransactionLine.findMany({
        where,
        orderBy: [{ transaction: { postedAt: 'desc' } }, { lineNumber: 'asc' }],
        skip: ctx.skip,
        take: ctx.take,
        select: {
          baseQuantity: true,
          unitCost: true,
          totalCost: true,
          item: {
            select: { sku: true, name: true, baseUom: { select: { code: true } } },
          },
          transaction: {
            select: {
              transactionNumber: true,
              type: true,
              postedAt: true,
              projectRef: true,
              branch: { select: { code: true } },
              employee: {
                select: { firstName: true, lastName: true, displayName: true },
              },
              department: { select: { name: true } },
              workOrder: { select: { workOrderNumber: true } },
            },
          },
        },
      }),
      prisma.stockTransactionLine.count({ where }),
    ]);
    return {
      rows: rows.map((line) => ({
        postedAt: isoDateTime(line.transaction.postedAt),
        transactionNumber: line.transaction.transactionNumber,
        type: line.transaction.type,
        itemSku: line.item.sku,
        itemName: line.item.name,
        branch: line.transaction.branch.code,
        quantity: line.baseQuantity.toString(),
        uom: line.item.baseUom.code,
        employee: employeeName(line.transaction.employee),
        department: line.transaction.department?.name ?? null,
        projectRef: line.transaction.projectRef,
        workOrderNumber: line.transaction.workOrder?.workOrderNumber ?? null,
        ...(ctx.includeCost
          ? {
              unitCost: decimalString(line.unitCost),
              totalCost: decimalString(line.totalCost),
            }
          : {}),
      })),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// expiring-lots
// ---------------------------------------------------------------------------

const DEFAULT_EXPIRY_WINDOW_DAYS = 30;

export const expiringLots: ReportDefinition = {
  key: 'expiring-lots',
  title: 'Expiring lots',
  description:
    'Lots with stock on hand expiring in the window (default: next 30 days; override with from/to).',
  permission: PERMISSIONS.inventory.view,
  filters: ['branchId', 'warehouseId', 'categoryId', 'itemId', 'from', 'to'],
  columns: [
    { key: 'lotNumber', header: 'Lot', width: 1.4 },
    { key: 'itemSku', header: 'SKU' },
    { key: 'itemName', header: 'Item', width: 1.6 },
    { key: 'expiryDate', header: 'Expiry' },
    { key: 'daysToExpiry', header: 'Days to expiry', width: 0.9 },
    { key: 'onHandQty', header: 'On hand', width: 0.8 },
    { key: 'uom', header: 'UOM', width: 0.6 },
    { key: 'warehouses', header: 'Warehouses', width: 1.4 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const now = new Date();
    const windowStart = f.from ? fromDate(f.from) : now;
    const windowEnd = f.to
      ? toDate(f.to)
      : new Date(now.getTime() + DEFAULT_EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const balanceScope: Prisma.StockBalanceWhereInput = {
      onHandQty: { gt: 0 },
      branchId: branchWhere(ctx),
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
    };
    const where: Prisma.InventoryLotWhereInput = {
      isActive: true,
      expiryDate: { gte: windowStart, lte: windowEnd },
      ...(f.itemId ? { itemId: f.itemId } : {}),
      ...(f.categoryId ? { item: { categoryId: f.categoryId } } : {}),
      stockBalances: { some: balanceScope },
    };
    const [lots, total] = await Promise.all([
      prisma.inventoryLot.findMany({
        where,
        orderBy: { expiryDate: 'asc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          lotNumber: true,
          expiryDate: true,
          item: {
            select: { sku: true, name: true, baseUom: { select: { code: true } } },
          },
          stockBalances: {
            where: balanceScope,
            select: {
              onHandQty: true,
              warehouse: { select: { code: true } },
            },
          },
        },
      }),
      prisma.inventoryLot.count({ where }),
    ]);
    const dayMs = 24 * 60 * 60 * 1000;
    return {
      rows: lots.map((lot) => {
        const onHand = lot.stockBalances.reduce(
          (sum, balance) => sum.add(balance.onHandQty),
          ZERO,
        );
        const expiry = lot.expiryDate as Date;
        return {
          lotNumber: lot.lotNumber,
          itemSku: lot.item.sku,
          itemName: lot.item.name,
          expiryDate: dateOnly(expiry),
          daysToExpiry: Math.ceil((expiry.getTime() - now.getTime()) / dayMs),
          onHandQty: onHand.toString(),
          uom: lot.item.baseUom.code,
          warehouses: [
            ...new Set(lot.stockBalances.map((b) => b.warehouse.code)),
          ].join(', '),
        } satisfies ReportRow;
      }),
      total,
    };
  },
};
