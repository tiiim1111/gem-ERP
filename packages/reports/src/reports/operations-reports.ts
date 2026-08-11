/**
 * Count-variance and transfer-status report definitions (api-outline §8).
 */
import {
  InventoryCountStatus,
  Prisma,
  TransferStatus,
} from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import {
  branchWhere,
  dateOnly,
  dateRange,
  effectiveBranchIds,
  isoDateTime,
} from '../filters';
import type { ReportContext, ReportDefinition, ReportPrisma } from '../types';

// ---------------------------------------------------------------------------
// count-variance
// ---------------------------------------------------------------------------

export const countVariance: ReportDefinition = {
  key: 'count-variance',
  title: 'Physical count variance',
  description:
    'Count lines whose counted quantity differs from the snapshot (or flagged missing/unexpected/misplaced), per session.',
  permission: PERMISSIONS.count.view,
  filters: ['branchId', 'warehouseId', 'itemId', 'status', 'from', 'to'],
  statusOptions: [
    InventoryCountStatus.IN_PROGRESS,
    InventoryCountStatus.REVIEW,
    InventoryCountStatus.COMPLETED,
  ],
  columns: [
    { key: 'countNumber', header: 'Count no.', width: 1.2 },
    { key: 'sessionStatus', header: 'Session status' },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'warehouse', header: 'Warehouse' },
    { key: 'itemSku', header: 'SKU' },
    { key: 'itemName', header: 'Item', width: 1.5 },
    { key: 'assetTag', header: 'Asset tag', width: 1.2 },
    { key: 'lotNumber', header: 'Lot' },
    { key: 'expectedQty', header: 'Expected', width: 0.8 },
    { key: 'countedQty', header: 'Counted', width: 0.8 },
    { key: 'recountQty', header: 'Recount', width: 0.8 },
    { key: 'varianceQty', header: 'Variance', width: 0.8 },
    { key: 'flag', header: 'Flag' },
    { key: 'countedAt', header: 'Counted at', width: 1.2 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const started = dateRange(f);
    const where: Prisma.InventoryCountLineWhereInput = {
      session: {
        branchId: branchWhere(ctx),
        status: f.status
          ? (f.status as InventoryCountStatus)
          : {
              in: [
                InventoryCountStatus.IN_PROGRESS,
                InventoryCountStatus.REVIEW,
                InventoryCountStatus.COMPLETED,
              ],
            },
        ...(started ? { startedAt: started } : {}),
      },
      ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
      ...(f.itemId ? { itemId: f.itemId } : {}),
      OR: [
        { varianceQuantity: { not: 0 } },
        { flag: { in: ['MISSING', 'UNEXPECTED', 'DUPLICATE', 'MISPLACED', 'VARIANCE'] } },
      ],
    };
    const [rows, total] = await Promise.all([
      prisma.inventoryCountLine.findMany({
        where,
        orderBy: [{ session: { countNumber: 'desc' } }, { createdAt: 'asc' }],
        skip: ctx.skip,
        take: ctx.take,
        select: {
          expectedQuantity: true,
          countedQuantity: true,
          recountQuantity: true,
          varianceQuantity: true,
          flag: true,
          countedAt: true,
          session: {
            select: {
              countNumber: true,
              status: true,
              branch: { select: { code: true } },
            },
          },
          warehouse: { select: { name: true } },
          item: { select: { sku: true, name: true } },
          asset: { select: { assetTag: true } },
          lot: { select: { lotNumber: true } },
        },
      }),
      prisma.inventoryCountLine.count({ where }),
    ]);
    return {
      rows: rows.map((line) => ({
        countNumber: line.session.countNumber,
        sessionStatus: line.session.status,
        branch: line.session.branch.code,
        warehouse: line.warehouse?.name ?? null,
        itemSku: line.item?.sku ?? null,
        itemName: line.item?.name ?? null,
        assetTag: line.asset?.assetTag ?? null,
        lotNumber: line.lot?.lotNumber ?? null,
        expectedQty: line.expectedQuantity?.toString() ?? null,
        countedQty: line.countedQuantity?.toString() ?? null,
        recountQty: line.recountQuantity?.toString() ?? null,
        varianceQty: line.varianceQuantity?.toString() ?? null,
        flag: line.flag,
        countedAt: isoDateTime(line.countedAt),
      })),
      total,
    };
  },
};

// ---------------------------------------------------------------------------
// transfer-status
// ---------------------------------------------------------------------------

