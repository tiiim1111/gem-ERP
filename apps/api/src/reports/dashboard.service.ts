import { Injectable } from '@nestjs/common';
import {
  AssetLifecycleStatus,
  GoodsReceiptStatus,
  MaintenanceWorkOrderStatus,
  Prisma,
  PurchaseOrderStatus,
  TransferStatus,
} from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';

const ZERO = new Prisma.Decimal(0);

const OPEN_WO_STATUSES: MaintenanceWorkOrderStatus[] = [
  MaintenanceWorkOrderStatus.OPEN,
  MaintenanceWorkOrderStatus.ASSIGNED,
  MaintenanceWorkOrderStatus.SCHEDULED,
  MaintenanceWorkOrderStatus.IN_PROGRESS,
  MaintenanceWorkOrderStatus.ON_HOLD,
  MaintenanceWorkOrderStatus.AWAITING_PARTS,
  MaintenanceWorkOrderStatus.AWAITING_VENDOR,
];

const OPEN_PO_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.PENDING_APPROVAL,
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

/** 30-day look-ahead window for warranty and lot expirations (contract §8). */
const EXPIRY_WINDOW_DAYS = 30;
/** Look-ahead for "maintenance due soon". */
const MAINTENANCE_DUE_WINDOW_DAYS = 7;

export interface DashboardSummaryView {
  assets: {
    total: number;
    byStatus: Record<string, number>;
    byCondition: Array<{ condition: string | null; count: number }>;
    assigned: number;
    available: number;
    /** Present only with asset.view_cost: total acquisition value (non-disposed). */
    acquisitionValue?: string;
  };
  inventory: {
    skuCount: number;
    skuByCategory: Record<string, number>;
    lowStockCount: number;
    outOfStockCount: number;
    /** Present only with inventory.view_cost: on-hand valuation. */
    inventoryValue?: string;
  };
  transfers: { pendingApproval: number; inTransit: number };
  approvals: { pending: number; assignedToMe: number };
  maintenance: {
    openWorkOrders: number;
    overdueWorkOrders: number;
    assetsDueSoon: number;
    assetsOverdue: number;
  };
  expirations: {
    warrantiesExpiring: number;
    lotsExpiring: number;
    windowDays: number;
  };
  procurement: { openPurchaseOrders: number; draftReceipts: number };
  recentTransactions: Array<{
    id: string;
    transactionNumber: string;
    type: string;
    status: string;
    transactionDate: string;
    branch: string;
    createdAt: string;
  }>;
}

