import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import { WorkOrderPartsService } from './work-order-parts.service';

/**
 * Unit tests for the parts-issue ↔ stock integration: the MAINTENANCE_ISSUE
 * transaction is created AND posted through StockPostingService.postWithinTx
 * inside the SAME database transaction, INSUFFICIENT_STOCK propagates
 * untouched (rolling everything back), costs roll into the WO, and an
 * AWAITING_PARTS work order resumes (parts-received).
 */

function prismaMock() {
  return {
    warehouse: { findUnique: jest.fn() },
    item: { findMany: jest.fn() },
    unitOfMeasure: { findMany: jest.fn() },
    uomConversion: { findMany: jest.fn().mockResolvedValue([]) },
    stockTransaction: {
      create: jest.fn().mockResolvedValue({ id: 'txn-1' }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    stockTransactionLine: { create: jest.fn() },
    maintenancePart: {
      create: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    maintenanceWorkOrder: { update: jest.fn() },
    $transaction: jest.fn(),
  };
}

const manager = {
  id: 'mgr-1',
  email: 'mgr@x',
  displayName: 'Manager',
  isSuperAdmin: false,
  roles: [],
  permissions: [
    'maintenance.work_order.view',
    'maintenance.work_order.manage',
    'inventory.issue',
  ],
  branchIds: ['branch-1'],
  mustChangePassword: false,
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
    assignedToEmployee: null,
    actualStartAt: new Date(),
    assetStatusBeforeWo: 'AVAILABLE',
    laborCost: new Prisma.Decimal('500.00'),
    partsCost: null,
    externalCost: null,
    version: 3,
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

describe('WorkOrderPartsService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let workOrders: {
    requireWo: jest.Mock;
    assertExecuteAllowed: jest.Mock;
  };
  let posting: { postWithinTx: jest.Mock };
  let audit: { log: jest.Mock };
  let sequences: { next: jest.Mock };
  let service: WorkOrderPartsService;

  const dto = {
    warehouseId: 'wh-1',
    lines: [
      { itemId: 'item-1', uomId: 'uom-pc', quantity: '2', unitCost: '82.00' },
    ],
  };

  beforeEach(() => {
    prisma = prismaMock();
    workOrders = {
      requireWo: jest.fn().mockResolvedValue(woHead()),
      assertExecuteAllowed: jest.fn(),
    };
    posting = { postWithinTx: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    sequences = { next: jest.fn().mockResolvedValue(9) };
    service = new WorkOrderPartsService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      workOrders as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      posting as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
    );

    prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-1',
      branchId: 'branch-1',
      isActive: true,
    });
    prisma.item.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sku: 'SKU-PPE-00001',
        isActive: true,
        archivedAt: null,
        baseUomId: 'uom-pc',
        trackingMethod: 'QUANTITY',
        lastPurchaseCost: new Prisma.Decimal('82.00'),
        uomConversions: [],
      },
    ]);
    prisma.unitOfMeasure.findMany.mockResolvedValue([
      { id: 'uom-pc', isActive: true },
    ]);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
  });

  it('creates a MAINTENANCE_ISSUE and posts it through the engine in the same tx', async () => {
    await service.create(manager, 'wo-1', dto, undefined, {});

    // The stock document: MAINTENANCE_ISSUE, APPROVED (postWithinTx claims
    // APPROVED→POSTED), linked to the WO, sourced from the WO's branch.
    const txnData = prisma.stockTransaction.create.mock.calls[0][0].data;
    expect(txnData.type).toBe('MAINTENANCE_ISSUE');
    expect(txnData.status).toBe('APPROVED');
    expect(txnData.workOrderId).toBe('wo-1');
    expect(txnData.sourceWarehouseId).toBe('wh-1');
    expect(txnData.branchId).toBe('branch-1');

    // Posting flows through the SHARED engine with the SAME tx client.
    expect(posting.postWithinTx).toHaveBeenCalledTimes(1);
    expect(posting.postWithinTx.mock.calls[0][0]).toBe(prisma); // tx client
    expect(posting.postWithinTx.mock.calls[0][1]).toBe('txn-1');

    // MaintenancePart row links WO ↔ stock transaction with rolled-up cost.
    const partData = prisma.maintenancePart.create.mock.calls[0][0].data;
    expect(partData.workOrderId).toBe('wo-1');
    expect(partData.stockTransactionId).toBe('txn-1');
    expect(partData.totalCost.toString()).toBe('164');

    // Costs roll into the WO: parts 164 + labor 500 = 664 total.
    const woUpdate = prisma.maintenanceWorkOrder.update.mock.calls[0][0].data;
    expect(woUpdate.partsCost.toString()).toBe('164');
    expect(woUpdate.totalCost.toString()).toBe('664');
    expect(woUpdate.status).toBeUndefined(); // IN_PROGRESS stays
  });

  it('INSUFFICIENT_STOCK from the posting engine surfaces as-is and rolls back', async () => {
    posting.postWithinTx.mockRejectedValue(
      new AppException(409, 'INSUFFICIENT_STOCK', 'Posting would drive stock below zero.'),
    );
    const error = await catchError(
      service.create(manager, 'wo-1', dto, undefined, {}),
    );
    expectAppError(error, 409, 'INSUFFICIENT_STOCK');
    // The part rows come after posting — nothing was linked.
    expect(prisma.maintenancePart.create).not.toHaveBeenCalled();
    expect(prisma.maintenanceWorkOrder.update).not.toHaveBeenCalled();
  });

  it('an AWAITING_PARTS work order resumes on the posted issue (parts-received)', async () => {
    workOrders.requireWo.mockResolvedValue(woHead({ status: 'AWAITING_PARTS' }));
    await service.create(manager, 'wo-1', dto, undefined, {});
    const woUpdate = prisma.maintenanceWorkOrder.update.mock.calls[0][0].data;
    expect(woUpdate.status).toBe('IN_PROGRESS');
    expect(woUpdate.holdReason).toBeNull();
  });

  it('serialized items are not consumable spare parts', async () => {
    prisma.item.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sku: 'SKU-LAP-00001',
        isActive: true,
        archivedAt: null,
        baseUomId: 'uom-pc',
        trackingMethod: 'SERIAL',
        lastPurchaseCost: null,
        uomConversions: [],
      },
    ]);
    const error = await catchError(
      service.create(manager, 'wo-1', dto, undefined, {}),
    );
    expectAppError(error, 400, 'VALIDATION_ERROR');
    expect(prisma.stockTransaction.create).not.toHaveBeenCalled();
  });

  it("parts must come from the work order's branch", async () => {
    prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-1',
      branchId: 'branch-OTHER',
      isActive: true,
    });
    const error = await catchError(
      service.create(manager, 'wo-1', dto, undefined, {}),
    );
    expectAppError(error, 400, 'VALIDATION_ERROR');
  });

  it('parts cannot be issued to a WO that has not started', async () => {
    workOrders.requireWo.mockResolvedValue(woHead({ status: 'OPEN' }));
    const error = await catchError(
      service.create(manager, 'wo-1', dto, undefined, {}),
    );
    expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
  });

  it('an Idempotency-Key replay returns the original result without re-posting', async () => {
    prisma.stockTransaction.findUnique.mockResolvedValue({
      id: 'txn-1',
      workOrderId: 'wo-1',
      type: 'MAINTENANCE_ISSUE',
    });
    await service.create(manager, 'wo-1', dto, 'key-123', {});
    expect(prisma.stockTransaction.create).not.toHaveBeenCalled();
    expect(posting.postWithinTx).not.toHaveBeenCalled();
  });

  it('the same key pointed at a different WO is an IDEMPOTENCY_CONFLICT', async () => {
    prisma.stockTransaction.findUnique.mockResolvedValue({
      id: 'txn-1',
      workOrderId: 'wo-OTHER',
      type: 'MAINTENANCE_ISSUE',
    });
    const error = await catchError(
      service.create(manager, 'wo-1', dto, 'key-123', {}),
    );
    expectAppError(error, 409, 'IDEMPOTENCY_CONFLICT');
  });
});
