import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { StockPostingService } from './stock-posting.service';

/**
 * Posting-engine unit tests with a fully mocked Prisma client. The
 * concurrency behavior of the guarded SQL itself is proven separately by the
 * manual tsx integration test against the live database; here we verify the
 * engine's decision logic: negative-stock guard handling, idempotency
 * replay/conflict resolution, lot-expiry enforcement, and reversal sign math.
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    stockTransaction: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    stockTransactionLine: { create: jest.fn() },
    stockLedgerEntry: { createMany: jest.fn() },
    stockBalance: { update: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
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

const KEY = 'test-idempotency-key-0001';

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    transactionNumber: 'STK-2026-000001',
    type: 'ISSUE_TO_EMPLOYEE',
    status: 'POSTED',
    transactionDate: new Date('2026-07-01T00:00:00.000Z'),
    branch: { id: 'branch-1', code: 'SUB', name: 'Subic' },
    sourceBranch: null,
    destinationBranch: null,
    sourceWarehouse: { id: 'wh-1', code: 'SUB-WH1', name: 'Subic WH' },
    destinationWarehouse: null,
    employee: null,
    department: null,
    supplier: null,
    reason: null,
    transferId: null,
    workOrderId: null,
    projectRef: null,
    notes: null,
    reversalOfId: null,
    version: 2,
    createdBy: { id: 'admin-1', displayName: 'Admin', email: 'admin@x' },
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    postedBy: null,
    postedAt: new Date('2026-07-01T01:00:00.000Z'),
    canceledBy: null,
    canceledAt: null,
    reversedBy: null,
    reversedAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T01:00:00.000Z'),
    lines: [],
    ledgerEntries: [],
    reversals: [],
    reversalOf: null,
    ...overrides,
  };
}

/** Head row returned for the pre-transaction status/branch check. */
function headRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    status: 'APPROVED',
    branchId: 'branch-1',
    transferId: null,
    transactionNumber: 'STK-2026-000001',
    type: 'ISSUE_TO_EMPLOYEE',
    ...overrides,
  };
}

function issueTxn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    type: 'ISSUE_TO_EMPLOYEE',
    status: 'POSTED',
    branchId: 'branch-1',
    sourceWarehouseId: 'wh-1',
    destinationWarehouseId: null,
    lines: [
      {
        id: 'line-1',
        lineNumber: 1,
        itemId: 'item-1',
        lotId: null,
        sourceLocationId: null,
        destinationLocationId: null,
        baseQuantity: new Prisma.Decimal(5),
        totalCost: null,
        item: { id: 'item-1', sku: 'SKU-OFC-00001' },
        lot: null,
      },
    ],
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

