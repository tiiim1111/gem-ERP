import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { canViewInventoryCost } from './stock-transaction-views';
import {
  QueryLowStockDto,
  QueryStockBalancesDto,
  QueryStockLedgerDto,
} from './dto/query-reads.dto';

const BALANCE_SORTABLE = {
  updatedAt: 'updatedAt',
  onHandQty: 'onHandQty',
};

const LEDGER_SORTABLE = {
  postedAt: 'postedAt',
  createdAt: 'createdAt',
};

export interface StockBalanceView {
  id: string;
  item: { id: string; sku: string; name: string; baseUom: { id: string; code: string } };
  branch: { id: string; code: string; name: string };
  warehouse: { id: string; code: string; name: string };
  location: { id: string; code: string; name: string } | null;
  lot: { id: string; lotNumber: string; expiryDate: Date | null } | null;
  onHand: string;
  /** Always 0 until Phase 6 reservations — exposed for a stable contract. */
  reserved: string;
  /** available = onHand - reserved. */
  available: string;
  inTransit: string;
  updatedAt: Date;
}

export interface StockLedgerEntryView {
  id: string;
  transaction: { id: string; transactionNumber: string; type: string };
  item: { id: string; sku: string; name: string };
  lot: { id: string; lotNumber: string } | null;
  branch: { id: string; code: string };
  warehouse: { id: string; code: string; name: string };
  location: { id: string; code: string; name: string } | null;
  quantityDelta: string;
  /** Present only with inventory.view_cost. */
  unitCost?: string | null;
  postedAt: Date;
}

export interface LowStockRowView {
  item: { id: string; sku: string; name: string; baseUom: { id: string; code: string } };
  warehouse: { id: string; code: string; name: string; branchId: string };
  reorderLevel: string;
  reorderQuantity: string | null;
  onHand: string;
  reserved: string;
  available: string;
  inTransit: string;
  deficit: string;
  /** max(reorderQuantity, deficit) — never less than what is missing. */
  suggestedOrderQuantity: string;
}

export interface ItemStockRollupView {
  itemId: string;
  sku: string;
  name: string;
  baseUom: { id: string; code: string };
  totals: { onHand: string; reserved: string; available: string; inTransit: string };
  warehouses: Array<{
    warehouse: { id: string; code: string; name: string; branchId: string };
    onHand: string;
    reserved: string;
    available: string;
    inTransit: string;
  }>;
}

/**
 * Read-only projections over the stock ledger (api-outline 4.2). Balances and
 * the ledger are never mutated here — the posting engine is the single writer.
 */
