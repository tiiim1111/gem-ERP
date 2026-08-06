import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { TransfersService } from './transfers.service';

/**
 * Unit tests with mocked Prisma + posting engine. Focus: the transfer state
 * machine, self-approval block, and the receive short/damaged accounting —
 * received + damaged arrive on-hand at the destination, short quantities
 * never do, and the in-transit bucket is cleared for the full dispatched
 * amount.
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    transfer: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
    transferLine: {
      count: jest.fn(),
      update: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { baseQuantity: null } }),
    },
    transferReceipt: { create: jest.fn() },
    transferReceiptLine: { create: jest.fn() },
    stockTransaction: { findUnique: jest.fn(), create: jest.fn() },
    stockTransactionLine: { create: jest.fn() },
    storageLocation: { findUnique: jest.fn() },
    warehouse: { findUnique: jest.fn() },
    item: { findMany: jest.fn() },
    uomConversion: { findMany: jest.fn() },
    inventoryLot: { findMany: jest.fn() },
    lookupValue: { findFirst: jest.fn() },
    approvalWorkflow: { findFirst: jest.fn() },
    $transaction: jest.fn(),
  };
}

function postingMock() {
  return {
    postWithinTx: jest.fn().mockResolvedValue(undefined),
    applyInTransitDelta: jest.fn().mockResolvedValue({ ok: true }),
    applyOnHandDelta: jest.fn().mockResolvedValue({ ok: true }),
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

const KEY = 'transfer-idempotency-key-01';

const D = (value: string | number) => new Prisma.Decimal(value);

function transferLine(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tl-1',
    transferId: 'trf-1',
    lineNumber: 1,
    itemId: 'item-1',
    assetId: null,
    lotId: null,
    uomId: 'uom-pc',
    quantity: D(10),
    baseQuantity: D(10),
    dispatchedQuantity: D(10),
    receivedQuantity: D(0),
    damagedQuantity: D(0),
    shortQuantity: D(0),
    rejectedQuantity: D(0),
    notes: null,
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    ...overrides,
  };
}

function transferWithLines(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trf-1',
    transferNumber: 'TRF-2026-00001',
    type: 'INTER_BRANCH',
    status: 'IN_TRANSIT',
    sourceBranchId: 'branch-sub',
    sourceWarehouseId: 'wh-sub',
    sourceLocationId: 'loc-sub',
    destinationBranchId: 'branch-mkt',
    destinationWarehouseId: 'wh-mkt',
    destinationLocationId: 'loc-mkt',
    transferDate: new Date('2026-07-20T00:00:00.000Z'),
    reasonId: null,
    notes: null,
    version: 3,
    createdById: 'user-2',
    submittedAt: new Date(),
    approvedById: 'user-3',
    approvedAt: new Date(),
    dispatchedById: 'user-2',
    dispatchedAt: new Date(),
    completedAt: null,
    canceledById: null,
    canceledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [transferLine()],
    ...overrides,
  };
}

function transferDetailRow(overrides: Record<string, unknown> = {}) {
  const branch = (suffix: string) => ({
    id: `branch-${suffix}`,
    code: suffix.toUpperCase(),
    name: suffix,
  });
  return {
    id: 'trf-1',
    transferNumber: 'TRF-2026-00001',
    type: 'INTER_BRANCH',
    status: 'RECEIVED',
    transferDate: new Date('2026-07-20T00:00:00.000Z'),
    sourceBranch: branch('sub'),
    sourceWarehouse: { id: 'wh-sub', code: 'SUB-WH1', name: 'Subic WH' },
    sourceLocation: null,
    destinationBranch: branch('mkt'),
    destinationWarehouse: { id: 'wh-mkt', code: 'MKT-WH1', name: 'Makati WH' },
    destinationLocation: null,
    reason: null,
    notes: null,
    version: 4,
    createdBy: { id: 'user-2', displayName: 'U', email: 'u@x' },
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    dispatchedBy: null,
    dispatchedAt: null,
    completedAt: new Date(),
    canceledBy: null,
    canceledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [
      {
        id: 'tl-1',
        lineNumber: 1,
        item: { id: 'item-1', sku: 'SKU-OFC-00003', name: 'Ink' },
        lot: null,
        uom: { id: 'uom-pc', code: 'PC', name: 'Piece' },
        quantity: D(10),
        baseQuantity: D(10),
        dispatchedQuantity: D(10),
        receivedQuantity: D(7),
        damagedQuantity: D(1),
        shortQuantity: D(2),
        rejectedQuantity: D(0),
        notes: null,
      },
    ],
    receipts: [],
    stockTransactions: [],
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

describe('TransfersService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let posting: ReturnType<typeof postingMock>;
  let audit: { log: MockFn };
  let sequences: { next: MockFn };
  let approvals: { routeSubmit: MockFn; actOnResource: MockFn };
  let service: TransfersService;

  beforeEach(() => {
    prisma = prismaMock();
    posting = postingMock();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    sequences = { next: jest.fn().mockResolvedValue(9) };
    // Phase 6 engine stub: no matching workflow / no open request by default.
    approvals = {
      routeSubmit: jest.fn().mockResolvedValue(null),
      actOnResource: jest.fn().mockResolvedValue(false),
    };
    service = new TransfersService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      posting as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      approvals as any,
    );
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
  });

  /** Route transfer.findUnique: include → with-lines row, select → detail row. */
  function routeTransferFind(withLines: unknown, detail: unknown = transferDetailRow()): void {
    prisma.transfer.findUnique.mockImplementation(
      (args: { include?: unknown; select?: unknown }) =>
        Promise.resolve(args.include ? withLines : detail),
    );
  }

  describe('receive — short/damaged accounting', () => {
    function stubReceive(): void {
      routeTransferFind(transferWithLines());
      prisma.stockTransaction.findUnique.mockResolvedValue(null); // no replay
      prisma.transfer.updateMany.mockResolvedValue({ count: 1 });
      prisma.transferReceipt.create.mockResolvedValue({ id: 'rcpt-1' });
      prisma.stockTransaction.create.mockResolvedValue({ id: 'txn-in' });
    }

    const receiveDto = {
      lines: [
        { lineId: 'tl-1', received: '7', damaged: '1', short: '2', notes: 'box crushed in transit' },
      ],
    };

    it('books received+damaged on-hand, records short, clears the full in-transit amount', async () => {
      stubReceive();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await service.receive(superAdmin, 'trf-1', KEY, receiveDto as any, {});

      // Receipt line captures the per-line inspection split (7/1/2).
      const receiptLine = prisma.transferReceiptLine.create.mock.calls[0][0].data;
      expect(receiptLine.receivedQuantity.toString()).toBe('7');
      expect(receiptLine.damagedQuantity.toString()).toBe('1');
      expect(receiptLine.shortQuantity.toString()).toBe('2');

      // Destination-in leg: one line for good stock, one for damaged.
      const inLines = prisma.stockTransactionLine.create.mock.calls.map(
        (call) => call[0].data,
      );
      expect(inLines).toHaveLength(2);
      expect(inLines[0].enteredQuantity.toString()).toBe('7');
      expect(inLines[0].baseQuantity.toString()).toBe('7');
      expect(inLines[0].destinationLocationId).toBe('loc-mkt');
      expect(inLines[1].enteredQuantity.toString()).toBe('1');
      expect(inLines[1].notes).toContain('Damaged in transit');
      // Short quantity (2) never becomes a destination line.

      // The posting engine posts the IN leg with the idempotency key.
      expect(posting.postWithinTx).toHaveBeenCalledWith(
        prisma,
        'txn-in',
        'admin-1',
        { idempotencyKey: KEY },
      );

      // In-transit cleared for the FULL dispatched base quantity (10).
      const inTransitCall = posting.applyInTransitDelta.mock.calls[0];
      expect(inTransitCall[1]).toEqual({
        itemId: 'item-1',
        branchId: 'branch-mkt',
        warehouseId: 'wh-mkt',
        storageLocationId: null,
        lotId: null,
      });
      expect(inTransitCall[2].toString()).toBe('-10');

      // Transfer line records the split.
      const lineUpdate = prisma.transferLine.update.mock.calls[0][0].data;
      expect(lineUpdate.receivedQuantity.toString()).toBe('7');
      expect(lineUpdate.damagedQuantity.toString()).toBe('1');
      expect(lineUpdate.shortQuantity.toString()).toBe('2');
    });

    it('rejects counts that do not add up to the dispatched quantity', async () => {
      stubReceive();
      const error = await catchError(
        service.receive(
          superAdmin,
          'trf-1',
          KEY,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { lines: [{ lineId: 'tl-1', received: '7', damaged: '1', short: '1' }] } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
      expect(prisma.transfer.updateMany).not.toHaveBeenCalled();
    });

    it('rejects non-zero rejected quantities (return-transfer flow is Phase 6)', async () => {
      stubReceive();
      const error = await catchError(
        service.receive(
          superAdmin,
          'trf-1',
          KEY,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { lines: [{ lineId: 'tl-1', received: '9', rejected: '1', notes: 'x' }] } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('requires inspection notes on damaged/short lines', async () => {
      stubReceive();
      const error = await catchError(
        service.receive(
          superAdmin,
          'trf-1',
          KEY,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { lines: [{ lineId: 'tl-1', received: '8', damaged: '2' }] } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('requires every dispatched line to be resolved', async () => {
      routeTransferFind(
        transferWithLines({
          lines: [transferLine(), transferLine({ id: 'tl-2', lineNumber: 2 })],
        }),
      );
      prisma.stockTransaction.findUnique.mockResolvedValue(null);
      const error = await catchError(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        service.receive(superAdmin, 'trf-1', KEY, receiveDto as any, {}),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('replays an already-consumed Idempotency-Key without moving stock again', async () => {
      routeTransferFind(transferWithLines({ status: 'RECEIVED' }));
      prisma.stockTransaction.findUnique.mockResolvedValue({
        id: 'txn-in',
        transferId: 'trf-1',
        type: 'INTER_BRANCH_TRANSFER_IN',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await service.receive(superAdmin, 'trf-1', KEY, receiveDto as any, {});
      expect(result.id).toBe('trf-1');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(posting.postWithinTx).not.toHaveBeenCalled();
    });
  });

  describe('state machine + approvals', () => {
    it('cannot dispatch a DRAFT transfer', async () => {
      routeTransferFind(transferWithLines({ status: 'DRAFT' }));
      prisma.stockTransaction.findUnique.mockResolvedValue(null);
      const error = await catchError(service.dispatch(superAdmin, 'trf-1', KEY, {}));
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('cannot cancel after dispatch — goods are moving', async () => {
      prisma.transfer.findUnique.mockResolvedValue({
        id: 'trf-1',
        transferNumber: 'TRF-2026-00001',
        type: 'INTER_BRANCH',
        status: 'IN_TRANSIT',
        sourceBranchId: 'branch-sub',
        destinationBranchId: 'branch-mkt',
        createdById: 'user-2',
        notes: null,
      });
      const error = await catchError(
        service.cancel(superAdmin, 'trf-1', { reason: 'changed my mind' }, {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
      expect(
        ((error as HttpException).getResponse() as { error: { message: string } })
          .error.message,
      ).toContain('receive at destination');
    });

    it('blocks self-approval of a transfer (409 SELF_APPROVAL_FORBIDDEN)', async () => {
      prisma.transfer.findUnique.mockResolvedValue({
        id: 'trf-1',
        transferNumber: 'TRF-2026-00001',
        type: 'INTER_BRANCH',
        status: 'PENDING_APPROVAL',
        sourceBranchId: 'branch-sub',
        destinationBranchId: 'branch-mkt',
        createdById: 'admin-1',
        notes: null,
      });
      const error = await catchError(service.approve(superAdmin, 'trf-1', {}, {}));
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
    });

    it('receiving an intra-branch transfer is meaningless (completes at dispatch)', async () => {
      routeTransferFind(
        transferWithLines({ type: 'INTRA_BRANCH', status: 'IN_TRANSIT' }),
      );
      prisma.stockTransaction.findUnique.mockResolvedValue(null);
      const error = await catchError(
        service.receive(
          superAdmin,
          'trf-1',
          KEY,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { lines: [{ lineId: 'tl-1', received: '10' }] } as any,
          {},
        ),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });
  });

  describe('dispatch — inter-branch stock into the in-transit bucket', () => {
    it('posts the OUT leg and adds the dispatched base quantity in transit at the destination', async () => {
      routeTransferFind(transferWithLines({ status: 'APPROVED' }));
      prisma.stockTransaction.findUnique.mockResolvedValue(null);
      prisma.transfer.updateMany.mockResolvedValue({ count: 1 });
      prisma.stockTransaction.create.mockResolvedValue({ id: 'txn-out' });

      await service.dispatch(superAdmin, 'trf-1', KEY, {});

      const claim = prisma.transfer.updateMany.mock.calls[0][0];
      expect(claim.where).toEqual({ id: 'trf-1', status: 'APPROVED' });
      expect(claim.data.status).toBe('IN_TRANSIT');

      expect(posting.postWithinTx).toHaveBeenCalledWith(prisma, 'txn-out', 'admin-1', {
        idempotencyKey: KEY,
      });
      const inTransitCall = posting.applyInTransitDelta.mock.calls[0];
      expect(inTransitCall[1].warehouseId).toBe('wh-mkt');
      expect(inTransitCall[2].toString()).toBe('10');

      const outTxn = prisma.stockTransaction.create.mock.calls[0][0].data;
      expect(outTxn.type).toBe('INTER_BRANCH_TRANSFER_OUT');
      expect(outTxn.branchId).toBe('branch-sub');
      expect(outTxn.transferId).toBe('trf-1');
    });
  });
});
