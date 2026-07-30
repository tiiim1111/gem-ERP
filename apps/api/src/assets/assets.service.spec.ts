import { HttpException } from '@nestjs/common';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { assetTagYear } from './asset-tag.util';
import { AssetsService } from './assets.service';

/** Unit tests with mocked Prisma — no database. */

type MockFn = jest.Mock;

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

const scopedUser = {
  ...superAdmin,
  id: 'user-1',
  isSuperAdmin: false,
  permissions: ['asset.view', 'asset.create', 'asset.update'],
  branchIds: ['branch-1'],
};

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    assetTag: 'AST-SUB-LAP-2026-000001',
    serialNumber: 'SN-001',
    status: 'DRAFT',
    maintenanceRequired: false,
    lastInspectionAt: null,
    nextMaintenanceAt: null,
    acquisitionDate: null,
    acquisitionCost: '65000.00',
    warrantyStartDate: null,
    warrantyEndDate: null,
    retiredAt: null,
    disposedAt: null,
    disposalNotes: null,
    notes: null,
    archivedAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-10T12:00:00.000Z'),
    item: {
      id: 'item-1',
      sku: 'SKU-LAP-00001',
      name: 'Dell Latitude 5450',
      model: 'Latitude 5450',
      businessCategory: 'SERIALIZED_ASSET',
      trackingMethod: 'SERIAL',
      category: { id: 'cat-1', code: 'LAP', name: 'Laptops' },
    },
    branch: { id: 'branch-1', code: 'SUB', name: 'GemCor - Subic' },
    warehouse: { id: 'wh-1', code: 'SUB-WH1', name: 'Subic Main Warehouse' },
    storageLocation: null,
    custodian: null,
    department: null,
    condition: { id: 'cond-new', code: 'NEW', name: 'New' },
    criticality: null,
    disposalMethod: null,
    supplier: null,
    ...overrides,
  };
}

interface Mocks {
  prisma: Record<string, Record<string, MockFn>> & { $transaction: MockFn };
  sequences: { next: MockFn };
  audit: { log: MockFn };
}

function makeMocks(): Mocks {
  const prisma: Mocks['prisma'] = {
    asset: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    assetStatusHistory: { create: jest.fn() },
    assetConditionHistory: { create: jest.fn() },
    assetAssignment: { findFirst: jest.fn(), findMany: jest.fn() },
    item: { findUnique: jest.fn() },
    branch: { findUnique: jest.fn() },
    warehouse: { findUnique: jest.fn() },
    storageLocation: { findUnique: jest.fn() },
    lookupValue: { findUnique: jest.fn() },
    department: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as unknown as Mocks['prisma'];
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => unknown) => fn(prisma),
  );
  return {
    prisma,
    sequences: { next: jest.fn() },
    audit: { log: jest.fn() },
  };
}

function makeService(mocks: Mocks): AssetsService {
  return new AssetsService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.prisma as any,
    new BranchScopeService(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.audit as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.sequences as any,
  );
}

