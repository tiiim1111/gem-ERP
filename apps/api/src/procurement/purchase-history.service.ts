import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import {
  Prisma,
  PurchaseOrderStatus,
  StockDocumentStatus,
} from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated } from '../common/pagination';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { outstandingQuantity } from './purchase-order-rules';
import { canViewProcurementCost, toDateOnly } from './procurement-views';
import { QueryPurchaseHistoryDto } from './dto/query-purchase-history.dto';

/** One PO line with its full ordered/received/outstanding picture. */
export interface PurchaseHistoryRow {
  purchaseOrder: {
    id: string;
    poNumber: string;
    status: PurchaseOrderStatus;
    orderDate: string;
    currencyCode: string;
  };
  supplier: { id: string; code: string; legalName: string };
  branch: { id: string; code: string; name: string };
  warehouse: { id: string; code: string; name: string };
  item: { id: string; sku: string; name: string };
  uom: { id: string; code: string; name: string };
  lineNumber: number;
  orderedQuantity: string;
  receivedQuantity: string;
  outstandingQuantity: string;
  canceledQuantity: string;
  /** Posted return-to-supplier quantity attributed via receipts of this PO. */
  returnedQuantity: string;
  receipts: Array<{ id: string; receiptNumber: string; status: string }>;
  /** Present only with procurement.po.view_cost. */
  unitPrice?: string;
  discountAmount?: string;
  taxAmount?: string;
  lineTotal?: string;
}

const HISTORY_LINE_SELECT = {
  id: true,
  lineNumber: true,
  quantity: true,
  unitPrice: true,
  discountAmount: true,
  taxAmount: true,
  lineTotal: true,
  receivedQuantity: true,
  canceledQuantity: true,
  item: { select: { id: true, sku: true, name: true } },
  uom: { select: { id: true, code: true, name: true } },
  purchaseOrder: {
    select: {
      id: true,
      poNumber: true,
      status: true,
      orderDate: true,
      currencyCode: true,
      supplier: { select: { id: true, code: true, legalName: true } },
      branch: { select: { id: true, code: true, name: true } },
      destinationWarehouse: { select: { id: true, code: true, name: true } },
    },
  },
  goodsReceiptLines: {
    select: {
      goodsReceipt: {
        select: { id: true, receiptNumber: true, status: true },
      },
    },
  },
} satisfies Prisma.PurchaseOrderLineSelect;

/**
 * GET /purchase-history (api-outline 5.4): PO-line-grained search across
 * supplier / item / branch / warehouse / date / PO / receipt / status with
 * ordered vs received vs outstanding vs canceled vs returned quantities.
 * Costs appear only with procurement.po.view_cost.
 */
@Injectable()
export class PurchaseHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  async search(
    user: AuthUser,
    query: QueryPurchaseHistoryDto,
  ): Promise<Paginated<PurchaseHistoryRow>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    if (query.sort) {
      throw AppException.validation([
        {
          field: 'sort',
          message:
            'purchase-history is ordered by order date (newest first) and line number; sort is not configurable.',
        },
      ]);
    }
    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }

    const poWhere: Prisma.PurchaseOrderWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
    };
    if (query.supplierId) {
      poWhere.supplierId = query.supplierId;
    }
    if (query.warehouseId) {
      poWhere.destinationWarehouseId = query.warehouseId;
    }
    if (query.purchaseOrderId) {
      poWhere.id = query.purchaseOrderId;
    }
    if (query.number) {
      poWhere.poNumber = { contains: query.number, mode: 'insensitive' };
    }
    if (query.status) {
      poWhere.status = query.status;
    }
    if (query.from || query.to) {
      poWhere.orderDate = {
        ...(query.from ? { gte: this.toDate(query.from) } : {}),
        ...(query.to ? { lte: this.toDate(query.to) } : {}),
      };
    }

    const where: Prisma.PurchaseOrderLineWhereInput = {
      purchaseOrder: poWhere,
    };
    if (query.itemId) {
      where.itemId = query.itemId;
    }
    if (query.receiptNumber) {
      where.goodsReceiptLines = {
        some: {
          goodsReceipt: {
            receiptNumber: {
              contains: query.receiptNumber,
              mode: 'insensitive',
            },
          },
        },
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.purchaseOrderLine.findMany({
        where,
        orderBy: [
          { purchaseOrder: { orderDate: 'desc' } },
          { purchaseOrder: { poNumber: 'desc' } },
          { lineNumber: 'asc' },
        ],
        skip,
        take,
        select: HISTORY_LINE_SELECT,
      }),
      this.prisma.purchaseOrderLine.count({ where }),
    ]);

    const returnedByPoItem = await this.returnedQuantities(
      [...new Set(rows.map((row) => row.purchaseOrder.id))],
    );

    const includeCost = canViewProcurementCost(user);
    const data = rows.map((row) => {
      const receipts = [
        ...new Map(
          row.goodsReceiptLines.map((line) => [
            line.goodsReceipt.id,
            line.goodsReceipt,
          ]),
        ).values(),
      ];
      return {
        purchaseOrder: {
          id: row.purchaseOrder.id,
          poNumber: row.purchaseOrder.poNumber,
          status: row.purchaseOrder.status,
          orderDate: toDateOnly(row.purchaseOrder.orderDate) as string,
          currencyCode: row.purchaseOrder.currencyCode,
        },
        supplier: row.purchaseOrder.supplier,
        branch: row.purchaseOrder.branch,
        warehouse: row.purchaseOrder.destinationWarehouse,
        item: row.item,
        uom: row.uom,
        lineNumber: row.lineNumber,
        orderedQuantity: row.quantity.toString(),
        receivedQuantity: row.receivedQuantity.toString(),
        outstandingQuantity: outstandingQuantity(row).toString(),
        canceledQuantity: row.canceledQuantity.toString(),
        returnedQuantity: (
          returnedByPoItem.get(`${row.purchaseOrder.id}|${row.item.id}`) ??
          new Prisma.Decimal(0)
        ).toString(),
        receipts,
        ...(includeCost
          ? {
              unitPrice: row.unitPrice.toString(),
              discountAmount: row.discountAmount.toString(),
              taxAmount: row.taxAmount.toString(),
              lineTotal: row.lineTotal.toString(),
            }
          : {}),
      } satisfies PurchaseHistoryRow;
    });
    return paginated(data, page, pageSize, total);
  }

  /**
   * Posted return-to-supplier quantities keyed "poId|itemId". Returns are
   * attributed to a PO through the goods receipt they reference; returns
   * without a receipt link cannot be attributed and are excluded here.
   */
  private async returnedQuantities(
    poIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (poIds.length === 0) {
      return new Map();
    }
    const returnLines = await this.prisma.supplierReturnLine.findMany({
      where: {
        supplierReturn: {
          status: StockDocumentStatus.POSTED,
          goodsReceipt: { purchaseOrderId: { in: poIds } },
        },
      },
      select: {
        itemId: true,
        quantity: true,
        supplierReturn: {
          select: { goodsReceipt: { select: { purchaseOrderId: true } } },
        },
      },
    });
    const map = new Map<string, Prisma.Decimal>();
    for (const line of returnLines) {
      const poId = line.supplierReturn.goodsReceipt?.purchaseOrderId;
      if (!poId) {
        continue;
      }
      const key = `${poId}|${line.itemId}`;
      map.set(key, (map.get(key) ?? new Prisma.Decimal(0)).add(line.quantity));
    }
    return map;
  }

  private toDate(value: string): Date {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  }
}
