import { HttpException } from '@nestjs/common';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { AssetLifecycleService } from './asset-lifecycle.service';
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

const ctx = { actorUserId: 'admin-1' };

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

async function expectRejects(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expectAppError(caught, status, code);
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    assetTag: 'AST-SUB-LAP-2026-000001',
    serialNumber: 'SN-001',
    status: 'AVAILABLE',
    maintenanceRequired: false,
    lastInspectionAt: null,
    nextMaintenanceAt: null,
    acquisitionDate: null,
    acquisitionCost: null,
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
      model: null,
      businessCategory: 'SERIALIZED_ASSET',
      trackingMethod: 'SERIAL',
      category: { id: 'cat-1', code: 'LAP', name: 'Laptops' },
    },
    branch: { id: 'branch-1', code: 'SUB', name: 'GemCor - Subic' },
    warehouse: { id: 'wh-1', code: 'SUB-WH1', name: 'Subic Main Warehouse' },
    storageLocation: null,
    custodian: null,
    department: null,
    condition: { id: 'cond-good', code: 'GOOD', name: 'Good' },
    criticality: null,
    disposalMethod: null,
    supplier: null,
    ...overrides,
  };
}

interface Mocks {
  prisma: Record<string, Record<string, MockFn>> & { $transaction: MockFn };
  audit: { log: MockFn };
}

function makeMocks(): Mocks {
  const prisma = {
    asset: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    assetAssignment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'asg-1' }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    assetAcknowledgment: { create: jest.fn().mockResolvedValue({}) },
    assetMovement: { create: jest.fn().mockResolvedValue({}) },
    assetStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    assetConditionHistory: { create: jest.fn().mockResolvedValue({}) },
    employee: { findUnique: jest.fn() },
    lookupValue: { findUnique: jest.fn() },
    warehouse: { findUnique: jest.fn() },
    storageLocation: { findUnique: jest.fn() },
    branch: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  } as unknown as Mocks['prisma'];
  prisma.$transaction.mockImplementation(
    async (fn: (tx: unknown) => unknown) => fn(prisma),
  );
  return { prisma, audit: { log: jest.fn() } };
}

function makeService(mocks: Mocks): AssetLifecycleService {
  const branchScope = new BranchScopeService();
  const assets = new AssetsService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.prisma as any,
    branchScope,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.audit as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { next: jest.fn() } as any,
  );
  return new AssetLifecycleService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.prisma as any,
    assets,
    branchScope,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mocks.audit as any,
  );
}