describe('AssetsService.register', () => {
  let mocks: Mocks;
  let service: AssetsService;

  beforeEach(() => {
    mocks = makeMocks();
    service = makeService(mocks);
    mocks.prisma.item.findUnique.mockResolvedValue({
      id: 'item-1',
      sku: 'SKU-LAP-00001',
      name: 'Dell Latitude 5450',
      trackingMethod: 'SERIAL',
      isActive: true,
      archivedAt: null,
      requiresSerialNumber: true,
      category: { id: 'cat-1', code: 'LAP' },
    });
    mocks.prisma.branch.findUnique.mockResolvedValue({
      id: 'branch-1',
      code: 'SUB',
    });
    mocks.prisma.asset.findFirst.mockResolvedValue(null); // serials free
    let created = 0;
    mocks.prisma.asset.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => {
        created += 1;
        return assetRow({
          id: `asset-${created}`,
          assetTag: data.assetTag,
          serialNumber: data.serialNumber ?? null,
        });
      },
    );
    mocks.prisma.assetStatusHistory.create.mockResolvedValue({});
    mocks.prisma.assetConditionHistory.create.mockResolvedValue({});
  });

  it('formats the tag AST-{BRANCH}-{CAT}-{YYYY}-{SEQ6} from the sequence counter', async () => {
    mocks.sequences.next.mockResolvedValue(7);
    const year = assetTagYear();

    const [view] = await service.register(
      superAdmin,
      { itemId: 'item-1', branchId: 'branch-1', serialNumber: 'SN-7' },
      { actorUserId: 'admin-1' },
    );

    expect(mocks.sequences.next).toHaveBeenCalledWith(
      mocks.prisma,
      `AST-SUB-LAP-${year}`,
    );
    expect(view.assetTag).toBe(`AST-SUB-LAP-${year}-000007`);
    const createData = mocks.prisma.asset.create.mock.calls[0][0].data;
    expect(createData.status).toBe('DRAFT');
    // Scan token: 32 random bytes base64url = 43 chars, URL-safe.
    expect(createData.scanToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'asset.registered' }),
    );
  });

  it('bulk-registers N instances with consecutive tags and unique scan tokens', async () => {
    let seq = 41;
    mocks.sequences.next.mockImplementation(async () => {
      seq += 1;
      return seq;
    });
    const year = assetTagYear();

    const views = await service.register(
      superAdmin,
      {
        itemId: 'item-1',
        branchId: 'branch-1',
        quantity: 3,
        serialNumbers: ['SN-A', 'SN-B', 'SN-C'],
      },
      { actorUserId: 'admin-1' },
    );

    expect(views).toHaveLength(3);
    expect(mocks.sequences.next).toHaveBeenCalledTimes(3);
    expect(views.map((view) => view.assetTag)).toEqual([
      `AST-SUB-LAP-${year}-000042`,
      `AST-SUB-LAP-${year}-000043`,
      `AST-SUB-LAP-${year}-000044`,
    ]);
    const tokens = mocks.prisma.asset.create.mock.calls.map(
      (call: [{ data: { scanToken: string } }]) => call[0].data.scanToken,
    );
    expect(new Set(tokens).size).toBe(3);
    // One status-history "register" row per instance.
    expect(mocks.prisma.assetStatusHistory.create).toHaveBeenCalledTimes(3);
  });

  it('rejects serialNumbers count mismatching quantity', async () => {
    let caught: unknown;
    try {
      await service.register(
        superAdmin,
        {
          itemId: 'item-1',
          branchId: 'branch-1',
          quantity: 3,
          serialNumbers: ['SN-A'],
        },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 400, 'VALIDATION_ERROR');
    expect(mocks.prisma.asset.create).not.toHaveBeenCalled();
  });

  it('rejects duplicate manufacturer serials with 409 DUPLICATE_CODE', async () => {
    mocks.prisma.asset.findFirst.mockResolvedValue({
      assetTag: 'AST-SUB-LAP-2026-000001',
      serialNumber: 'SN-DUP',
    });
    let caught: unknown;
    try {
      await service.register(
        superAdmin,
        { itemId: 'item-1', branchId: 'branch-1', serialNumber: 'SN-DUP' },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 409, 'DUPLICATE_CODE');
  });

  it('refuses to register instances of a non-SERIAL item', async () => {
    mocks.prisma.item.findUnique.mockResolvedValue({
      id: 'item-2',
      sku: 'SKU-OFC-00001',
      name: 'Bond Paper',
      trackingMethod: 'QUANTITY',
      isActive: true,
      archivedAt: null,
      requiresSerialNumber: false,
      category: { id: 'cat-2', code: 'OFC' },
    });
    let caught: unknown;
    try {
      await service.register(
        superAdmin,
        { itemId: 'item-2', branchId: 'branch-1' },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 400, 'VALIDATION_ERROR');
    expect(mocks.sequences.next).not.toHaveBeenCalled();
  });

  it('registering directly as AVAILABLE enforces the activation checks', async () => {
    let caught: unknown;
    try {
      await service.register(
        superAdmin,
        {
          itemId: 'item-1',
          branchId: 'branch-1',
          serialNumber: 'SN-1',
          initialStatus: 'AVAILABLE',
          // no warehouseId / conditionId → not activatable
        },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 400, 'VALIDATION_ERROR');
  });
});

describe('AssetsService.update', () => {
  let mocks: Mocks;
  let service: AssetsService;

  beforeEach(() => {
    mocks = makeMocks();
    service = makeService(mocks);
  });

  it('rejects a stale version with 409 VERSION_CONFLICT (updatedAt-derived lock)', async () => {
    const row = assetRow();
    mocks.prisma.asset.findUnique.mockResolvedValue(row);
    mocks.prisma.asset.updateMany.mockResolvedValue({ count: 0 });

    let caught: unknown;
    try {
      await service.update(
        superAdmin,
        'asset-1',
        { version: 12345, notes: 'x' },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 409, 'VERSION_CONFLICT');
    expect(mocks.prisma.asset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'asset-1', updatedAt: new Date(12345) },
      }),
    );
  });

  it('accepts the matching version and audits old/new values', async () => {
    const row = assetRow();
    mocks.prisma.asset.findUnique.mockResolvedValue(row);
    mocks.prisma.asset.updateMany.mockResolvedValue({ count: 1 });

    const view = await service.update(
      superAdmin,
      'asset-1',
      { version: row.updatedAt.getTime(), notes: 'refreshed' },
      {},
    );
    expect(view.id).toBe('asset-1');
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'asset.updated' }),
    );
  });

  it('blocks draft-only fields once the asset left Draft', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({ status: 'AVAILABLE' }),
    );
    let caught: unknown;
    try {
      await service.update(
        superAdmin,
        'asset-1',
        { version: 1, warehouseId: 'wh-2' },
        {},
      );
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 400, 'VALIDATION_ERROR');
    expect(mocks.prisma.asset.updateMany).not.toHaveBeenCalled();
  });

  it('refuses any edit on a Disposed asset', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({ status: 'DISPOSED' }),
    );
    let caught: unknown;
    try {
      await service.update(superAdmin, 'asset-1', { version: 1, notes: 'x' }, {});
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 409, 'INVALID_STATE_TRANSITION');
  });
});

describe('AssetsService scoping and cost gating', () => {
  let mocks: Mocks;
  let service: AssetsService;

  beforeEach(() => {
    mocks = makeMocks();
    service = makeService(mocks);
  });

  it('hides acquisitionCost without asset.view_cost and shows it with it', () => {
    const row = assetRow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hidden = service.toView(row as any, false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const shown = service.toView(row as any, true);
    expect('acquisitionCost' in hidden).toBe(false);
    expect(shown.acquisitionCost).toBe('65000.00');
    // The optimistic-concurrency token mirrors updatedAt.
    expect(shown.version).toBe(row.updatedAt.getTime());
  });

  it('returns 404 for an out-of-scope asset (no existence leak)', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({ branch: { id: 'branch-2', code: 'MKT', name: 'Makati' } }),
    );
    let caught: unknown;
    try {
      await service.getById(scopedUser, 'asset-1');
    } catch (error) {
      caught = error;
    }
    expectAppError(caught, 404, 'NOT_FOUND');
  });
});
