import { BranchScopeService } from '../rbac/branch-scope.service';
import { SearchService } from './search.service';

/**
 * Unit tests with a fully mocked Prisma client — no database. Covers the
 * §4.7 contract: per-entity permission filtering (types the caller cannot
 * view are never even queried), branch scoping, the per-type result bound,
 * technician scoping on work orders, and the single-type filter.
 */

function prismaMock() {
  const empty = () => jest.fn().mockResolvedValue([]);
  return {
    asset: { findMany: empty() },
    item: { findMany: empty() },
    employee: { findMany: empty() },
    supplier: { findMany: empty() },
    purchaseOrder: { findMany: empty() },
    goodsReceipt: { findMany: empty() },
    maintenanceWorkOrder: { findMany: empty() },
    transfer: { findMany: empty() },
    stockTransaction: { findMany: empty() },
  };
}

const superAdmin = {
  id: 'admin-1',
  email: 'admin@x',
  displayName: 'Admin',
  isSuperAdmin: true,
  roles: [],
  permissions: [],
  branchIds: [],
  mustChangePassword: false,
};

const itemViewerOnly = {
  ...superAdmin,
  id: 'user-2',
  isSuperAdmin: false,
  permissions: ['item.view'],
  branchIds: ['branch-1'],
};

const scopedOperator = {
  ...superAdmin,
  id: 'user-3',
  isSuperAdmin: false,
  permissions: [
    'asset.view',
    'employee.view',
    'inventory.view',
    'maintenance.work_order.view',
  ],
  branchIds: ['branch-1', 'branch-2'],
};

type Mocks = { prisma: ReturnType<typeof prismaMock> };

function makeService(mocks: Mocks): SearchService {
  return new SearchService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.prisma as any,
    new BranchScopeService(),
  );
}

describe('SearchService', () => {
  let mocks: Mocks;
  let service: SearchService;

  beforeEach(() => {
    mocks = { prisma: prismaMock() };
    service = makeService(mocks);
  });

  it('queries every entity type for a super admin and flattens results', async () => {
    mocks.prisma.asset.findMany.mockResolvedValue([
      {
        id: 'a1',
        assetTag: 'AST-1',
        serialNumber: 'SN-9',
        status: 'AVAILABLE',
        branchId: 'branch-1',
        item: { name: 'Laptop' },
      },
    ]);
    mocks.prisma.supplier.findMany.mockResolvedValue([
      {
        id: 's1',
        code: 'SUP-1',
        legalName: 'TechnoHub',
        tradeName: null,
        isActive: true,
      },
    ]);

    const response = await service.search(superAdmin, { q: 'AST', limit: 5 });
    expect(response.query).toBe('AST');
    expect(response.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'asset',
          title: 'AST-1',
          subtitle: 'Laptop — SN SN-9',
        }),
        expect.objectContaining({ type: 'supplier', title: 'TechnoHub' }),
      ]),
    );
    // All nine entity types were consulted.
    for (const delegate of Object.values(mocks.prisma)) {
      expect(delegate.findMany).toHaveBeenCalledTimes(1);
    }
  });

  it('never queries entity types the caller cannot view', async () => {
    await service.search(itemViewerOnly, { q: 'paper', limit: 5 });
    expect(mocks.prisma.item.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.asset.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.employee.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.supplier.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.purchaseOrder.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.stockTransaction.findMany).not.toHaveBeenCalled();
  });

  it('branch-scopes non-global entities and bounds every query', async () => {
    await service.search(scopedOperator, { q: 'AST', limit: 3 });
    expect(mocks.prisma.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        where: expect.objectContaining({
          branchId: { in: ['branch-1', 'branch-2'] },
        }),
      }),
    );
    expect(mocks.prisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 3,
        where: expect.objectContaining({
          branchId: { in: ['branch-1', 'branch-2'] },
        }),
      }),
    );
  });

  it('applies technician scoping to work orders without manage', async () => {
    await service.search(scopedOperator, { q: 'WO-', limit: 5 });
    expect(mocks.prisma.maintenanceWorkOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignedToEmployee: { userId: 'user-3' },
        }),
      }),
    );
  });

  it('does not restrict work orders for managers', async () => {
    const manager = {
      ...scopedOperator,
      permissions: [
        ...scopedOperator.permissions,
        'maintenance.work_order.manage',
      ],
    };
    await service.search(manager, { q: 'WO-', limit: 5 });
    const args = mocks.prisma.maintenanceWorkOrder.findMany.mock.calls[0][0];
    expect(args.where.assignedToEmployee).toBeUndefined();
  });

  it('restricts to a single entity type when `type` is given', async () => {
    await service.search(superAdmin, { q: 'SKU', limit: 5, type: 'item' });
    expect(mocks.prisma.item.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.asset.findMany).not.toHaveBeenCalled();
    expect(mocks.prisma.supplier.findMany).not.toHaveBeenCalled();
  });
});