describe('AssetLifecycleService assign → return round trip', () => {
  let mocks: Mocks;
  let service: AssetLifecycleService;

  beforeEach(() => {
    mocks = makeMocks();
    service = makeService(mocks);
    mocks.prisma.lookupValue.findUnique.mockResolvedValue({
      id: 'cond-good',
      code: 'GOOD',
      category: 'ASSET_CONDITION',
      isActive: true,
    });
    mocks.prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      employeeNumber: 'EMP-000005',
      status: 'ACTIVE',
      branchId: 'branch-1',
      archivedAt: null,
    });
  });

  it('assign creates a pending-acknowledgment custody record and sets the custodian', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(assetRow());

    await service.assign(
      superAdmin,
      'asset-1',
      {
        employeeId: 'emp-1',
        conditionId: 'cond-good',
        expectedReturnDate: '2026-08-30',
        notes: 'issued for project',
      },
      ctx,
    );

    expect(mocks.prisma.assetAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PENDING_ACKNOWLEDGMENT',
          employeeId: 'emp-1',
          conditionAtIssueId: 'cond-good',
          assignedById: 'admin-1',
          expectedReturnAt: new Date('2026-08-30'),
        }),
      }),
    );
    expect(mocks.prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'ASSIGNED',
          custodianId: 'emp-1',
        }),
      }),
    );
    expect(mocks.prisma.assetStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: 'AVAILABLE',
          toStatus: 'ASSIGNED',
        }),
      }),
    );
    expect(mocks.prisma.assetMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ toEmployeeId: 'emp-1' }),
      }),
    );
    expect(mocks.prisma.assetConditionHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ source: 'issuance' }),
      }),
    );
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'asset.assigned',
        oldValues: { status: 'AVAILABLE' },
        newValues: { status: 'ASSIGNED' },
      }),
    );
  });

  it('assign requires exactly one target', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(assetRow());
    await expectRejects(
      service.assign(
        superAdmin,
        'asset-1',
        {
          employeeId: 'emp-1',
          departmentId: 'dept-1',
          conditionId: 'cond-good',
        },
        ctx,
      ),
      400,
      'VALIDATION_ERROR',
    );
  });

  it('return in good condition closes the assignment and frees the asset', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({
        status: 'ASSIGNED',
        custodian: {
          id: 'emp-1',
          employeeNumber: 'EMP-000005',
          firstName: 'Liza',
          lastName: 'Reyes',
          displayName: null,
        },
      }),
    );
    mocks.prisma.assetAssignment.findFirst.mockResolvedValue({
      id: 'asg-1',
      employeeId: 'emp-1',
    });

    await service.return_(
      superAdmin,
      'asset-1',
      { conditionId: 'cond-good', notes: 'returned complete' },
      ctx,
    );

    expect(mocks.prisma.assetAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'asg-1' },
        data: expect.objectContaining({
          status: 'RETURNED',
          conditionAtReturnId: 'cond-good',
          returnReceivedById: 'admin-1',
        }),
      }),
    );
    expect(mocks.prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'AVAILABLE',
          custodianId: null,
        }),
      }),
    );
    // Return acknowledgment captured for the employee.
    expect(mocks.prisma.assetAcknowledgment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'RETURN', employeeId: 'emp-1' }),
      }),
    );
    expect(mocks.prisma.assetStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          fromStatus: 'ASSIGNED',
          toStatus: 'AVAILABLE',
        }),
      }),
    );
  });

  it('return with a DEFECTIVE condition routes to Damaged and requires notes', async () => {
    mocks.prisma.lookupValue.findUnique.mockResolvedValue({
      id: 'cond-def',
      code: 'DEFECTIVE',
      category: 'ASSET_CONDITION',
      isActive: true,
    });
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({ status: 'ASSIGNED' }),
    );

    await expectRejects(
      service.return_(superAdmin, 'asset-1', { conditionId: 'cond-def' }, ctx),
      400,
      'VALIDATION_ERROR',
    );

    await service.return_(
      superAdmin,
      'asset-1',
      { conditionId: 'cond-def', notes: 'screen cracked' },
      ctx,
    );
    expect(mocks.prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DAMAGED',
          maintenanceRequired: true,
        }),
      }),
    );
  });

  it('acknowledge by a non-custodian without notes is rejected; captured ack works', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({ status: 'ASSIGNED' }),
    );
    mocks.prisma.assetAssignment.findFirst.mockResolvedValue({
      id: 'asg-1',
      employeeId: 'emp-1',
    });
    mocks.prisma.employee.findUnique.mockResolvedValue(null); // caller not linked

    await expectRejects(
      service.acknowledge(superAdmin, 'asset-1', {}, ctx),
      400,
      'VALIDATION_ERROR',
    );

    await service.acknowledge(
      superAdmin,
      'asset-1',
      { notes: 'signed custody form on file' },
      ctx,
    );
    expect(mocks.prisma.assetAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(mocks.prisma.assetAcknowledgment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'ISSUE', method: 'CAPTURED' }),
      }),
    );
  });
});

