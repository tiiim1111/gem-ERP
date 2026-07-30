import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';

const SORTABLE = {
  lotNumber: 'lotNumber',
  expiryDate: 'expiryDate',
  createdAt: 'createdAt',
};

export interface LotView {
  id: string;
  lotNumber: string;
  supplierLotNumber: string | null;
  barcode: string | null;
  manufactureDate: Date | null;
  expiryDate: Date | null;
  isExpired: boolean;
  isActive: boolean;
  item: { id: string; sku: string; name: string; isExpiryTracked: boolean };
  /** On-hand total across the caller's accessible branches. */
  onHand: string;
  createdAt: Date;
}

export interface LotDetailView extends LotView {
  notes: string | null;
  balances: Array<{
    warehouse: { id: string; code: string; name: string; branchId: string };
    location: { id: string; code: string; name: string } | null;
    onHand: string;
    reserved: string;
    inTransit: string;
  }>;
  /** Most recent ledger movements of this lot (accessible branches). */
  movements: Array<{
    id: string;
    transaction: { id: string; transactionNumber: string; type: string };
    warehouse: { id: string; code: string };
    quantityDelta: string;
    postedAt: Date;
  }>;
}

/**
 * Lot/batch reads (api-outline 4.2). FEFO consumption suggestions come from
 * `?fefo=true`: earliest expiry first, so the first lot listed is the one to
 * pick next (spec §13).
 */
@Injectable()
export class LotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  async list(user: AuthUser, query: {
    itemId?: string;
    warehouseId?: string;
    expiresBefore?: string;
    expiringWithinDays?: number;
    isActive?: boolean;
    fefo?: boolean;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<Paginated<LotView>> {
    const { page, pageSize, skip, take } = pageArgs(query);

    if (query.warehouseId) {
      const warehouse = await this.prisma.warehouse.findUnique({
        where: { id: query.warehouseId },
        select: { branchId: true },
      });
      if (!warehouse) {
        throw AppException.notFound('Warehouse not found.');
      }
      this.branchScope.assertBranchAccess(user, warehouse.branchId);
    }

    const expiryUpperBound = this.expiryUpperBound(query);
    const where: Prisma.InventoryLotWhereInput = {
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(expiryUpperBound ? { expiryDate: { lt: expiryUpperBound } } : {}),
      ...(query.warehouseId
        ? {
            stockBalances: {
              some: { warehouseId: query.warehouseId, onHandQty: { gt: 0 } },
            },
          }
        : {}),
    };

    const orderBy: Prisma.InventoryLotOrderByWithRelationInput[] = query.fefo
      ? [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }]
      : [
          parseSort(query.sort, SORTABLE, {
            field: 'createdAt',
            direction: 'desc',
          }) as Prisma.InventoryLotOrderByWithRelationInput,
        ];

    const branchFilter = this.branchScope.branchFilter(user);
    const [rows, total] = await Promise.all([
      this.prisma.inventoryLot.findMany({
        where,
        orderBy,
        skip,
        take,
        select: {
          id: true,
          lotNumber: true,
          supplierLotNumber: true,
          barcode: true,
          manufactureDate: true,
          expiryDate: true,
          isActive: true,
          createdAt: true,
          item: {
            select: { id: true, sku: true, name: true, isExpiryTracked: true },
          },
          stockBalances: {
            where: { branchId: branchFilter },
            select: { onHandQty: true },
          },
        },
      }),
      this.prisma.inventoryLot.count({ where }),
    ]);

    const today = this.todayUtc();
    return paginated(
      rows.map((row) => this.toView(row, today)),
      page,
      pageSize,
      total,
    );
  }

  async getById(user: AuthUser, id: string): Promise<LotDetailView> {
    const branchFilter = this.branchScope.branchFilter(user);
    const row = await this.prisma.inventoryLot.findUnique({
      where: { id },
      select: {
        id: true,
        lotNumber: true,
        supplierLotNumber: true,
        barcode: true,
        manufactureDate: true,
        expiryDate: true,
        isActive: true,
        notes: true,
        createdAt: true,
        item: {
          select: { id: true, sku: true, name: true, isExpiryTracked: true },
        },
        stockBalances: {
          where: { branchId: branchFilter },
          select: {
            onHandQty: true,
            reservedQty: true,
            inTransitQty: true,
            warehouse: {
              select: { id: true, code: true, name: true, branchId: true },
            },
            storageLocation: { select: { id: true, code: true, name: true } },
          },
        },
        stockLedgerEntries: {
          where: { branchId: branchFilter },
          orderBy: { postedAt: 'desc' },
          take: 100,
          select: {
            id: true,
            quantityDelta: true,
            postedAt: true,
            transaction: {
              select: { id: true, transactionNumber: true, type: true },
            },
            warehouse: { select: { id: true, code: true } },
          },
        },
      },
    });
    if (!row) {
      throw AppException.notFound('Lot not found.');
    }

    const today = this.todayUtc();
    const { notes, stockLedgerEntries, ...listRow } = row;
    return {
      ...this.toView(
        {
          ...listRow,
          stockBalances: row.stockBalances.map((balance) => ({
            onHandQty: balance.onHandQty,
          })),
        },
        today,
      ),
      notes,
      balances: row.stockBalances.map((balance) => ({
        warehouse: balance.warehouse,
        location: balance.storageLocation,
        onHand: balance.onHandQty.toString(),
        reserved: balance.reservedQty.toString(),
        inTransit: balance.inTransitQty.toString(),
      })),
      movements: stockLedgerEntries.map((entry) => ({
        id: entry.id,
        transaction: entry.transaction,
        warehouse: entry.warehouse,
        quantityDelta: entry.quantityDelta.toString(),
        postedAt: entry.postedAt,
      })),
    };
  }

  private toView(
    row: {
      id: string;
      lotNumber: string;
      supplierLotNumber: string | null;
      barcode: string | null;
      manufactureDate: Date | null;
      expiryDate: Date | null;
      isActive: boolean;
      createdAt: Date;
      item: { id: string; sku: string; name: string; isExpiryTracked: boolean };
      stockBalances: Array<{ onHandQty: Prisma.Decimal }>;
    },
    today: Date,
  ): LotView {
    const onHand = row.stockBalances.reduce(
      (sum, balance) => sum.add(balance.onHandQty),
      new Prisma.Decimal(0),
    );
    return {
      id: row.id,
      lotNumber: row.lotNumber,
      supplierLotNumber: row.supplierLotNumber,
      barcode: row.barcode,
      manufactureDate: row.manufactureDate,
      expiryDate: row.expiryDate,
      isExpired: Boolean(row.expiryDate && row.expiryDate < today),
      isActive: row.isActive,
      item: row.item,
      onHand: onHand.toString(),
      createdAt: row.createdAt,
    };
  }

  private expiryUpperBound(query: {
    expiresBefore?: string;
    expiringWithinDays?: number;
  }): Date | null {
    if (query.expiresBefore) {
      return new Date(`${query.expiresBefore.slice(0, 10)}T00:00:00.000Z`);
    }
    if (query.expiringWithinDays !== undefined) {
      const bound = this.todayUtc();
      bound.setUTCDate(bound.getUTCDate() + query.expiringWithinDays + 1);
      return bound;
    }
    return null;
  }

  private todayUtc(): Date {
    return new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  }
}