describe('StockPostingService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { log: MockFn };
  let sequences: { next: MockFn };
  let service: StockPostingService;

  beforeEach(() => {
    prisma = prismaMock();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    sequences = { next: jest.fn().mockResolvedValue(2) };
    service = new StockPostingService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
    );
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    // $queryRaw serves two statements: the advisory bucket lock (returns
    // nothing meaningful) and the balance-row select (overridden per test).
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) =>
      strings.join('').includes('pg_advisory_xact_lock')
        ? Promise.resolve([])
        : Promise.resolve([]),
    );
  });

  /** Route findUnique calls by their arguments (replay check vs head vs detail). */
  function routeFindUnique(options: {
    byKey?: unknown;
    head?: unknown;
    detail?: unknown;
  }): void {
    prisma.stockTransaction.findUnique.mockImplementation(
      (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        if (args.where.idempotencyKey) {
          return Promise.resolve(options.byKey ?? null);
        }
        if (args.select && 'ledgerEntries' in args.select) {
          return Promise.resolve(options.detail ?? null);
        }
        return Promise.resolve(options.head ?? null);
      },
    );
  }

  function stubBalanceRow(row: { onHand: string; reserved: string } | null): void {
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join('');
      if (sql.includes('pg_advisory_xact_lock')) {
        return Promise.resolve([]);
      }
      return Promise.resolve(
        row
          ? [{ id: 'bal-1', on_hand: row.onHand, reserved: row.reserved, in_transit: '0' }]
          : [],
      );
    });
  }

  describe('idempotency', () => {
    it('requires the Idempotency-Key header (400 VALIDATION_ERROR)', async () => {
      const error = await catchError(
        service.post(superAdmin, 'txn-1', undefined, {}, {}),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('replays the original result for a repeated key — no second movement', async () => {
      routeFindUnique({
        byKey: { id: 'txn-1', status: 'POSTED', type: 'ISSUE_TO_EMPLOYEE', reversalOfId: null, branchId: 'branch-1' },
        detail: detailRow(),
      });
      const result = await service.post(superAdmin, 'txn-1', KEY, {}, {});
      expect(result.id).toBe('txn-1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.stockLedgerEntry.createMany).not.toHaveBeenCalled();
    });

    it('rejects the same key pointed at a different transaction (409 IDEMPOTENCY_CONFLICT)', async () => {
      routeFindUnique({
        byKey: { id: 'txn-OTHER', status: 'POSTED', type: 'ISSUE_TO_EMPLOYEE', reversalOfId: null, branchId: 'branch-1' },
      });
      const error = await catchError(service.post(superAdmin, 'txn-1', KEY, {}, {}));
      expectAppError(error, 409, 'IDEMPOTENCY_CONFLICT');
    });
  });

  describe('negative-stock guard', () => {
    it('collects per-line INSUFFICIENT_STOCK details when the guarded UPDATE matches no row', async () => {
      routeFindUnique({ head: headRow() });
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockTransaction.findUniqueOrThrow.mockResolvedValue(issueTxn());
      stubBalanceRow({ onHand: '3', reserved: '0' });
      // The conditional UPDATE (on_hand - reserved >= needed) touches 0 rows.
      prisma.$executeRaw.mockResolvedValue(0);

      const error = await catchError(service.post(superAdmin, 'txn-1', KEY, {}, {}));
      expectAppError(error, 409, 'INSUFFICIENT_STOCK');
      const details = (
        (error as HttpException).getResponse() as {
          error: { details: Array<{ field: string; message: string }> };
        }
      ).error.details;
      expect(details).toHaveLength(1);
      expect(details[0].field).toBe('lines[1]');
      expect(details[0].message).toContain('requested 5');
      expect(details[0].message).toContain('available 3');
      // Nothing was written to the immutable ledger.
      expect(prisma.stockLedgerEntry.createMany).not.toHaveBeenCalled();
    });

    it('treats a missing balance row as zero availability', async () => {
      routeFindUnique({ head: headRow() });
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockTransaction.findUniqueOrThrow.mockResolvedValue(issueTxn());
      stubBalanceRow(null);

      const error = await catchError(service.post(superAdmin, 'txn-1', KEY, {}, {}));
      expectAppError(error, 409, 'INSUFFICIENT_STOCK');
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('writes signed ledger entries and decrements the balance on success', async () => {
      routeFindUnique({ head: headRow(), detail: detailRow() });
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockTransaction.findUniqueOrThrow.mockResolvedValue(issueTxn());
      stubBalanceRow({ onHand: '10', reserved: '0' });
      prisma.$executeRaw.mockResolvedValue(1);

      await service.post(superAdmin, 'txn-1', KEY, {}, {});
      const entries = prisma.stockLedgerEntry.createMany.mock.calls[0][0].data;
      expect(entries).toHaveLength(1);
      expect(entries[0].quantityDelta.toString()).toBe('-5');
      expect(entries[0].warehouseId).toBe('wh-1');
      // Post claim was conditional on APPROVED and stamped the key.
      const claim = prisma.stockTransaction.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({ id: 'txn-1', status: 'APPROVED' });
      expect(claim.data.idempotencyKey).toBe(KEY);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'stock_transaction.posted' }),
      );
    });

    it('refuses posting from a non-APPROVED status (guard inside the claim)', async () => {
      routeFindUnique({ head: headRow({ status: 'DRAFT' }) });
      const error = await catchError(service.post(superAdmin, 'txn-1', KEY, {}, {}));
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
      expect(prisma.stockTransaction.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('lot expiry (FEFO enforcement)', () => {
    function expiredLotTxn() {
      return issueTxn({
        lines: [
          {
            id: 'line-1',
            lineNumber: 1,
            itemId: 'item-1',
            lotId: 'lot-1',
            sourceLocationId: null,
            destinationLocationId: null,
            baseQuantity: new Prisma.Decimal(2),
            totalCost: null,
            item: { id: 'item-1', sku: 'SKU-PPE-00001' },
            lot: {
              id: 'lot-1',
              lotNumber: 'LOT-PPE-00001-20250101-01',
              expiryDate: new Date('2025-01-01T00:00:00.000Z'),
            },
          },
        ],
      });
    }

    it('blocks issuing from an expired lot with 409 LOT_EXPIRED', async () => {
      routeFindUnique({ head: headRow() });
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockTransaction.findUniqueOrThrow.mockResolvedValue(expiredLotTxn());

      const error = await catchError(service.post(superAdmin, 'txn-1', KEY, {}, {}));
      expectAppError(error, 409, 'LOT_EXPIRED');
    });

    it('requires inventory.adjust to override the expired-lot block', async () => {
      const poster = {
        ...superAdmin,
        isSuperAdmin: false,
        permissions: ['inventory.post'],
        branchIds: ['branch-1'],
      };
      const error = await catchError(
        service.post(poster, 'txn-1', KEY, { allowExpiredLots: true }, {}),
      );
      expectAppError(error, 403, 'FORBIDDEN');
    });

    it('allows the override for holders of inventory.adjust', async () => {
      routeFindUnique({ head: headRow(), detail: detailRow() });
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockTransaction.findUniqueOrThrow.mockResolvedValue(expiredLotTxn());
      stubBalanceRow({ onHand: '10', reserved: '0' });
      prisma.$executeRaw.mockResolvedValue(1);

      await service.post(superAdmin, 'txn-1', KEY, { allowExpiredLots: true }, {});
      expect(prisma.stockLedgerEntry.createMany).toHaveBeenCalled();
    });
  });

  describe('reversal sign math', () => {
    function postedOriginal() {
      return {
        id: 'txn-1',
        transactionNumber: 'STK-2026-000001',
        type: 'NON_PURCHASE_RECEIPT',
        status: 'POSTED',
        branchId: 'branch-1',
        sourceBranchId: null,
        destinationBranchId: null,
        sourceWarehouseId: null,
        destinationWarehouseId: 'wh-1',
        employeeId: null,
        departmentId: null,
        supplierId: null,
        projectRef: null,
        transferId: null,
        lines: [
          {
            id: 'line-1',
            lineNumber: 1,
            itemId: 'item-1',
            lotId: null,
            sourceLocationId: null,
            destinationLocationId: 'loc-1',
            enteredUomId: 'uom-box',
            enteredQuantity: new Prisma.Decimal(2),
            baseQuantity: new Prisma.Decimal(2000),
            unitCost: new Prisma.Decimal('2400.00'),
            totalCost: new Prisma.Decimal('4800.00'),
          },
        ],
        ledgerEntries: [
          {
            id: 'led-1',
            transactionLineId: 'line-1',
            itemId: 'item-1',
            lotId: null,
            branchId: 'branch-1',
            warehouseId: 'wh-1',
            storageLocationId: 'loc-1',
            quantityDelta: new Prisma.Decimal(2000),
            unitCost: new Prisma.Decimal('2.40'),
          },
        ],
      };
    }

    function stubReversalFlow() {
      prisma.stockTransaction.findUnique.mockImplementation(
        (args: { where: Record<string, unknown>; include?: unknown; select?: Record<string, unknown> }) => {
          if (args.where.idempotencyKey) {
            return Promise.resolve(null);
          }
          if (args.include) {
            return Promise.resolve(postedOriginal());
          }
          return Promise.resolve(
            detailRow({ id: 'rev-1', type: 'REVERSAL', reversalOfId: 'txn-1' }),
          );
        },
      );
      prisma.stockTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockTransaction.create.mockResolvedValue({
        id: 'rev-1',
        transactionNumber: 'STK-2026-000002',
      });
      prisma.stockTransactionLine.create.mockResolvedValue({
        id: 'rev-line-1',
        lineNumber: 1,
      });
      stubBalanceRow({ onHand: '2000', reserved: '0' });
      prisma.$executeRaw.mockResolvedValue(1);
    }

    it('creates a linked REVERSAL whose entries negate the original exactly', async () => {
      stubReversalFlow();
      const result = await service.reverse(
        superAdmin,
        'txn-1',
        KEY,
        { reason: 'wrong warehouse' },
        {},
      );

      // Original claimed POSTED → REVERSED, never edited beyond status/audit.
      const claim = prisma.stockTransaction.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({ id: 'txn-1', status: 'POSTED' });
      expect(claim.data.status).toBe('REVERSED');

      // Reversal document links back and posts immediately with the key.
      const created = prisma.stockTransaction.create.mock.calls[0][0].data;
      expect(created.type).toBe('REVERSAL');
      expect(created.reversalOfId).toBe('txn-1');
      expect(created.status).toBe('POSTED');
      expect(created.idempotencyKey).toBe(KEY);

      // Sign math: +2000 becomes -2000, same bucket, same unit cost.
      const entries = prisma.stockLedgerEntry.createMany.mock.calls[0][0].data;
      expect(entries).toHaveLength(1);
      expect(entries[0].quantityDelta.toString()).toBe('-2000');
      expect(entries[0].warehouseId).toBe('wh-1');
      expect(entries[0].storageLocationId).toBe('loc-1');
      expect(entries[0].unitCost.toString()).toBe('2.4');
      expect(result.id).toBe('rev-1');
    });

    it('refuses to reverse when the received stock is no longer on hand', async () => {
      stubReversalFlow();
      stubBalanceRow({ onHand: '100', reserved: '0' });
      prisma.$executeRaw.mockResolvedValue(0);

      const error = await catchError(
        service.reverse(superAdmin, 'txn-1', KEY, { reason: 'oops' }, {}),
      );
      expectAppError(error, 409, 'INSUFFICIENT_STOCK');
    });

    it('never reverses a reversal', async () => {
      prisma.stockTransaction.findUnique.mockImplementation(
        (args: { where: Record<string, unknown>; include?: unknown }) => {
          if (args.where.idempotencyKey) {
            return Promise.resolve(null);
          }
          return Promise.resolve({
            ...postedOriginal(),
            type: 'REVERSAL',
          });
        },
      );
      const error = await catchError(
        service.reverse(superAdmin, 'txn-1', KEY, { reason: 'nope' }, {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });
  });
});
