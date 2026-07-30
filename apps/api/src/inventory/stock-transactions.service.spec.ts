import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { StockTransactionsService } from './stock-transactions.service';

/**
 * Unit tests with a fully mocked Prisma client — no database. Covers the
 * document-side Phase 3 rules: per-type permissions, line-level UOM
 * normalization, lot requirements, status-transition guards, auto-approval
 * on submit, and the self-approval block.
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    stockTransaction: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    stockTransactionLine: {
      count: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    item: { findMany: jest.fn() },
    uomConversion: { findMany: jest.fn() },
    unitOfMeasure: { count: jest.fn() },
    inventoryLot: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    storageLocation: { findMany: jest.fn() },
    stockBalance: { findMany: jest.fn().mockResolvedValue([]) },
    warehouse: { findUnique: jest.fn() },
    employee: { findUnique: jest.fn() },
    department: { findUnique: jest.fn() },
    supplier: { findUnique: jest.fn() },
    lookupValue: { findFirst: jest.fn() },
    approvalWorkflow: { findFirst: jest.fn() },
    $transaction: jest.fn(),
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

function txnDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    transactionNumber: 'STK-2026-000001',
    type: 'NON_PURCHASE_RECEIPT',
    status: 'DRAFT',
    transactionDate: new Date('2026-07-01T00:00:00.000Z'),
    branch: { id: 'branch-1', code: 'SUB', name: 'Subic' },
    sourceBranch: null,
    destinationBranch: null,
    sourceWarehouse: null,
    destinationWarehouse: { id: 'wh-1', code: 'SUB-WH1', name: 'Subic WH' },
    employee: null,
    department: null,
    supplier: null,
    reason: null,
    transferId: null,
    workOrderId: null,
    projectRef: null,
    notes: null,
    reversalOfId: null,
    version: 1,
    createdBy: { id: 'admin-1', displayName: 'Admin', email: 'admin@x' },
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    postedBy: null,
    postedAt: null,
    canceledBy: null,
    canceledAt: null,
    reversedBy: null,
    reversedAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    lines: [],
    ledgerEntries: [],
    reversals: [],
    reversalOf: null,
    ...overrides,
  };
}

function txnHead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    status: 'DRAFT',
    type: 'NON_PURCHASE_RECEIPT',
    branchId: 'branch-1',
    createdById: 'admin-1',
    transferId: null,
    notes: null,
    employeeId: null,
    departmentId: null,
    supplierId: null,
    sourceWarehouseId: null,
    destinationWarehouseId: 'wh-1',
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

describe('StockTransactionsService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { log: MockFn };
  let sequences: { next: MockFn };
  let service: StockTransactionsService;

  beforeEach(() => {
    prisma = prismaMock();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    sequences = { next: jest.fn().mockResolvedValue(1) };
    service = new StockTransactionsService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
    );
  });

  function stubCatalog(itemOverrides: Record<string, unknown> = {}): void {
    prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-1',
      branchId: 'branch-1',
      isActive: true,
    });
    prisma.item.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sku: 'SKU-OFC-00001',
        name: 'Bond Paper',
        isActive: true,
        trackingMethod: 'QUANTITY',
        isExpiryTracked: false,
        baseUomId: 'uom-pc',
        uomConversions: [],
        ...itemOverrides,
      },
    ]);
    // Global chain: 1 BOX = 10 PACK, 1 PACK = 100 PC → 1 BOX = 1000 PC.
    prisma.uomConversion.findMany.mockResolvedValue([
      { fromUomId: 'uom-box', toUomId: 'uom-pack', factor: '10' },
      { fromUomId: 'uom-pack', toUomId: 'uom-pc', factor: '100' },
    ]);
    prisma.unitOfMeasure.count.mockResolvedValue(1);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    prisma.stockTransaction.create.mockResolvedValue({
      id: 'txn-1',
      transactionNumber: 'STK-2026-000001',
    });
    prisma.stockTransactionLine.create.mockResolvedValue({ id: 'line-1' });
    prisma.stockTransaction.findUnique.mockResolvedValue(txnDetailRow());
  }

  describe('create — UOM normalization at line level', () => {
    it('normalizes 2 BOX to 2000 PC through the conversion chain', async () => {
      stubCatalog();
      await service.create(
        superAdmin,
        {
          type: 'NON_PURCHASE_RECEIPT',
          branchId: 'branch-1',
          warehouseId: 'wh-1',
          lines: [{ itemId: 'item-1', uomId: 'uom-box', quantity: '2' }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {},
      );
      const lineData = prisma.stockTransactionLine.create.mock.calls[0][0].data;
      expect(lineData.enteredQuantity.toString()).toBe('2');
      expect(lineData.enteredUomId).toBe('uom-box');
      expect(lineData.baseQuantity.toString()).toBe('2000');
    });

    it('rejects units with no conversion path to the base unit', async () => {
      stubCatalog();
      const error = await catchError(
        service.create(
          superAdmin,
          {
            type: 'NON_PURCHASE_RECEIPT',
            branchId: 'branch-1',
            warehouseId: 'wh-1',
            lines: [{ itemId: 'item-1', uomId: 'uom-ream', quantity: '1' }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('computes totalCost from the entered quantity and unit cost', async () => {
      stubCatalog();
      await service.create(
        superAdmin,
        {
          type: 'NON_PURCHASE_RECEIPT',
          branchId: 'branch-1',
          warehouseId: 'wh-1',
          lines: [
            { itemId: 'item-1', uomId: 'uom-box', quantity: '2', unitCost: '2400.00' },
          ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {},
      );
      const lineData = prisma.stockTransactionLine.create.mock.calls[0][0].data;
      expect(lineData.totalCost.toString()).toBe('4800');
    });
  });

  describe('create — lot and type rules', () => {
    it('requires a lot reference on LOT-tracked items', async () => {
      stubCatalog({ trackingMethod: 'LOT' });
      const error = await catchError(
        service.create(
          superAdmin,
          {
            type: 'NON_PURCHASE_RECEIPT',
            branchId: 'branch-1',
            warehouseId: 'wh-1',
            lines: [{ itemId: 'item-1', uomId: 'uom-pc', quantity: '5' }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('refuses direct creation of system-generated types', async () => {
      const error = await catchError(
        service.create(
          superAdmin,
          {
            type: 'REVERSAL',
            branchId: 'branch-1',
            warehouseId: 'wh-1',
            lines: [{ itemId: 'item-1', uomId: 'uom-pc', quantity: '1' }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('enforces the per-type permission (receipts need inventory.receive)', async () => {
      const clerk = {
        ...superAdmin,
        isSuperAdmin: false,
        permissions: ['inventory.issue'],
        branchIds: ['branch-1'],
      };
      const error = await catchError(
        service.create(
          clerk,
          {
            type: 'NON_PURCHASE_RECEIPT',
            branchId: 'branch-1',
            warehouseId: 'wh-1',
            lines: [{ itemId: 'item-1', uomId: 'uom-pc', quantity: '1' }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 403, 'FORBIDDEN');
    });
  });

  describe('status-transition guards', () => {
    it('rejects PATCH on a POSTED transaction', async () => {
      prisma.stockTransaction.findUnique.mockResolvedValue(
        txnHead({ status: 'POSTED' }),
      );
      const error = await catchError(
        service.update(superAdmin, 'txn-1', { version: 1 }, {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('rejects approving a DRAFT (submit first)', async () => {
      prisma.stockTransaction.findUnique.mockResolvedValue(
        txnHead({ status: 'DRAFT', createdById: 'someone-else' }),
      );
      const error = await catchError(service.approve(superAdmin, 'txn-1', {}, {}));
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('surfaces a stale version as 409 VERSION_CONFLICT', async () => {
      prisma.stockTransaction.findUnique.mockResolvedValue(txnHead());
      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
      );
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 0 });
      const error = await catchError(
        service.update(superAdmin, 'txn-1', { version: 7 }, {}),
      );
      expectAppError(error, 409, 'VERSION_CONFLICT');
    });
  });

  describe('submit — auto-approval without a workflow (Phase 6 pending)', () => {
    it('advances DRAFT straight to APPROVED and records why', async () => {
      prisma.stockTransaction.findUnique
        .mockResolvedValueOnce(txnHead())
        .mockResolvedValue(txnDetailRow({ status: 'APPROVED' }));
      prisma.stockTransactionLine.count.mockResolvedValue(1);
      prisma.approvalWorkflow.findFirst.mockResolvedValue(null);
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });

      await service.submit(superAdmin, 'txn-1', {});
      const updateArgs = prisma.stockTransaction.updateMany.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'txn-1', status: 'DRAFT' });
      expect(updateArgs.data.status).toBe('APPROVED');
      expect(updateArgs.data.notes).toContain('auto-approved');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'stock_transaction.submitted_auto_approved',
        }),
      );
    });

    it('routes to PENDING_APPROVAL when a matching workflow exists', async () => {
      prisma.stockTransaction.findUnique
        .mockResolvedValueOnce(txnHead())
        .mockResolvedValue(txnDetailRow({ status: 'PENDING_APPROVAL' }));
      prisma.stockTransactionLine.count.mockResolvedValue(1);
      prisma.approvalWorkflow.findFirst.mockResolvedValue({ id: 'wf-1' });
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });

      await service.submit(superAdmin, 'txn-1', {});
      expect(
        prisma.stockTransaction.updateMany.mock.calls[0][0].data.status,
      ).toBe('PENDING_APPROVAL');
    });
  });

  describe('approve — self-approval block', () => {
    it('refuses the requester approving their own document (409 SELF_APPROVAL_FORBIDDEN)', async () => {
      prisma.stockTransaction.findUnique.mockResolvedValue(
        txnHead({ status: 'PENDING_APPROVAL', createdById: 'admin-1' }),
      );
      const error = await catchError(service.approve(superAdmin, 'txn-1', {}, {}));
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
      expect(prisma.stockTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('rejects need a comment and also block self-decisions', async () => {
      prisma.stockTransaction.findUnique.mockResolvedValue(
        txnHead({ status: 'PENDING_APPROVAL', createdById: 'admin-1' }),
      );
      const error = await catchError(
        service.reject(superAdmin, 'txn-1', { comment: 'no' }, {}),
      );
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
    });

    it('lets a different approver through', async () => {
      prisma.stockTransaction.findUnique
        .mockResolvedValueOnce(
          txnHead({ status: 'PENDING_APPROVAL', createdById: 'other-user' }),
        )
        .mockResolvedValue(txnDetailRow({ status: 'APPROVED' }));
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });

      await service.approve(superAdmin, 'txn-1', {}, {});
      expect(
        prisma.stockTransaction.updateMany.mock.calls[0][0].data.status,
      ).toBe('APPROVED');
    });
  });

  describe('quantity precision', () => {
    it('keeps 4-decimal precision through Decimal math (no float drift)', async () => {
      stubCatalog();
      await service.create(
        superAdmin,
        {
          type: 'NON_PURCHASE_RECEIPT',
          branchId: 'branch-1',
          warehouseId: 'wh-1',
          lines: [{ itemId: 'item-1', uomId: 'uom-pack', quantity: '0.3' }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {},
      );
      const lineData = prisma.stockTransactionLine.create.mock.calls[0][0].data;
      // 0.3 PACK × 100 = exactly 30 PC (0.30000000000000004 would betray floats).
      expect(lineData.baseQuantity.equals(new Prisma.Decimal(30))).toBe(true);
    });
  });
});
