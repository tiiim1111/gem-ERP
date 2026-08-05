import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { WorkOrdersService } from './work-orders.service';

/**
 * Unit tests with a fully mocked Prisma client — no database. Covers the
 * behaviors the contract cares most about: technician scoping (view-only
 * callers see only their own WOs), version conflicts, the start→Under
 * Maintenance integration, the complete-outcome guards (reason, asset.retire,
 * pre-WO assignment, required checklist), the verify self-block, and the
 * cancel guards (posted parts, asset reversion to the pre-WO status).
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    maintenanceWorkOrder: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    maintenanceWorkOrderTask: {
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
    maintenancePlan: { findUnique: jest.fn(), update: jest.fn() },
    maintenancePart: { findFirst: jest.fn().mockResolvedValue(null) },
    asset: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    assetAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    assetStatusHistory: { create: jest.fn() },
    assetConditionHistory: { create: jest.fn() },
    assetMeterReading: { findFirst: jest.fn().mockResolvedValue(null) },
    lookupValue: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn(), findFirst: jest.fn() },
    supplier: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
    $transaction: jest
      .fn()
      .mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(prismaRef.current),
      ),
  };
}
const prismaRef: { current: ReturnType<typeof prismaMock> } = {
  current: undefined as unknown as ReturnType<typeof prismaMock>,
};

const manager = {
  id: 'mgr-1',
  email: 'mgr@x',
  displayName: 'Manager',
  isSuperAdmin: false,
  roles: [],
  permissions: [
    'maintenance.work_order.view',
    'maintenance.work_order.manage',
    'maintenance.work_order.view_cost',
    'asset.retire',
  ],
  branchIds: ['branch-1'],
  mustChangePassword: false,
};

/** View-only technician — sees/executes only WOs assigned to them. */
const technician = {
  ...manager,
  id: 'tech-user-1',
  permissions: ['maintenance.work_order.view'],
};

function woHead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wo-1',
    workOrderNumber: 'WO-2026-00001',
    status: 'IN_PROGRESS',
    branchId: 'branch-1',
    assetId: 'asset-1',
    planId: null,
    createdById: 'mgr-1',
    completedById: null,
    assignedVendorId: null,
    assignedToEmployee: { id: 'emp-1', userId: 'tech-user-1' },
    actualStartAt: new Date('2026-08-05T08:00:00.000Z'),
    assetStatusBeforeWo: 'AVAILABLE',
    laborCost: null,
    partsCost: new Prisma.Decimal('164.00'),
    externalCost: null,
    version: 3,
    ...overrides,
  };
}

function woDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...woHead(),
    asset: {
      id: 'asset-1',
      assetTag: 'AST-1',
      serialNumber: 'SN-1',
      status: 'UNDER_MAINTENANCE',
      item: { id: 'item-1', sku: 'SKU-1', name: 'Laptop' },
    },
    branch: { id: 'branch-1', code: 'SUB', name: 'Subic' },
    plan: null,
    type: { id: 'type-1', code: 'PREVENTIVE', name: 'Preventive' },
    priority: null,
    problemDescription: 'Overheating',
    reportedBy: null,
    reportedAt: null,
    assignedVendor: null,
    assignedTeam: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    actualEndAt: null,
    holdReason: null,
    cancelReason: null,
    outcomeStatus: null,
    completionCondition: null,
    nextMaintenanceAt: null,
    downtimeMinutes: null,
    laborCost: null,
    partsCost: new Prisma.Decimal('164.00'),
    externalCost: null,
    totalCost: null,
    completedBy: null,
    verifiedBy: null,
    verifiedAt: null,
    canceledBy: null,
    canceledAt: null,
    createdBy: { id: 'mgr-1', displayName: 'Manager', email: 'mgr@x' },
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-05T00:00:00.000Z'),
    diagnosis: null,
    actionTaken: null,
    resolution: null,
    completionMeterReading: null,
    tasks: [],
    parts: [],
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