export const transferStatus: ReportDefinition = {
  key: 'transfer-status',
  title: 'Transfer status & in-transit inventory',
  description:
    'Transfer documents with per-line dispatched/received/damaged/short totals; visible with source or destination branch access.',
  permission: PERMISSIONS.transfer.view,
  filters: ['branchId', 'status', 'from', 'to'],
  statusOptions: Object.values(TransferStatus),
  columns: [
    { key: 'transferNumber', header: 'Transfer no.', width: 1.2 },
    { key: 'type', header: 'Type' },
    { key: 'status', header: 'Status' },
    { key: 'sourceBranch', header: 'From branch', width: 0.8 },
    { key: 'sourceWarehouse', header: 'From warehouse' },
    { key: 'destinationBranch', header: 'To branch', width: 0.8 },
    { key: 'destinationWarehouse', header: 'To warehouse' },
    { key: 'transferDate', header: 'Transfer date' },
    { key: 'dispatchedAt', header: 'Dispatched', width: 1.2 },
    { key: 'completedAt', header: 'Completed', width: 1.2 },
    { key: 'lineCount', header: 'Lines', width: 0.6 },
    { key: 'quantityTotal', header: 'Qty total', width: 0.8 },
    { key: 'dispatchedTotal', header: 'Dispatched qty', width: 0.9 },
    { key: 'receivedTotal', header: 'Received qty', width: 0.9 },
    { key: 'damagedTotal', header: 'Damaged', width: 0.8 },
    { key: 'shortTotal', header: 'Short', width: 0.7 },
    { key: 'rejectedTotal', header: 'Rejected', width: 0.8 },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const scope = effectiveBranchIds(ctx);
    const transferDate = dateRange(f);
    const where: Prisma.TransferWhereInput = {
      // Cross-branch documents: visible with access to source OR destination.
      ...(scope === null
        ? {}
        : {
            OR: [
              { sourceBranchId: { in: scope } },
              { destinationBranchId: { in: scope } },
            ],
          }),
      ...(f.status ? { status: f.status as TransferStatus } : {}),
      ...(transferDate ? { transferDate } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.transfer.findMany({
        where,
        orderBy: { transferDate: 'desc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          transferNumber: true,
          type: true,
          status: true,
          transferDate: true,
          dispatchedAt: true,
          completedAt: true,
          sourceBranch: { select: { code: true } },
          sourceWarehouse: { select: { name: true } },
          destinationBranch: { select: { code: true } },
          destinationWarehouse: { select: { name: true } },
          lines: {
            select: {
              baseQuantity: true,
              quantity: true,
              assetId: true,
              dispatchedQuantity: true,
              receivedQuantity: true,
              damagedQuantity: true,
              shortQuantity: true,
              rejectedQuantity: true,
            },
          },
        },
      }),
      prisma.transfer.count({ where }),
    ]);
    const ZERO = new Prisma.Decimal(0);
    return {
      rows: rows.map((transfer) => {
        const totals = transfer.lines.reduce(
          (acc, line) => ({
            // An asset line counts as one unit.
            quantity: acc.quantity.add(
              line.baseQuantity ?? line.quantity ?? (line.assetId ? 1 : 0),
            ),
            dispatched: acc.dispatched.add(line.dispatchedQuantity),
            received: acc.received.add(line.receivedQuantity),
            damaged: acc.damaged.add(line.damagedQuantity),
            short: acc.short.add(line.shortQuantity),
            rejected: acc.rejected.add(line.rejectedQuantity),
          }),
          {
            quantity: ZERO,
            dispatched: ZERO,
            received: ZERO,
            damaged: ZERO,
            short: ZERO,
            rejected: ZERO,
          },
        );
        return {
          transferNumber: transfer.transferNumber,
          type: transfer.type,
          status: transfer.status,
          sourceBranch: transfer.sourceBranch.code,
          sourceWarehouse: transfer.sourceWarehouse.name,
          destinationBranch: transfer.destinationBranch.code,
          destinationWarehouse: transfer.destinationWarehouse?.name ?? null,
          transferDate: dateOnly(transfer.transferDate),
          dispatchedAt: isoDateTime(transfer.dispatchedAt),
          completedAt: isoDateTime(transfer.completedAt),
          lineCount: transfer.lines.length,
          quantityTotal: totals.quantity.toString(),
          dispatchedTotal: totals.dispatched.toString(),
          receivedTotal: totals.received.toString(),
          damagedTotal: totals.damaged.toString(),
          shortTotal: totals.short.toString(),
          rejectedTotal: totals.rejected.toString(),
        };
      }),
      total,
    };
  },
};