/**
 * GET /dashboard/summary (api-outline §8): every KPI computed from live
 * queries — nothing hardcoded. Branch-scoped to the caller's branches;
 * value widgets appear only with the relevant *.view_cost permission.
 * Queries are batched groupBy/count/aggregate calls — no per-row loops.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  async summary(user: AuthUser): Promise<DashboardSummaryView> {
    const branchIn = this.branchScope.branchFilter(user);
    const scopeIds = this.branchScope.branchIdsFor(user);
    const now = new Date();
    const expiryWindowEnd = this.addDays(now, EXPIRY_WINDOW_DAYS);
    const maintenanceWindowEnd = this.addDays(now, MAINTENANCE_DUE_WINDOW_DAYS);

    const canSeeInventoryValue =
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.inventory.viewCost);
    const canSeeAssetValue =
      user.isSuperAdmin || user.permissions.includes(PERMISSIONS.asset.viewCost);

    const liveAssetWhere: Prisma.AssetWhereInput = {
      archivedAt: null,
      branchId: branchIn,
    };
    const transferScope: Prisma.TransferWhereInput =
      scopeIds === null
        ? {}
        : {
            OR: [
              { sourceBranchId: { in: scopeIds } },
              { destinationBranchId: { in: scopeIds } },
            ],
          };

    const [
      assetsByStatus,
      assetsByCondition,
      skuByCategory,
      reorderSettings,
      transfersByStatus,
      approvalsPending,
      approvalsAssignedToMe,
      openWorkOrders,
      overdueWorkOrders,
      assetsDueSoon,
      assetsOverdue,
      warrantiesExpiring,
      lotsExpiringBalances,
      openPurchaseOrders,
      draftReceipts,
      recentTransactions,
      acquisitionValueAggregate,
    ] = await Promise.all([
      this.prisma.asset.groupBy({
        by: ['status'],
        where: liveAssetWhere,
        _count: { _all: true },
      }),
      this.prisma.asset.groupBy({
        by: ['conditionId'],
        where: liveAssetWhere,
        _count: { _all: true },
      }),
      this.prisma.item.groupBy({
        by: ['businessCategory'],
        where: { isActive: true, archivedAt: null },
        _count: { _all: true },
      }),
      this.prisma.itemWarehouseSetting.findMany({
        where: {
          reorderLevel: { not: null },
          item: { isActive: true },
          warehouse: { branchId: branchIn },
        },
        select: { itemId: true, warehouseId: true, reorderLevel: true },
      }),
      this.prisma.transfer.groupBy({
        by: ['status'],
        where: {
          ...transferScope,
          status: { in: [TransferStatus.PENDING_APPROVAL, TransferStatus.IN_TRANSIT] },
        },
        _count: { _all: true },
      }),
      this.prisma.approvalRequest.count({
        where: {
          status: 'PENDING',
          ...(scopeIds === null
            ? {}
            : { OR: [{ branchId: { in: scopeIds } }, { branchId: null }] }),
        },
      }),
      this.prisma.approvalRequest.count({
        where: {
          status: 'PENDING',
          steps: {
            some: { status: 'PENDING', assigneeUserIds: { has: user.id } },
          },
        },
      }),
      this.prisma.maintenanceWorkOrder.count({
        where: { branchId: branchIn, status: { in: OPEN_WO_STATUSES } },
      }),
      this.prisma.maintenanceWorkOrder.count({
        where: {
          branchId: branchIn,
          status: { in: OPEN_WO_STATUSES },
          scheduledEndAt: { lt: now },
        },
      }),
      this.prisma.asset.count({
        where: {
          ...liveAssetWhere,
          status: {
            notIn: [AssetLifecycleStatus.RETIRED, AssetLifecycleStatus.DISPOSED],
          },
          nextMaintenanceAt: { gte: now, lte: maintenanceWindowEnd },
        },
      }),
      this.prisma.asset.count({
        where: {
          ...liveAssetWhere,
          status: {
            notIn: [AssetLifecycleStatus.RETIRED, AssetLifecycleStatus.DISPOSED],
          },
          nextMaintenanceAt: { lt: now },
        },
      }),
      this.prisma.asset.count({
        where: {
          ...liveAssetWhere,
          status: { notIn: [AssetLifecycleStatus.DISPOSED] },
          warrantyEndDate: { gte: now, lte: expiryWindowEnd },
        },
      }),
      this.prisma.stockBalance.findMany({
        where: {
          onHandQty: { gt: 0 },
          branchId: branchIn,
          lot: { expiryDate: { gte: now, lte: expiryWindowEnd } },
        },
        select: { lotId: true },
        distinct: ['lotId'],
      }),
      this.prisma.purchaseOrder.count({
        where: { branchId: branchIn, status: { in: OPEN_PO_STATUSES } },
      }),
      this.prisma.goodsReceipt.count({
        where: { branchId: branchIn, status: GoodsReceiptStatus.DRAFT },
      }),
      this.prisma.stockTransaction.findMany({
        where: { branchId: branchIn },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          transactionNumber: true,
          type: true,
          status: true,
          transactionDate: true,
          createdAt: true,
          branch: { select: { code: true } },
        },
      }),
      canSeeAssetValue
        ? this.prisma.asset.aggregate({
            where: {
              ...liveAssetWhere,
              status: { notIn: [AssetLifecycleStatus.DISPOSED] },
            },
            _sum: { acquisitionCost: true },
          })
        : Promise.resolve(null),
    ]);

    // Low/out-of-stock: one balance groupBy over the warehouses that carry
    // reorder settings, compared in memory (bounded by the settings count).
    let lowStockCount = 0;
    let outOfStockCount = 0;
    if (reorderSettings.length > 0) {
      const sums = await this.prisma.stockBalance.groupBy({
        by: ['itemId', 'warehouseId'],
        where: {
          itemId: { in: [...new Set(reorderSettings.map((s) => s.itemId))] },
          warehouseId: {
            in: [...new Set(reorderSettings.map((s) => s.warehouseId))],
          },
        },
        _sum: { onHandQty: true },
      });
      const onHandByKey = new Map(
        sums.map((sum) => [
          `${sum.itemId}|${sum.warehouseId}`,
          sum._sum.onHandQty ?? ZERO,
        ]),
      );
      for (const setting of reorderSettings) {
        const onHand =
          onHandByKey.get(`${setting.itemId}|${setting.warehouseId}`) ?? ZERO;
        if (onHand.lte(0)) {
          outOfStockCount += 1;
          lowStockCount += 1;
        } else if (onHand.lte(setting.reorderLevel as Prisma.Decimal)) {
          lowStockCount += 1;
        }
      }
    }

    // On-hand valuation (inventory.view_cost only): balance sums per item ×
    // (last purchase cost ?? standard cost), computed with Decimals.
    let inventoryValue: string | undefined;
    if (canSeeInventoryValue) {
      const balanceSums = await this.prisma.stockBalance.groupBy({
        by: ['itemId'],
        where: { branchId: branchIn, onHandQty: { gt: 0 } },
        _sum: { onHandQty: true },
      });
      if (balanceSums.length === 0) {
        inventoryValue = '0.00';
      } else {
        const items = await this.prisma.item.findMany({
          where: { id: { in: balanceSums.map((sum) => sum.itemId) } },
          select: { id: true, standardCost: true, lastPurchaseCost: true },
        });
        const costById = new Map(
          items.map((item) => [
            item.id,
            item.lastPurchaseCost ?? item.standardCost,
          ]),
        );
        inventoryValue = balanceSums
          .reduce((total, sum) => {
            const cost = costById.get(sum.itemId);
            if (!cost) {
              return total;
            }
            return total.add((sum._sum.onHandQty ?? ZERO).mul(cost));
          }, ZERO)
          .toDecimalPlaces(2)
          .toString();
      }
    }

    const statusCounts: Record<string, number> = {};
    let totalAssets = 0;
    for (const group of assetsByStatus) {
      statusCounts[group.status] = group._count._all;
      totalAssets += group._count._all;
    }

    const conditionIds = assetsByCondition
      .map((group) => group.conditionId)
      .filter((id): id is string => id !== null);
    const conditionNames =
      conditionIds.length > 0
        ? await this.prisma.lookupValue.findMany({
            where: { id: { in: conditionIds } },
            select: { id: true, name: true },
          })
        : [];
    const conditionNameById = new Map(
      conditionNames.map((value) => [value.id, value.name]),
    );

    const transferCounts = new Map(
      transfersByStatus.map((group) => [group.status, group._count._all]),
    );

    return {
      assets: {
        total: totalAssets,
        byStatus: statusCounts,
        byCondition: assetsByCondition.map((group) => ({
          condition: group.conditionId
            ? (conditionNameById.get(group.conditionId) ?? null)
            : null,
          count: group._count._all,
        })),
        assigned: statusCounts[AssetLifecycleStatus.ASSIGNED] ?? 0,
        available: statusCounts[AssetLifecycleStatus.AVAILABLE] ?? 0,
        ...(canSeeAssetValue
          ? {
              acquisitionValue: (
                acquisitionValueAggregate?._sum.acquisitionCost ?? ZERO
              ).toString(),
            }
          : {}),
      },
      inventory: {
        skuCount: skuByCategory.reduce(
          (total, group) => total + group._count._all,
          0,
        ),
        skuByCategory: Object.fromEntries(
          skuByCategory.map((group) => [group.businessCategory, group._count._all]),
        ),
        lowStockCount,
        outOfStockCount,
        ...(inventoryValue !== undefined ? { inventoryValue } : {}),
      },
      transfers: {
        pendingApproval: transferCounts.get(TransferStatus.PENDING_APPROVAL) ?? 0,
        inTransit: transferCounts.get(TransferStatus.IN_TRANSIT) ?? 0,
      },
      approvals: {
        pending: approvalsPending,
        assignedToMe: approvalsAssignedToMe,
      },
      maintenance: {
        openWorkOrders,
        overdueWorkOrders,
        assetsDueSoon,
        assetsOverdue,
      },
      expirations: {
        warrantiesExpiring,
        lotsExpiring: lotsExpiringBalances.length,
        windowDays: EXPIRY_WINDOW_DAYS,
      },
      procurement: { openPurchaseOrders, draftReceipts },
      recentTransactions: recentTransactions.map((txn) => ({
        id: txn.id,
        transactionNumber: txn.transactionNumber,
        type: txn.type,
        status: txn.status,
        transactionDate: txn.transactionDate.toISOString().slice(0, 10),
        branch: txn.branch.code,
        createdAt: txn.createdAt.toISOString(),
      })),
    };
  }

  private addDays(from: Date, days: number): Date {
    return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  }
}