describe('WorkOrdersService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { log: MockFn };
  let sequences: { next: MockFn };
  let service: WorkOrdersService;

  beforeEach(() => {
    prisma = prismaMock();
    prismaRef.current = prisma;
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    sequences = { next: jest.fn().mockResolvedValue(1) };
    service = new WorkOrdersService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
    );
    prisma.maintenanceWorkOrder.findUniqueOrThrow.mockResolvedValue(woDetailRow());
  });

  describe('technician scoping (contract §6.2 visibility)', () => {
    it('view-only callers are hard-limited to their own WOs on list', async () => {
      await service.list(technician, {});
      const where = prisma.maintenanceWorkOrder.findMany.mock.calls[0][0].where;
      expect(where.assignedToEmployee).toEqual({ userId: 'tech-user-1' });
    });

    it('manage sees branch-wide (no technician filter)', async () => {
      await service.list(manager, {});
      const where = prisma.maintenanceWorkOrder.findMany.mock.calls[0][0].where;
      expect(where.assignedToEmployee).toBeUndefined();
      expect(where.branchId).toEqual({ in: ['branch-1'] });
    });

    it('assignedToMe applies the same filter for managers', async () => {
      await service.list(manager, { assignedToMe: true });
      const where = prisma.maintenanceWorkOrder.findMany.mock.calls[0][0].where;
      expect(where.assignedToEmployee).toEqual({ userId: 'mgr-1' });
    });

    it('a view-only caller fetching an unassigned WO gets 404 (no existence leak)', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ assignedToEmployee: { id: 'emp-9', userId: 'someone-else' } }),
      );
      const error = await catchError(service.getById(technician, 'wo-1'));
      expectAppError(error, 404, 'NOT_FOUND');
    });

    it('the assigned technician can fetch their WO', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(woHead());
      await expect(service.getById(technician, 'wo-1')).resolves.toBeDefined();
    });

    it('out-of-branch WOs are 404 even for managers', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ branchId: 'branch-9' }),
      );
      const error = await catchError(service.getById(manager, 'wo-1'));
      expectAppError(error, 404, 'NOT_FOUND');
    });
  });

  describe('update — optimistic concurrency', () => {
    it('stale version → 409 VERSION_CONFLICT', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'OPEN' }),
      );
      prisma.maintenanceWorkOrder.updateMany.mockResolvedValue({ count: 0 });
      const error = await catchError(
        service.update(manager, 'wo-1', { version: 2, problem: 'x' }, {}),
      );
      expectAppError(error, 409, 'VERSION_CONFLICT');
    });

    it('completed WOs cannot be edited', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'COMPLETED' }),
      );
      const error = await catchError(
        service.update(manager, 'wo-1', { version: 5, problem: 'x' }, {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });
  });

  describe('start — asset goes Under Maintenance via the asset machine', () => {
    it('snapshots the pre-WO status and moves the asset', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'ASSIGNED' }),
      );
      prisma.asset.findUniqueOrThrow.mockResolvedValue({
        id: 'asset-1',
        assetTag: 'AST-1',
        status: 'ASSIGNED',
      });
      prisma.maintenanceWorkOrder.updateMany.mockResolvedValue({ count: 1 });

      await service.start(manager, 'wo-1', {});
      const woData = prisma.maintenanceWorkOrder.updateMany.mock.calls[0][0].data;
      expect(woData.status).toBe('IN_PROGRESS');
      expect(woData.assetStatusBeforeWo).toBe('ASSIGNED');
      const assetCall = prisma.asset.updateMany.mock.calls[0][0];
      expect(assetCall.data.status).toBe('UNDER_MAINTENANCE');
      expect(prisma.assetStatusHistory.create).toHaveBeenCalled();
    });

    it('an In Transfer asset cannot enter maintenance (asset machine guard)', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'SCHEDULED' }),
      );
      prisma.asset.findUniqueOrThrow.mockResolvedValue({
        id: 'asset-1',
        assetTag: 'AST-1',
        status: 'IN_TRANSFER',
      });
      const error = await catchError(service.start(manager, 'wo-1', {}));
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
      expect(prisma.asset.updateMany).not.toHaveBeenCalled();
    });

    it('a non-assigned view-only caller cannot start (403 via 404 scope)', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'ASSIGNED', assignedToEmployee: null }),
      );
      const error = await catchError(service.start(technician, 'wo-1', {}));
      expectAppError(error, 404, 'NOT_FOUND'); // scope check hides it entirely
    });
  });

  describe('complete — outcome guards (spec §18, status-transitions §1.1)', () => {
    function stubComplete(overrides: Record<string, unknown> = {}) {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'IN_PROGRESS', ...overrides }),
      );
      prisma.asset.findUniqueOrThrow.mockResolvedValue({
        id: 'asset-1',
        assetTag: 'AST-1',
        status: 'UNDER_MAINTENANCE',
        custodianId: null,
      });
      prisma.lookupValue.findUnique.mockResolvedValue({
        id: 'cond-good',
        category: 'ASSET_CONDITION',
        isActive: true,
      });
      prisma.maintenanceWorkOrder.updateMany.mockResolvedValue({ count: 1 });
    }
    const baseDto = {
      resolution: 'Fixed.',
      actionTaken: 'Replaced fan.',
      finalConditionId: 'cond-good',
    };

    it('DAMAGED outcome without a reason is rejected', async () => {
      stubComplete();
      const error = await catchError(
        service.complete(
          manager,
          'wo-1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { ...baseDto, assetNextStatus: 'DAMAGED' } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('RETIRED outcome needs asset.retire', async () => {
      stubComplete({ assignedToEmployee: { id: 'emp-1', userId: 'tech-user-1' } });
      const error = await catchError(
        service.complete(
          technician,
          'wo-1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { ...baseDto, assetNextStatus: 'RETIRED', reason: 'beyond repair' } as any,
          {},
        ),
      );
      expectAppError(error, 403, 'FORBIDDEN');
    });

    it('ASSIGNED outcome requires the pre-WO assignment to still be active', async () => {
      stubComplete({ assetStatusBeforeWo: 'ASSIGNED' });
      prisma.assetAssignment.findFirst.mockResolvedValue(null); // closed meanwhile
      const error = await catchError(
        service.complete(
          manager,
          'wo-1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { ...baseDto, assetNextStatus: 'ASSIGNED' } as any,
          {},
        ),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('ASSIGNED outcome is also blocked when the asset was not Assigned pre-WO', async () => {
      stubComplete({ assetStatusBeforeWo: 'AVAILABLE' });
      prisma.assetAssignment.findFirst.mockResolvedValue({ id: 'asg-1' });
      const error = await catchError(
        service.complete(
          manager,
          'wo-1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { ...baseDto, assetNextStatus: 'ASSIGNED' } as any,
          {},
        ),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('open required checklist tasks block completion', async () => {
      stubComplete();
      prisma.maintenanceWorkOrderTask.count.mockResolvedValue(2);
      const error = await catchError(
        service.complete(
          manager,
          'wo-1',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { ...baseDto, assetNextStatus: 'AVAILABLE' } as any,
          {},
        ),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('happy path: asset → outcome, costs totaled, plan re-anchored, history written', async () => {
      stubComplete({ planId: 'plan-1' });
      prisma.maintenancePlan.findUnique.mockResolvedValue({
        id: 'plan-1',
        intervalDays: 180,
        meterInterval: null,
        meterType: null,
        scheduleCron: null,
      });

      const happyDto = {
        ...baseDto,
        assetNextStatus: 'AVAILABLE',
        laborCost: '500.00',
        downtimeMinutes: 180,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
      await service.complete(manager, 'wo-1', happyDto, {});
      const woData = prisma.maintenanceWorkOrder.updateMany.mock.calls[0][0].data;
      expect(woData.status).toBe('COMPLETED');
      expect(woData.totalCost.toString()).toBe('664'); // 500 labor + 164 parts
      expect(woData.downtimeMinutes).toBe(180);
      expect(woData.downtimeHours.toString()).toBe('3');
      expect(woData.outcomeStatus).toBe('AVAILABLE');
      const assetData = prisma.asset.updateMany.mock.calls[0][0].data;
      expect(assetData.status).toBe('AVAILABLE');
      expect(assetData.nextMaintenanceAt).toBeInstanceOf(Date);
      expect(prisma.assetStatusHistory.create).toHaveBeenCalled();
      expect(prisma.assetConditionHistory.create).toHaveBeenCalled();
      expect(prisma.maintenancePlan.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'plan-1' } }),
      );
    });
  });

  describe('verify — supervisor sign-off', () => {
    it('the completer cannot verify their own WO', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'COMPLETED', completedById: 'mgr-1' }),
      );
      const error = await catchError(service.verify(manager, 'wo-1', {}, {}));
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
    });

    it('a different verifier is recorded', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'COMPLETED', completedById: 'tech-user-1' }),
      );
      prisma.maintenanceWorkOrder.updateMany.mockResolvedValue({ count: 1 });
      await service.verify(manager, 'wo-1', {}, {});
      const data = prisma.maintenanceWorkOrder.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('VERIFIED');
      expect(data.verifiedById).toBe('mgr-1');
    });
  });

  describe('cancel — parts guard and asset reversion', () => {
    it('posted, un-reversed parts issues block cancellation', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(woHead());
      prisma.maintenancePart.findFirst.mockResolvedValue({
        stockTransaction: { transactionNumber: 'STK-2026-000009' },
      });
      const error = await catchError(
        service.cancel(manager, 'wo-1', { reason: 'not needed' }, {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('a started WO reverts the asset to its pre-WO status', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ assetStatusBeforeWo: 'ASSIGNED' }),
      );
      prisma.asset.findUniqueOrThrow.mockResolvedValue({
        id: 'asset-1',
        assetTag: 'AST-1',
        status: 'UNDER_MAINTENANCE',
      });
      prisma.maintenanceWorkOrder.updateMany.mockResolvedValue({ count: 1 });

      await service.cancel(manager, 'wo-1', { reason: 'duplicate WO' }, {});
      const woData = prisma.maintenanceWorkOrder.updateMany.mock.calls[0][0].data;
      expect(woData.status).toBe('CANCELED');
      expect(woData.cancelReason).toBe('duplicate WO');
      const assetCall = prisma.asset.updateMany.mock.calls[0][0];
      expect(assetCall.where.status).toBe('UNDER_MAINTENANCE');
      expect(assetCall.data.status).toBe('ASSIGNED');
    });

    it('a never-started WO cancels without touching the asset', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'OPEN', assetStatusBeforeWo: null, actualStartAt: null }),
      );
      prisma.asset.findUniqueOrThrow.mockResolvedValue({
        id: 'asset-1',
        assetTag: 'AST-1',
        status: 'AVAILABLE',
      });
      prisma.maintenanceWorkOrder.updateMany.mockResolvedValue({ count: 1 });

      await service.cancel(manager, 'wo-1', { reason: 'mistake' }, {});
      expect(prisma.asset.updateMany).not.toHaveBeenCalled();
    });

    it('verified WOs are terminal', async () => {
      prisma.maintenanceWorkOrder.findUnique.mockResolvedValue(
        woHead({ status: 'VERIFIED' }),
      );
      const error = await catchError(
        service.cancel(manager, 'wo-1', { reason: 'x' }, {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });
  });
});
