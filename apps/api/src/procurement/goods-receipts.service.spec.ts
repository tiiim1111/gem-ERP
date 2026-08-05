import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { GoodsReceiptPostingService } from './goods-receipt-posting.service';
import { GoodsReceiptsService } from './goods-receipts.service';

/**
 * Unit tests with a fully mocked Prisma client — no database. Covers the
 * receiving rules: serial-count-must-match-qty, PO-line UOM enforcement,
 * over-receipt hard block (create-time advisory + post-time authoritative),
 * receipt→PO status transitions, asset creation for serialized lines, stock
 * posting through the shared engine, and idempotency replay semantics.
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    goodsReceipt: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    goodsReceiptLine: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    purchaseOrder: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    purchaseOrderLine: { findMany: jest.fn(), update: jest.fn() },
    stockTransaction: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    stockTransactionLine: { create: jest.fn() },
    asset: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    assetStatusHistory: { create: jest.fn() },
    assetConditionHistory: { create: jest.fn() },
    lookupValue: { findFirst: jest.fn() },
    item: { findMany: jest.fn(), update: jest.fn() },
    uomConversion: { findMany: jest.fn() },
    inventoryLot: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    storageLocation: { findMany: jest.fn() },
    warehouse: { findUnique: jest.fn() },
    unitOfMeasure: { count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn().mockResolvedValue([]),
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

const D = (value: string | number) => new Prisma.Decimal(value);

/** PO as loaded by requireReceivablePo: laptop (SERIAL) + paper (QUANTITY). */
function receivablePo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    poNumber: 'PO-2026-00001',
    status: 'APPROVED',
    branchId: 'branch-1',
    supplierId: 'sup-1',
    destinationWarehouseId: 'wh-1',
    lines: [
      {
        id: 'pol-1',
        lineNumber: 1,
        itemId: 'item-laptop',
        uomId: 'uom-pc',
        quantity: D('2'),
        unitPrice: D('65000.00'),
        lineTotal: D('130000.00'),
        receivedQuantity: D('0'),
        canceledQuantity: D('0'),
      },
      {
        id: 'pol-2',
        lineNumber: 2,
        itemId: 'item-paper',
        uomId: 'uom-ream',
        quantity: D('10'),
        unitPrice: D('240.00'),
        lineTotal: D('2400.00'),
        receivedQuantity: D('0'),
        canceledQuantity: D('0'),
      },
    ],
    ...overrides,
  };
}

function catalogItems() {
  return [
    {
      id: 'item-laptop',
      sku: 'SKU-LAP-00001',
      isActive: true,
      trackingMethod: 'SERIAL',
      isExpiryTracked: false,
      baseUomId: 'uom-pc',
      uomConversions: [],
    },
    {
      id: 'item-paper',
      sku: 'SKU-OFC-00001',
      isActive: true,
      trackingMethod: 'QUANTITY',
      isExpiryTracked: false,
      baseUomId: 'uom-ream',
      uomConversions: [],
    },
  ];
}

function grHead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gr-1',
    receiptNumber: 'GR-2026-00001',
    status: 'DRAFT',
    branchId: 'branch-1',
    warehouseId: 'wh-1',
    purchaseOrderId: 'po-1',
    receiptDate: new Date('2026-08-05T00:00:00.000Z'),
    notes: null,
    idempotencyKey: null,
    ...overrides,
  };
}

function grDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gr-1',
    receiptNumber: 'GR-2026-00001',
    status: 'POSTED',
    receiptDate: new Date('2026-08-05T00:00:00.000Z'),
    supplierReference: null,
    notes: null,
    version: 2,
    purchaseOrder: {
      id: 'po-1',
      poNumber: 'PO-2026-00001',
      status: 'PARTIALLY_RECEIVED',
      supplier: {
        id: 'sup-1',
        code: 'SUP-00001',
        legalName: 'TechnoHub',
        tradeName: null,
      },
    },
    branch: { id: 'branch-1', code: 'SUB', name: 'Subic' },
    warehouse: { id: 'wh-1', code: 'SUB-WH1', name: 'Subic WH' },
    createdBy: { id: 'admin-1', displayName: 'Admin', email: 'admin@x' },
    postedBy: { id: 'admin-1', displayName: 'Admin', email: 'admin@x' },
    postedAt: new Date('2026-08-05T01:00:00.000Z'),
    canceledBy: null,
    canceledAt: null,
    createdAt: new Date('2026-08-05T00:00:00.000Z'),
    updatedAt: new Date('2026-08-05T01:00:00.000Z'),
    lines: [],
    stockTransactions: [],
    ...overrides,
  };
}

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe('GoodsReceipts', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { log: MockFn };
  let sequences: { next: MockFn };
  let stockPosting: { postWithinTx: MockFn; reverse: MockFn };
  let receipts: GoodsReceiptsService;
  let posting: GoodsReceiptPostingService;

  beforeEach(() => {
    prisma = prismaMock();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    sequences = { next: jest.fn().mockResolvedValue(1) };
    stockPosting = {
      postWithinTx: jest.fn().mockResolvedValue(undefined),
      reverse: jest.fn(),
    };
    receipts = new GoodsReceiptsService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
    );
    posting = new GoodsReceiptPostingService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      receipts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      stockPosting as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
    );
  });

  function stubCreatePath(): void {
    prisma.purchaseOrder.findUnique.mockResolvedValue(receivablePo());
    prisma.item.findMany.mockResolvedValue(catalogItems());
    prisma.uomConversion.findMany.mockResolvedValue([]);
    prisma.warehouse.findUnique.mockResolvedValue({
      defaultReceivingLocationId: 'loc-rcv',
    });
    prisma.asset.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    prisma.goodsReceipt.create.mockResolvedValue({
      id: 'gr-1',
      receiptNumber: 'GR-2026-00001',
    });
    prisma.goodsReceiptLine.create.mockResolvedValue({ id: 'grl-1' });
    prisma.goodsReceipt.findUnique.mockResolvedValue(
      grDetailRow({ status: 'DRAFT', version: 1 }),
    );
  }

  describe('create — serial and UOM rules', () => {
    it('serial count must equal the received quantity', async () => {
      stubCreatePath();
      const error = await catchError(
        receipts.create(
          superAdmin,
          {
            purchaseOrderId: 'po-1',
            lines: [
              {
                poLineId: 'pol-1',
                quantity: '2',
                serials: ['SN-A'], // 1 serial for qty 2
              },
            ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
      const details = (
        (error as HttpException).getResponse() as {
          error: { details: Array<{ message: string }> };
        }
      ).error.details;
      expect(details[0].message).toContain('exactly 2 serial number');
    });

    it('accepts matching serials and stores them on the draft line', async () => {
      stubCreatePath();
      await receipts.create(
        superAdmin,
        {
          purchaseOrderId: 'po-1',
          lines: [
            { poLineId: 'pol-1', quantity: '2', serials: ['SN-A', 'SN-B'] },
          ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {},
      );
      const lineData = prisma.goodsReceiptLine.create.mock.calls[0][0].data;
      expect(lineData.serialNumbers).toEqual(['SN-A', 'SN-B']);
      // Effective net unit cost from the PO line (130000 / 2).
      expect(lineData.unitCost.toString()).toBe('65000');
      expect(lineData.storageLocationId).toBe('loc-rcv');
    });

    it('duplicate serials within one receipt are rejected', async () => {
      stubCreatePath();
      const error = await catchError(
        receipts.create(
          superAdmin,
          {
            purchaseOrderId: 'po-1',
            lines: [
              { poLineId: 'pol-1', quantity: '2', serials: ['SN-A', 'SN-A'] },
            ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('quantities must be entered in the PO line UOM', async () => {
      stubCreatePath();
      const error = await catchError(
        receipts.create(
          superAdmin,
          {
            purchaseOrderId: 'po-1',
            lines: [
              { poLineId: 'pol-2', quantity: '5', uomId: 'uom-box' },
            ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('receiving against a non-approved PO is refused', async () => {
      stubCreatePath();
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        receivablePo({ status: 'DRAFT' }),
      );
      const error = await catchError(
        receipts.create(
          superAdmin,
          {
            purchaseOrderId: 'po-1',
            lines: [{ poLineId: 'pol-2', quantity: '1' }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('over-receipt is a hard 409 OVER_RECEIPT at creation time', async () => {
      stubCreatePath();
      // pol-2: ordered 10, received 6 → outstanding 4; receiving 5 must fail.
      prisma.purchaseOrder.findUnique.mockResolvedValue(
        receivablePo({
          status: 'PARTIALLY_RECEIVED',
          lines: [
            {
              id: 'pol-2',
              lineNumber: 2,
              itemId: 'item-paper',
              uomId: 'uom-ream',
              quantity: D('10'),
              unitPrice: D('240.00'),
              lineTotal: D('2400.00'),
              receivedQuantity: D('6'),
              canceledQuantity: D('0'),
            },
          ],
        }),
      );
      const error = await catchError(
        receipts.create(
          superAdmin,
          {
            purchaseOrderId: 'po-1',
            lines: [{ poLineId: 'pol-2', quantity: '5' }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 409, 'OVER_RECEIPT');
    });

    it('sums multiple receipt lines against the same PO line', async () => {
      stubCreatePath();
      const error = await catchError(
        receipts.create(
          superAdmin,
          {
            purchaseOrderId: 'po-1',
            lines: [
              { poLineId: 'pol-2', quantity: '6' },
              { poLineId: 'pol-2', quantity: '6' }, // 12 > ordered 10
            ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 409, 'OVER_RECEIPT');
    });
  });

  describe('post — idempotency', () => {
    it('requires the Idempotency-Key header', async () => {
      const error = await catchError(
        posting.post(superAdmin, 'gr-1', undefined, {}),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('replaying the same key returns the original result, not a second movement', async () => {
      prisma.goodsReceipt.findUnique.mockImplementation(
        async (args: { where: { idempotencyKey?: string; id?: string } }) => {
          if (args.where.idempotencyKey) {
            return { id: 'gr-1', status: 'POSTED' };
          }
          return grDetailRow();
        },
      );
      prisma.stockTransaction.findUnique.mockResolvedValue(null);
      const result = await posting.post(
        superAdmin,
        'gr-1',
        'replay-key-12345',
        {},
      );
      expect(result.status).toBe('POSTED');
      expect(prisma.goodsReceipt.updateMany).not.toHaveBeenCalled();
      expect(stockPosting.postWithinTx).not.toHaveBeenCalled();
    });

    it('the same key on a different receipt → 409 IDEMPOTENCY_CONFLICT', async () => {
      prisma.goodsReceipt.findUnique.mockImplementation(
        async (args: { where: { idempotencyKey?: string } }) =>
          args.where.idempotencyKey
            ? { id: 'gr-OTHER', status: 'POSTED' }
            : grHead(),
      );
      prisma.stockTransaction.findUnique.mockResolvedValue(null);
      const error = await catchError(
        posting.post(superAdmin, 'gr-1', 'conflicting-key-1', {}),
      );
      expectAppError(error, 409, 'IDEMPOTENCY_CONFLICT');
    });
  });

  describe('post — the receiving transaction', () => {
    function stubPostPath(options: {
      grLines: Array<Record<string, unknown>>;
      poLinesAfter: Array<{
        quantity: Prisma.Decimal;
        receivedQuantity: Prisma.Decimal;
        canceledQuantity: Prisma.Decimal;
      }>;
    }): void {
      prisma.goodsReceipt.findUnique.mockImplementation(
        async (args: {
          where: { idempotencyKey?: string; id?: string };
          select?: { lines?: unknown };
        }) => {
          if (args.where.idempotencyKey) {
            return null;
          }
          return args.select?.lines ? grDetailRow() : grHead();
        },
      );
      prisma.stockTransaction.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback(prisma),
      );
      prisma.goodsReceipt.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrder.findUniqueOrThrow.mockResolvedValue({
        id: 'po-1',
        poNumber: 'PO-2026-00001',
        status: 'APPROVED',
        supplierId: 'sup-1',
        branch: { id: 'branch-1', code: 'SUB' },
        lines: receivablePo().lines,
      });
      prisma.goodsReceiptLine.findMany.mockResolvedValue(options.grLines);
      prisma.lookupValue.findFirst.mockResolvedValue({ id: 'cond-new' });
      prisma.asset.create.mockResolvedValue({ id: 'asset-1' });
      prisma.stockTransaction.create.mockResolvedValue({ id: 'txn-1' });
      prisma.purchaseOrderLine.findMany.mockResolvedValue(
        options.poLinesAfter,
      );
    }

    const paperLine = (quantity: string) => ({
      id: 'grl-2',
      lineNumber: 2,
      purchaseOrderLineId: 'pol-2',
      itemId: 'item-paper',
      uomId: 'uom-ream',
      receivedQuantity: D(quantity),
      baseQuantity: D(quantity),
      unitCost: D('240.00'),
      serialNumbers: [],
      lotId: null,
      storageLocationId: 'loc-rcv',
      item: {
        id: 'item-paper',
        sku: 'SKU-OFC-00001',
        trackingMethod: 'QUANTITY',
        category: null,
      },
    });

    const laptopLine = () => ({
      id: 'grl-1',
      lineNumber: 1,
      purchaseOrderLineId: 'pol-1',
      itemId: 'item-laptop',
      uomId: 'uom-pc',
      receivedQuantity: D('2'),
      baseQuantity: D('2'),
      unitCost: D('65000.00'),
      serialNumbers: ['SN-A', 'SN-B'],
      lotId: null,
      storageLocationId: 'loc-rcv',
      item: {
        id: 'item-laptop',
        sku: 'SKU-LAP-00001',
        trackingMethod: 'SERIAL',
        category: { code: 'LAP' },
      },
    });

    it('partial receipt: stock posted via the engine, PO → PARTIALLY_RECEIVED', async () => {
      stubPostPath({
        grLines: [paperLine('4')],
        poLinesAfter: [
          { quantity: D('2'), receivedQuantity: D('0'), canceledQuantity: D('0') },
          { quantity: D('10'), receivedQuantity: D('4'), canceledQuantity: D('0') },
        ],
      });
      await posting.post(superAdmin, 'gr-1', 'post-key-000001', {});

      const txnData = prisma.stockTransaction.create.mock.calls[0][0].data;
      expect(txnData.type).toBe('PURCHASE_RECEIPT');
      expect(txnData.goodsReceiptId).toBe('gr-1');
      expect(txnData.purchaseOrderId).toBe('po-1');
      expect(txnData.idempotencyKey).toBe('post-key-000001');
      expect(stockPosting.postWithinTx).toHaveBeenCalledWith(
        prisma,
        'txn-1',
        'admin-1',
      );
      const poLineUpdate = prisma.purchaseOrderLine.update.mock.calls[0][0];
      expect(poLineUpdate.where.id).toBe('pol-2');
      expect(poLineUpdate.data.receivedQuantity.increment.toString()).toBe('4');
      const poUpdate = prisma.purchaseOrder.update.mock.calls[0][0];
      expect(poUpdate.data.status).toBe('PARTIALLY_RECEIVED');
    });

    it('final receipt: every line fulfilled → FULLY_RECEIVED', async () => {
      stubPostPath({
        grLines: [laptopLine(), paperLine('10')],
        poLinesAfter: [
          { quantity: D('2'), receivedQuantity: D('2'), canceledQuantity: D('0') },
          { quantity: D('10'), receivedQuantity: D('10'), canceledQuantity: D('0') },
        ],
      });
      await posting.post(superAdmin, 'gr-1', 'post-key-000002', {});
      const poUpdate = prisma.purchaseOrder.update.mock.calls[0][0];
      expect(poUpdate.data.status).toBe('FULLY_RECEIVED');
    });

    it('creates one asset per serial with acquisition data from the PO', async () => {
      stubPostPath({
        grLines: [laptopLine()],
        poLinesAfter: [
          { quantity: D('2'), receivedQuantity: D('2'), canceledQuantity: D('0') },
          { quantity: D('10'), receivedQuantity: D('0'), canceledQuantity: D('0') },
        ],
      });
      await posting.post(superAdmin, 'gr-1', 'post-key-000003', {});

      expect(prisma.asset.create).toHaveBeenCalledTimes(2);
      const first = prisma.asset.create.mock.calls[0][0].data;
      expect(first.serialNumber).toBe('SN-A');
      expect(first.status).toBe('AVAILABLE');
      expect(first.acquisitionCost.toString()).toBe('65000');
      expect(first.supplierId).toBe('sup-1');
      expect(first.purchaseOrderId).toBe('po-1');
      expect(first.goodsReceiptLineId).toBe('grl-1');
      expect(first.assetTag).toMatch(/^AST-SUB-LAP-\d{4}-000001$/);
      // No quantity stock moves for a serial-only receipt.
      expect(prisma.stockTransaction.create).not.toHaveBeenCalled();
      expect(stockPosting.postWithinTx).not.toHaveBeenCalled();
    });

    it('over-receipt discovered under the PO row lock aborts with 409 OVER_RECEIPT', async () => {
      stubPostPath({
        grLines: [paperLine('12')], // outstanding is only 10
        poLinesAfter: [],
      });
      const error = await catchError(
        posting.post(superAdmin, 'gr-1', 'post-key-000004', {}),
      );
      expectAppError(error, 409, 'OVER_RECEIPT');
      expect(prisma.purchaseOrder.update).not.toHaveBeenCalled();
      expect(stockPosting.postWithinTx).not.toHaveBeenCalled();
    });

    it('posting a non-draft receipt is refused', async () => {
      prisma.goodsReceipt.findUnique.mockImplementation(
        async (args: { where: { idempotencyKey?: string } }) =>
          args.where.idempotencyKey ? null : grHead({ status: 'CANCELED' }),
      );
      prisma.stockTransaction.findUnique.mockResolvedValue(null);
      const error = await catchError(
        posting.post(superAdmin, 'gr-1', 'post-key-000005', {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });
  });
});
