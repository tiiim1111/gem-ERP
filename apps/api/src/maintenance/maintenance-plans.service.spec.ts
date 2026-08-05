import { HttpException } from '@nestjs/common';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { MaintenancePlansService } from './maintenance-plans.service';

/**
 * Unit tests with a fully mocked Prisma client: frequency-mechanism
 * validation, cron plans needing an explicit due date, version conflicts on
 * PATCH, and the covered-asset guards behind PUT :id/assets.
 */

function prismaMock() {
  return {
    maintenancePlan: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    maintenancePlanTask: { deleteMany: jest.fn(), create: jest.fn() },
    maintenancePlanAsset: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    asset: { findMany: jest.fn() },
    supplier: { findUnique: jest.fn() },
    lookupValue: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
}

const admin = {
  id: 'admin-1',
  email: 'admin@x',
  displayName: 'Admin',
  isSuperAdmin: false,
  roles: [],
  permissions: ['maintenance.plan.view', 'maintenance.plan.update'],
  branchIds: ['branch-1'],
  mustChangePassword: false,
};

function planHead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    code: 'MPL-00001',
    isActive: true,
    archivedAt: null,
    intervalDays: 180,
    meterInterval: null,
    scheduleCron: null,
    nextDueAt: new Date('2026-08-19T00:00:00.000Z'),
    ...overrides,
  };
}

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

describe('MaintenancePlansService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: MaintenancePlansService;

  beforeEach(() => {
    prisma = prismaMock();
    service = new MaintenancePlansService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { next: jest.fn().mockResolvedValue(1) } as any,
    );
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
  });

  describe('create — frequency mechanisms', () => {
    it('a plan without any frequency mechanism is rejected', async () => {
      const error = await catchError(
        service.create(
          admin,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { name: 'No frequency', maintenanceTypeId: 'type-1' } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('cron plans need an explicit nextDueAt (no cron parser yet)', async () => {
      prisma.lookupValue.findUnique.mockResolvedValue({
        id: 'type-1',
        category: 'MAINTENANCE_TYPE',
        isActive: true,
      });
      const cronDto = {
        name: 'Monthly cron',
        maintenanceTypeId: 'type-1',
        scheduleCron: '0 0 1 * *',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      const error = await catchError(service.create(admin, cronDto, {}));
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });
  });

  describe('update — optimistic concurrency', () => {
    it('stale version → 409 VERSION_CONFLICT', async () => {
      prisma.maintenancePlan.findUnique.mockResolvedValue(planHead());
      prisma.maintenancePlan.updateMany.mockResolvedValue({ count: 0 });
      const error = await catchError(
        service.update(admin, 'plan-1', { version: 1, name: 'Renamed' }, {}),
      );
      expectAppError(error, 409, 'VERSION_CONFLICT');
    });

    it('stripping the last frequency mechanism is rejected', async () => {
      prisma.maintenancePlan.findUnique.mockResolvedValue(planHead());
      const error = await catchError(
        service.update(admin, 'plan-1', { version: 1, intervalDays: null }, {}),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });
  });

  describe('PUT :id/assets — covered-asset guards', () => {
    it('terminal-status assets cannot be covered', async () => {
      prisma.maintenancePlan.findUnique.mockResolvedValue(planHead());
      prisma.asset.findMany.mockResolvedValue([
        {
          id: 'asset-1',
          assetTag: 'AST-1',
          status: 'RETIRED',
          branchId: 'branch-1',
          archivedAt: null,
        },
      ]);
      const error = await catchError(
        service.replaceAssets(admin, 'plan-1', { assetIds: ['asset-1'] }, {}),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('out-of-scope assets read as nonexistent (no existence leak)', async () => {
      prisma.maintenancePlan.findUnique.mockResolvedValue(planHead());
      prisma.asset.findMany.mockResolvedValue([
        {
          id: 'asset-1',
          assetTag: 'AST-1',
          status: 'AVAILABLE',
          branchId: 'branch-OTHER',
          archivedAt: null,
        },
      ]);
      const error = await catchError(
        service.replaceAssets(admin, 'plan-1', { assetIds: ['asset-1'] }, {}),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('replaces the set wholesale and bumps the version', async () => {
      prisma.maintenancePlan.findUnique
        .mockResolvedValueOnce(planHead())
        .mockResolvedValue(planHead());
      prisma.maintenancePlan.findUniqueOrThrow.mockResolvedValue({
        // Minimal detail row for the response serializer:
        id: 'plan-1',
        code: 'MPL-00001',
        name: 'Plan',
        description: null,
        maintenanceType: { id: 't', code: 'PREVENTIVE', name: 'Preventive' },
        intervalDays: 180,
        meterInterval: null,
        meterType: null,
        scheduleCron: null,
        assignedTeam: null,
        vendor: null,
        estimatedDurationHours: null,
        estimatedCost: null,
        reminderLeadDays: null,
        nextDueAt: null,
        isActive: true,
        version: 2,
        createdBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { assetLinks: 1, tasks: 0 },
        tasks: [],
        assetLinks: [],
      });
      prisma.asset.findMany.mockResolvedValue([
        {
          id: 'asset-1',
          assetTag: 'AST-1',
          status: 'AVAILABLE',
          branchId: 'branch-1',
          archivedAt: null,
        },
      ]);

      await service.replaceAssets(admin, 'plan-1', { assetIds: ['asset-1'] }, {});
      expect(prisma.maintenancePlanAsset.deleteMany).toHaveBeenCalledWith({
        where: { planId: 'plan-1' },
      });
      expect(prisma.maintenancePlanAsset.createMany).toHaveBeenCalledWith({
        data: [{ planId: 'plan-1', assetId: 'asset-1' }],
      });
      expect(prisma.maintenancePlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data: { version: { increment: 1 } },
      });
    });
  });
});
