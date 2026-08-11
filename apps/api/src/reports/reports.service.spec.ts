import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { ReportsService } from './reports.service';

/**
 * Report endpoint behavior with a fully mocked Prisma client: permission
 * denial, branch-scope enforcement (explicit branchId + implicit filter),
 * filter validation, cost-column gating, and query-builder where clauses
 * for two representative reports (asset-register, stock-on-hand).
 */

const D = (value: string) => new Prisma.Decimal(value);

function prismaMock() {
  return {
    asset: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    stockBalance: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
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
  permissions: [] as string[],
  mustChangePassword: false,
};

const assetViewer = {
  ...baseUser,
  permissions: [PERMISSIONS.report.view, PERMISSIONS.asset.view],
};
const assetViewerWithCost = {
  ...assetViewer,
  permissions: [...assetViewer.permissions, PERMISSIONS.asset.viewCost],
};
const inventoryViewer = {
  ...baseUser,
  permissions: [PERMISSIONS.report.view, PERMISSIONS.inventory.view],
};

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(code);
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

function assetRow() {
  return {
    assetTag: 'AST-SUB-LAP-2026-000001',
    serialNumber: 'SN-1',
    status: 'ASSIGNED',
    acquisitionDate: new Date('2026-01-15T00:00:00.000Z'),
    acquisitionCost: D('45000.00'),
    warrantyEndDate: new Date('2027-01-15T00:00:00.000Z'),
    item: { sku: 'SKU-LAP-00001', name: 'Laptop 14"', category: { name: 'Laptops' } },
    branch: { code: 'SUB' },
    warehouse: { code: 'SUB-WH1', name: 'Subic WH' },
    storageLocation: null,
    condition: { name: 'Good' },
    custodian: { firstName: 'Ana', lastName: 'Reyes', displayName: null },
    department: { name: 'Finance' },
    supplier: { legalName: 'TechnoHub' },
  };
}

describe('ReportsService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: ReportsService;

  beforeEach(() => {
    prisma = prismaMock();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new ReportsService(prisma as any, new BranchScopeService());
  });

  it('404s an unknown report key', async () => {
    const error = await catchError(service.run(assetViewer, 'no-such-report', {}));
    expectAppError(error, 404, 'NOT_FOUND');
  });

  it('403s a caller without the underlying permission (report.view alone is not enough)', async () => {
    const reportViewOnly = { ...baseUser, permissions: [PERMISSIONS.report.view] };
    const error = await catchError(service.run(reportViewOnly, 'asset-register', {}));
    expectAppError(error, 403, 'FORBIDDEN');
    expect(prisma.asset.findMany).not.toHaveBeenCalled();
  });

  it('403s an explicit branchId outside the caller scope (SUB user asking for MKT)', async () => {
    const error = await catchError(
      service.run(assetViewer, 'asset-register', {
        branchId: '9a6f5cf0-0000-4000-8000-000000000abc',
      }),
    );
    expectAppError(error, 403, 'FORBIDDEN');
    expect(prisma.asset.findMany).not.toHaveBeenCalled();
  });

  it('rejects unsupported filters with VALIDATION_ERROR instead of ignoring them', async () => {
    // stock-on-hand does not take employeeId.
    const error = await catchError(
      service.run(inventoryViewer, 'stock-on-hand', {
        employeeId: '3f0e8a4e-6f4e-4d0d-9a3f-2b1c5d6e7f80',
      }),
    );
    expectAppError(error, 400, 'VALIDATION_ERROR');
  });

  it('always applies the caller branch scope to the query (implicit filter)', async () => {
    await service.run(assetViewer, 'asset-register', {});
    expect(prisma.asset.findMany).toHaveBeenCalledTimes(1);
    const args = prisma.asset.findMany.mock.calls[0][0];
    expect(args.where.branchId).toEqual({ in: ['branch-sub'] });
    expect(prisma.asset.count.mock.calls[0][0].where.branchId).toEqual({
      in: ['branch-sub'],
    });
  });

  it('leaves super admin unrestricted (no branch clause)', async () => {
    const superAdmin = { ...baseUser, isSuperAdmin: true, branchIds: [] };
    await service.run(superAdmin, 'asset-register', {});
    const args = prisma.asset.findMany.mock.calls[0][0];
    expect(args.where.branchId).toBeUndefined();
  });

  it('serializes rows and hides cost columns without asset.view_cost', async () => {
    prisma.asset.findMany.mockResolvedValue([assetRow()]);
    prisma.asset.count.mockResolvedValue(1);
    const result = await service.run(assetViewer, 'asset-register', {});
    expect(result.meta).toEqual({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    const row = result.data[0];
    expect(row.assetTag).toBe('AST-SUB-LAP-2026-000001');
    expect(row.custodian).toBe('Ana Reyes');
    expect(row.acquisitionDate).toBe('2026-01-15');
    expect(row).not.toHaveProperty('acquisitionCost');
  });

  it('includes cost columns with asset.view_cost', async () => {
    prisma.asset.findMany.mockResolvedValue([assetRow()]);
    prisma.asset.count.mockResolvedValue(1);
    const result = await service.run(assetViewerWithCost, 'asset-register', {});
    expect(result.data[0].acquisitionCost).toBe('45000');
  });

  it('stock-on-hand computes available qty and gates valuation columns', async () => {
    prisma.stockBalance.findMany.mockResolvedValue([
      {
        onHandQty: D('10'),
        reservedQty: D('3'),
        inTransitQty: D('0'),
        item: {
          sku: 'SKU-PPR-00017',
          name: 'Bond paper A4',
          standardCost: D('250.00'),
          lastPurchaseCost: D('240.00'),
          category: { name: 'Paper' },
          baseUom: { code: 'REAM' },
        },
        branch: { code: 'SUB' },
        warehouse: { name: 'Subic WH' },
        storageLocation: { code: 'A01' },
        lot: null,
      },
    ]);
    prisma.stockBalance.count.mockResolvedValue(1);

    const plain = await service.run(inventoryViewer, 'stock-on-hand', {});
    expect(plain.data[0].availableQty).toBe('7');
    expect(plain.data[0]).not.toHaveProperty('unitCost');
    expect(plain.data[0]).not.toHaveProperty('totalValue');

    const withCost = await service.run(
      {
        ...inventoryViewer,
        permissions: [...inventoryViewer.permissions, PERMISSIONS.inventory.viewCost],
      },
      'stock-on-hand',
      {},
    );
    // Valuation prefers last purchase cost (240) over standard (250).
    expect(withCost.data[0].unitCost).toBe('240');
    expect(withCost.data[0].totalValue).toBe('2400');
    const where = prisma.stockBalance.findMany.mock.calls[0][0].where;
    expect(where.branchId).toEqual({ in: ['branch-sub'] });
  });

  it('catalog returns only the runnable subset with cost columns stripped for non-cost viewers', () => {
    const catalog = service.catalog(assetViewer);
    expect(catalog.map((entry) => entry.key)).toEqual([
      'asset-register',
      'asset-custody',
      'asset-movements',
      'asset-condition',
      'asset-terminal',
    ]);
    const register = catalog[0];
    expect(register.includesCost).toBe(false);
    expect(register.columns.some((column) => column.key === 'acquisitionCost')).toBe(
      false,
    );
    const costCatalog = service.catalog(assetViewerWithCost);
    expect(
      costCatalog[0].columns.some((column) => column.key === 'acquisitionCost'),
    ).toBe(true);
  });
});
