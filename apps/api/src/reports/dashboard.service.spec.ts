import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { DashboardService } from './dashboard.service';

/**
 * Dashboard summary with a fully mocked Prisma client: real aggregation
 * math (low/out-of-stock, valuation), branch scoping on the batched
 * queries, and *.view_cost gating of the value widgets.
 */

const D = (value: string) => new Prisma.Decimal(value);

function prismaMock() {
  return {
    asset: {
      groupBy: jest.fn().mockImplementation(({ by }: { by: string[] }) => {
        if (by[0] === 'status') {
          return Promise.resolve([
            { status: 'ASSIGNED', _count: { _all: 7 } },
            { status: 'AVAILABLE', _count: { _all: 3 } },
            { status: 'UNDER_MAINTENANCE', _count: { _all: 1 } },
          ]);
        }
        return Promise.resolve([
          { conditionId: 'cond-good', _count: { _all: 10 } },
          { conditionId: null, _count: { _all: 1 } },
        ]);
      }),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest
        .fn()
        .mockResolvedValue({ _sum: { acquisitionCost: D('123456.78') } }),
    },
    item: {
      groupBy: jest.fn().mockResolvedValue([
        { businessCategory: 'CONSUMABLE', _count: { _all: 12 } },
        { businessCategory: 'SERIALIZED_ASSET', _count: { _all: 5 } },
      ]),
      findMany: jest
        .fn()
        .mockResolvedValue([
          { id: 'item-1', standardCost: D('10.00'), lastPurchaseCost: null },
        ]),
    },
    itemWarehouseSetting: {
      findMany: jest.fn().mockResolvedValue([
        { itemId: 'item-1', warehouseId: 'wh-1', reorderLevel: D('5') },
        { itemId: 'item-2', warehouseId: 'wh-1', reorderLevel: D('5') },
      ]),
    },
    stockBalance: {
      groupBy: jest.fn().mockImplementation(({ by }: { by: string[] }) => {
        if (by.includes('warehouseId')) {
          // Low-stock sums: item-1 has 2 on hand (low), item-2 has none (out).
          return Promise.resolve([
            {
              itemId: 'item-1',
              warehouseId: 'wh-1',
              _sum: { onHandQty: D('2') },
            },
          ]);
        }
        // Valuation sums per item.
        return Promise.resolve([
          { itemId: 'item-1', _sum: { onHandQty: D('2') } },
        ]);
      }),
      findMany: jest
        .fn()
        .mockResolvedValue([{ lotId: 'lot-1' }, { lotId: 'lot-2' }]),
    },
    transfer: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'PENDING_APPROVAL', _count: { _all: 2 } },
        { status: 'IN_TRANSIT', _count: { _all: 1 } },
      ]),
    },
    approvalRequest: { count: jest.fn().mockResolvedValue(4) },
    maintenanceWorkOrder: { count: jest.fn().mockResolvedValue(0) },
    purchaseOrder: { count: jest.fn().mockResolvedValue(3) },
    goodsReceipt: { count: jest.fn().mockResolvedValue(1) },
    stockTransaction: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'txn-1',
          transactionNumber: 'STK-2026-000482',
          type: 'ISSUE_TO_EMPLOYEE',
          status: 'POSTED',
          transactionDate: new Date('2026-08-05T00:00:00.000Z'),
          createdAt: new Date('2026-08-05T06:00:00.000Z'),
          branch: { code: 'SUB' },
        },
      ]),
    },
    lookupValue: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'cond-good', name: 'Good' }]),
    },
  };
}

const baseUser = {
  id: 'user-1',
  email: 'x@gemcor.dev',
  displayName: 'X',
  isSuperAdmin: false,
  roles: [],
  branchIds: ['branch-sub'],
  permissions: [PERMISSIONS.report.view],
  mustChangePassword: false,
};

describe('DashboardService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: DashboardService;

  beforeEach(() => {
    prisma = prismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new DashboardService(prisma as any, new BranchScopeService());
  });

  it('computes asset/stock/queue KPIs from the batched queries', async () => {
    const summary = await service.summary(baseUser);
    expect(summary.assets.total).toBe(11);
    expect(summary.assets.assigned).toBe(7);
    expect(summary.assets.available).toBe(3);
    expect(summary.assets.byStatus.UNDER_MAINTENANCE).toBe(1);
    expect(summary.assets.byCondition).toContainEqual({
      condition: 'Good',
      count: 10,
    });
    expect(summary.inventory.skuCount).toBe(17);
    expect(summary.inventory.skuByCategory.CONSUMABLE).toBe(12);
    // item-1: 2 on hand <= reorder 5 → low; item-2: no balance row → out+low.
    expect(summary.inventory.lowStockCount).toBe(2);
    expect(summary.inventory.outOfStockCount).toBe(1);
    expect(summary.transfers).toEqual({ pendingApproval: 2, inTransit: 1 });
    expect(summary.approvals.pending).toBe(4);
    expect(summary.expirations.lotsExpiring).toBe(2);
    expect(summary.expirations.windowDays).toBe(30);
    expect(summary.procurement).toEqual({
      openPurchaseOrders: 3,
      draftReceipts: 1,
    });
    expect(summary.recentTransactions[0]).toMatchObject({
      transactionNumber: 'STK-2026-000482',
      branch: 'SUB',
      transactionDate: '2026-08-05',
    });
  });

  it('applies the caller branch scope to the asset queries', async () => {
    await service.summary(baseUser);
    const groupByArgs = prisma.asset.groupBy.mock.calls[0][0];
    expect(groupByArgs.where.branchId).toEqual({ in: ['branch-sub'] });
    const txnArgs = prisma.stockTransaction.findMany.mock.calls[0][0];
    expect(txnArgs.where.branchId).toEqual({ in: ['branch-sub'] });
  });

  it('omits value widgets without *.view_cost and never runs their queries', async () => {
    const summary = await service.summary(baseUser);
    expect(summary.assets).not.toHaveProperty('acquisitionValue');
    expect(summary.inventory).not.toHaveProperty('inventoryValue');
    expect(prisma.asset.aggregate).not.toHaveBeenCalled();
    // stockBalance.groupBy is still used for low-stock, but never with the
    // single-item valuation grouping.
    const valuationCalls = prisma.stockBalance.groupBy.mock.calls.filter(
      (call) => !(call[0].by as string[]).includes('warehouseId'),
    );
    expect(valuationCalls).toHaveLength(0);
  });

  it('includes value widgets with the matching *.view_cost permissions', async () => {
    const costUser = {
      ...baseUser,
      permissions: [
        ...baseUser.permissions,
        PERMISSIONS.asset.viewCost,
        PERMISSIONS.inventory.viewCost,
      ],
    };
    const summary = await service.summary(costUser);
    expect(summary.assets.acquisitionValue).toBe('123456.78');
    // 2 on hand × 10.00 standard cost (no last purchase cost).
    expect(summary.inventory.inventoryValue).toBe('20');
  });
});