describe('AssetLifecycleService disposal', () => {
  let mocks: Mocks;
  let service: AssetLifecycleService;

  beforeEach(() => {
    mocks = makeMocks();
    service = makeService(mocks);
  });

  it('dispose from Retired records method, reason, and history', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({ status: 'RETIRED' }),
    );
    mocks.prisma.lookupValue.findUnique.mockResolvedValue({
      id: 'dm-1',
      code: 'SCRAPPED',
      category: 'DISPOSAL_METHOD',
      isActive: true,
    });

    await service.dispose(
      superAdmin,
      'asset-1',
      { disposalMethodId: 'dm-1', reason: 'beyond repair' },
      ctx,
    );

    expect(mocks.prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DISPOSED',
          disposalMethodId: 'dm-1',
          disposalNotes: 'beyond repair',
        }),
      }),
    );
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'asset.disposed' }),
    );
  });

  it('dispose from any non-Retired state is rejected', async () => {
    mocks.prisma.lookupValue.findUnique.mockResolvedValue({
      id: 'dm-1',
      code: 'SCRAPPED',
      category: 'DISPOSAL_METHOD',
      isActive: true,
    });
    for (const status of ['AVAILABLE', 'ASSIGNED', 'DAMAGED', 'LOST', 'DRAFT']) {
      mocks.prisma.asset.findUnique.mockResolvedValue(assetRow({ status }));
      await expectRejects(
        service.dispose(
          superAdmin,
          'asset-1',
          { disposalMethodId: 'dm-1', reason: 'x' },
          ctx,
        ),
        409,
        'INVALID_STATE_TRANSITION',
      );
    }
  });

  it('after disposal EVERY lifecycle action except reverse-disposal is blocked', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({ status: 'DISPOSED' }),
    );
    mocks.prisma.lookupValue.findUnique.mockResolvedValue({
      id: 'cond-good',
      code: 'GOOD',
      category: 'ASSET_CONDITION',
      isActive: true,
    });
    mocks.prisma.employee.findUnique.mockResolvedValue({
      id: 'emp-1',
      employeeNumber: 'EMP-000005',
      status: 'ACTIVE',
      branchId: 'branch-1',
      archivedAt: null,
    });

    const blocked: Array<Promise<unknown>> = [
      service.activate(superAdmin, 'asset-1', ctx),
      service.reserve(superAdmin, 'asset-1', {}, ctx),
      service.release(superAdmin, 'asset-1', {}, ctx),
      service.assign(
        superAdmin,
        'asset-1',
        { employeeId: 'emp-1', conditionId: 'cond-good' },
        ctx,
      ),
      service.return_(superAdmin, 'asset-1', { conditionId: 'cond-good' }, ctx),
      service.transfer(superAdmin, 'asset-1', { employeeId: 'emp-1' }, ctx),
      service.sendToInspection(superAdmin, 'asset-1', {}, ctx),
      service.inspect(
        superAdmin,
        'asset-1',
        { outcome: 'PASS', conditionId: 'cond-good' },
        ctx,
      ),
      service.sendToMaintenance(superAdmin, 'asset-1', {}, ctx),
      service.completeMaintenance(
        superAdmin,
        'asset-1',
        { outcome: 'AVAILABLE' },
        ctx,
      ),
      service.reportDamage(superAdmin, 'asset-1', { description: 'dmg' }, ctx),
      service.reportLoss(superAdmin, 'asset-1', { description: 'lost' }, ctx),
      service.recover(superAdmin, 'asset-1', { reason: 'found' }, ctx),
      service.retire(superAdmin, 'asset-1', { reason: 'old' }, ctx),
      service.dispose(
        superAdmin,
        'asset-1',
        { disposalMethodId: 'dm-1', reason: 'x' },
        ctx,
      ),
    ];
    for (const promise of blocked) {
      await expectRejects(promise, 409, 'INVALID_STATE_TRANSITION');
    }
    expect(mocks.prisma.asset.update).not.toHaveBeenCalled();

    // The ONE legal move: authorized reversal back to Retired.
    await service.reverseDisposal(
      superAdmin,
      'asset-1',
      { reason: 'disposed in error' },
      ctx,
    );
    expect(mocks.prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'RETIRED', disposedAt: null }),
      }),
    );
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'asset.disposal_reversed' }),
    );
  });

  it('report-loss closes the assignment as LOST — never "returned"', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(
      assetRow({
        status: 'ASSIGNED',
        custodian: {
          id: 'emp-1',
          employeeNumber: 'EMP-000005',
          firstName: 'Liza',
          lastName: 'Reyes',
          displayName: null,
        },
      }),
    );

    await service.reportLoss(
      superAdmin,
      'asset-1',
      { description: 'left in taxi' },
      ctx,
    );

    expect(mocks.prisma.assetAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'LOST' }),
      }),
    );
    const updateManyData =
      mocks.prisma.assetAssignment.updateMany.mock.calls[0][0].data;
    expect(updateManyData.returnedAt).toBeUndefined();
    expect(mocks.prisma.asset.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'LOST', custodianId: null }),
      }),
    );
  });

  it('retire from Lost is the write-off event', async () => {
    mocks.prisma.asset.findUnique.mockResolvedValue(assetRow({ status: 'LOST' }));
    await service.retire(superAdmin, 'asset-1', { reason: 'unrecoverable' }, ctx);
    expect(mocks.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'asset.retired',
        metadata: expect.objectContaining({ event: 'write-off' }),
      }),
    );
  });
});