@Injectable()
export class StockReadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  async listBalances(
    user: AuthUser,
    query: QueryStockBalancesDto,
  ): Promise<Paginated<StockBalanceView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, BALANCE_SORTABLE, {
      field: 'updatedAt',
      direction: 'desc',
    });
    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }

    const where: Prisma.StockBalanceWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.locationId ? { storageLocationId: query.locationId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.lotId ? { lotId: query.lotId } : {}),
      ...(query.nonZeroOnly
        ? { OR: [{ onHandQty: { not: 0 } }, { inTransitQty: { not: 0 } }] }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.stockBalance.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          onHandQty: true,
          reservedQty: true,
          inTransitQty: true,
          updatedAt: true,
          item: {
            select: {
              id: true,
              sku: true,
              name: true,
              baseUom: { select: { id: true, code: true } },
            },
          },
          branch: { select: { id: true, code: true, name: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          storageLocation: { select: { id: true, code: true, name: true } },
          lot: { select: { id: true, lotNumber: true, expiryDate: true } },
        },
      }),
      this.prisma.stockBalance.count({ where }),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        item: row.item,
        branch: row.branch,
        warehouse: row.warehouse,
        location: row.storageLocation,
        lot: row.lot,
        onHand: row.onHandQty.toString(),
        reserved: row.reservedQty.toString(),
        available: row.onHandQty.sub(row.reservedQty).toString(),
        inTransit: row.inTransitQty.toString(),
        updatedAt: row.updatedAt,
      })),
      page,
      pageSize,
      total,
    );
  }

  async listLedger(
    user: AuthUser,
    query: QueryStockLedgerDto,
  ): Promise<Paginated<StockLedgerEntryView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, LEDGER_SORTABLE, {
      field: 'postedAt',
      direction: 'desc',
    });
    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }

    const where: Prisma.StockLedgerEntryWhereInput = {
      branchId: query.branchId ?? this.branchScope.branchFilter(user),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      ...(query.lotId ? { lotId: query.lotId } : {}),
      ...(query.type ? { transaction: { type: query.type } } : {}),
      ...(query.from || query.to
        ? {
            postedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const includeCost = canViewInventoryCost(user);
    const [rows, total] = await Promise.all([
      this.prisma.stockLedgerEntry.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          quantityDelta: true,
          unitCost: true,
          postedAt: true,
          transaction: {
            select: { id: true, transactionNumber: true, type: true },
          },
          item: { select: { id: true, sku: true, name: true } },
          lot: { select: { id: true, lotNumber: true } },
          branch: { select: { id: true, code: true } },
          warehouse: { select: { id: true, code: true, name: true } },
          storageLocation: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.stockLedgerEntry.count({ where }),
    ]);

    return paginated(
      rows.map((row) => ({
        id: row.id,
        transaction: row.transaction,
        item: row.item,
        lot: row.lot,
        branch: row.branch,
        warehouse: row.warehouse,
        location: row.storageLocation,
        quantityDelta: row.quantityDelta.toString(),
        ...(includeCost ? { unitCost: row.unitCost?.toString() ?? null } : {}),
        postedAt: row.postedAt,
      })),
      page,
      pageSize,
      total,
    );
  }

  /**
   * Low-stock report (spec §13): available (on-hand minus reserved) below the
   * per-warehouse reorder level from item_warehouse_settings, with a reorder
   * quantity suggestion. Branch-scoped through the warehouse's branch.
   */
  async lowStock(
    user: AuthUser,
    query: QueryLowStockDto,
  ): Promise<Paginated<LowStockRowView>> {
    const { page, pageSize } = pageArgs(query);
    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }

    const settings = await this.prisma.itemWarehouseSetting.findMany({
      where: {
        reorderLevel: { not: null },
        item: { isActive: true },
        warehouse: {
          branchId: query.branchId ?? this.branchScope.branchFilter(user),
          ...(query.warehouseId ? { id: query.warehouseId } : {}),
        },
      },
      select: {
        reorderLevel: true,
        reorderQuantity: true,
        item: {
          select: {
            id: true,
            sku: true,
            name: true,
            baseUom: { select: { id: true, code: true } },
          },
        },
        warehouse: {
          select: { id: true, code: true, name: true, branchId: true },
        },
      },
    });
    if (settings.length === 0) {
      return paginated([], page, pageSize, 0);
    }

    const sums = await this.prisma.stockBalance.groupBy({
      by: ['itemId', 'warehouseId'],
      where: {
        OR: settings.map((setting) => ({
          itemId: setting.item.id,
          warehouseId: setting.warehouse.id,
        })),
      },
      _sum: { onHandQty: true, reservedQty: true, inTransitQty: true },
    });
    const sumByKey = new Map(
      sums.map((sum) => [`${sum.itemId}|${sum.warehouseId}`, sum._sum]),
    );

    const zero = new Prisma.Decimal(0);
    const rows: LowStockRowView[] = [];
    for (const setting of settings) {
      const reorderLevel = setting.reorderLevel as Prisma.Decimal;
      const sum = sumByKey.get(`${setting.item.id}|${setting.warehouse.id}`);
      const onHand = sum?.onHandQty ?? zero;
      const reserved = sum?.reservedQty ?? zero;
      const inTransit = sum?.inTransitQty ?? zero;
      const available = onHand.sub(reserved);
      if (available.gte(reorderLevel)) {
        continue;
      }
      const deficit = reorderLevel.sub(available);
      const suggested = setting.reorderQuantity?.gte(deficit)
        ? setting.reorderQuantity
        : deficit;
      rows.push({
        item: setting.item,
        warehouse: setting.warehouse,
        reorderLevel: reorderLevel.toString(),
        reorderQuantity: setting.reorderQuantity?.toString() ?? null,
        onHand: onHand.toString(),
        reserved: reserved.toString(),
        available: available.toString(),
        inTransit: inTransit.toString(),
        deficit: deficit.toString(),
        suggestedOrderQuantity: suggested.toString(),
      });
    }
    rows.sort((a, b) =>
      new Prisma.Decimal(b.deficit).comparedTo(new Prisma.Decimal(a.deficit)),
    );

    const start = (page - 1) * pageSize;
    return paginated(
      rows.slice(start, start + pageSize),
      page,
      pageSize,
      rows.length,
    );
  }

  /** Per-item balance rollup across the caller's accessible warehouses. */
  async itemStock(user: AuthUser, itemId: string): Promise<ItemStockRollupView> {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        sku: true,
        name: true,
        baseUom: { select: { id: true, code: true } },
      },
    });
    if (!item) {
      throw AppException.notFound('Item not found.');
    }

    const sums = await this.prisma.stockBalance.groupBy({
      by: ['warehouseId'],
      where: { itemId, branchId: this.branchScope.branchFilter(user) },
      _sum: { onHandQty: true, reservedQty: true, inTransitQty: true },
    });
    const warehouses = await this.prisma.warehouse.findMany({
      where: { id: { in: sums.map((sum) => sum.warehouseId) } },
      select: { id: true, code: true, name: true, branchId: true },
    });
    const warehouseById = new Map(warehouses.map((wh) => [wh.id, wh]));

    const zero = new Prisma.Decimal(0);
    let totalOnHand = zero;
    let totalReserved = zero;
    let totalInTransit = zero;
    const perWarehouse = sums
      .filter((sum) => warehouseById.has(sum.warehouseId))
      .map((sum) => {
        const onHand = sum._sum.onHandQty ?? zero;
        const reserved = sum._sum.reservedQty ?? zero;
        const inTransit = sum._sum.inTransitQty ?? zero;
        totalOnHand = totalOnHand.add(onHand);
        totalReserved = totalReserved.add(reserved);
        totalInTransit = totalInTransit.add(inTransit);
        return {
          warehouse: warehouseById.get(sum.warehouseId) as {
            id: string;
            code: string;
            name: string;
            branchId: string;
          },
          onHand: onHand.toString(),
          reserved: reserved.toString(),
          available: onHand.sub(reserved).toString(),
          inTransit: inTransit.toString(),
        };
      });

    return {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      baseUom: item.baseUom,
      totals: {
        onHand: totalOnHand.toString(),
        reserved: totalReserved.toString(),
        available: totalOnHand.sub(totalReserved).toString(),
        inTransit: totalInTransit.toString(),
      },
      warehouses: perWarehouse,
    };
  }
}
