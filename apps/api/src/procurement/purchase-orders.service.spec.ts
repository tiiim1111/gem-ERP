import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Unit tests with a fully mocked Prisma client — no database. Covers the PO
 * document rules: server-side Decimal totals, submit auto-approval (no
 * workflow engine yet), the self-approval block, reject-back-to-draft,
 * version conflicts, and the cancel-vs-close receipt guard.
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    purchaseOrder: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    purchaseOrderLine: {
      count: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: null } }),
    },
    goodsReceipt: { findFirst: jest.fn().mockResolvedValue(null) },
    supplier: { findUnique: jest.fn() },
    warehouse: { findUnique: jest.fn() },
    item: { findMany: jest.fn() },
    unitOfMeasure: { findMany: jest.fn() },
    uomConversion: { findMany: jest.fn() },
    approvalWorkflow: { findFirst: jest.fn().mockResolvedValue(null) },
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

const otherApprover = { ...superAdmin, id: 'approver-2' };

function poHead(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    poNumber: 'PO-2026-00001',
    status: 'DRAFT',
    branchId: 'branch-1',
    supplierId: 'sup-1',
    createdById: 'admin-1',
    notes: null,
    orderDate: new Date('2026-08-01T00:00:00.000Z'),
    expectedDeliveryDate: null,
    ...overrides,
  };
}

function poDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    poNumber: 'PO-2026-00001',
    status: 'DRAFT',
    orderDate: new Date('2026-08-01T00:00:00.000Z'),
    expectedDeliveryDate: null,
    currencyCode: 'PHP',
    subtotal: new Prisma.Decimal('195000'),
    discountTotal: new Prisma.Decimal('500'),
    taxTotal: new Prisma.Decimal('780'),
    grandTotal: new Prisma.Decimal('195280'),
    terms: null,
    notes: null,
    version: 1,
    supplier: {
      id: 'sup-1',
      code: 'SUP-00001',
      legalName: 'TechnoHub',
      tradeName: null,
    },
    branch: { id: 'branch-1', code: 'SUB', name: 'Subic' },
    destinationWarehouse: { id: 'wh-1', code: 'SUB-WH1', name: 'Subic WH' },
    createdBy: { id: 'admin-1', displayName: 'Admin', email: 'admin@x' },
    submittedAt: null,
    approvedBy: null,
    approvedAt: null,
    canceledBy: null,
    canceledAt: null,
    closedAt: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    lines: [],
    goodsReceipts: [],
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

describe('PurchaseOrdersService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { log: MockFn };
  let sequences: { next: MockFn };
  let approvals: { routeSubmit: MockFn; actOnResource: MockFn };
  let service: PurchaseOrdersService;

  beforeEach(() => {
    prisma = prismaMock();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    sequences = { next: jest.fn().mockResolvedValue(1) };
    // Phase 6 engine stub: no matching workflow / no open request by default.
    approvals = {
      routeSubmit: jest.fn().mockResolvedValue(null),
      actOnResource: jest.fn().mockResolvedValue(false),
    };
    service = new PurchaseOrdersService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sequences as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      approvals as any,
    );
  });

  function stubCreatePath(): void {
    prisma.supplier.findUnique.mockResolvedValue({
      id: 'sup-1',
      code: 'SUP-00001',
      isActive: true,
      archivedAt: null,
    });
    prisma.warehouse.findUnique.mockResolvedValue({
      id: 'wh-1',
      branchId: 'branch-1',
      isActive: true,
    });
    prisma.item.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sku: 'SKU-LAP-00001',
        isActive: true,
        archivedAt: null,
        baseUomId: 'uom-pc',
        trackingMethod: 'SERIAL',
        categoryId: 'cat-lap',
        uomConversions: [],
      },
    ]);
    prisma.unitOfMeasure.findMany.mockResolvedValue([
      { id: 'uom-pc', isActive: true },
    ]);
    prisma.uomConversion.findMany.mockResolvedValue([]);
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => callback(prisma),
    );
    prisma.purchaseOrder.create.mockResolvedValue({
      id: 'po-1',
      poNumber: 'PO-2026-00001',
    });
    prisma.purchaseOrderLine.create.mockResolvedValue({ id: 'line-1' });
    prisma.purchaseOrder.findUnique.mockResolvedValue(poDetailRow());
  }

  describe('create — server-side Decimal totals', () => {
    it('computes line and document totals from qty/price/discount/tax', async () => {
      stubCreatePath();
      await service.create(
        superAdmin,
        {
          supplierId: 'sup-1',
          branchId: 'branch-1',
          destinationWarehouseId: 'wh-1',
          currency: 'php',
          lines: [
            {
              itemId: 'item-1',
              uomId: 'uom-pc',
              quantity: '3',
              unitPrice: '65000.00',
              discount: '500.00',
              tax: '780.00',
            },
          ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        {},
      );
      const poData = prisma.purchaseOrder.create.mock.calls[0][0].data;
      expect(poData.subtotal.toString()).toBe('195000');
      expect(poData.discountTotal.toString()).toBe('500');
      expect(poData.taxTotal.toString()).toBe('780');
      expect(poData.grandTotal.toString()).toBe('195280');
      expect(poData.currencyCode).toBe('PHP');
      const lineData = prisma.purchaseOrderLine.create.mock.calls[0][0].data;
      expect(lineData.lineTotal.toString()).toBe('195280');
      expect(lineData.lineNumber).toBe(1);
    });

    it('rejects a discount larger than the line amount', async () => {
      stubCreatePath();
      const error = await catchError(
        service.create(
          superAdmin,
          {
            supplierId: 'sup-1',
            branchId: 'branch-1',
            destinationWarehouseId: 'wh-1',
            lines: [
              {
                itemId: 'item-1',
                uomId: 'uom-pc',
                quantity: '1',
                unitPrice: '100.00',
                discount: '150.00',
              },
            ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('rejects fractional quantities on serialized items', async () => {
      stubCreatePath();
      const error = await catchError(
        service.create(
          superAdmin,
          {
            supplierId: 'sup-1',
            branchId: 'branch-1',
            destinationWarehouseId: 'wh-1',
            lines: [
              {
                itemId: 'item-1',
                uomId: 'uom-pc',
                quantity: '1.5',
                unitPrice: '100.00',
              },
            ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });

    it('refuses inactive suppliers', async () => {
      stubCreatePath();
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        code: 'SUP-00001',
        isActive: false,
        archivedAt: null,
      });
      const error = await catchError(
        service.create(
          superAdmin,
          {
            supplierId: 'sup-1',
            branchId: 'branch-1',
            destinationWarehouseId: 'wh-1',
            lines: [
              { itemId: 'item-1', uomId: 'uom-pc', quantity: '1', unitPrice: '1.00' },
            ],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });
  });

  describe('submit — auto-approval while no workflow engine exists', () => {
    it('auto-approves when no matching workflow is configured', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce(poHead())
        .mockResolvedValue(poDetailRow({ status: 'APPROVED' }));
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        code: 'SUP-00001',
        isActive: true,
        archivedAt: null,
      });
      prisma.purchaseOrderLine.count.mockResolvedValue(1);
      prisma.approvalWorkflow.findFirst.mockResolvedValue(null);
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });

      await service.submit(superAdmin, 'po-1', {});
      const data = prisma.purchaseOrder.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('APPROVED');
      expect(data.approvedById).toBe('admin-1');
      expect(data.notes).toContain('auto-approved');
    });

    it('routes to PENDING_APPROVAL when a workflow matches', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce(poHead())
        .mockResolvedValue(poDetailRow({ status: 'PENDING_APPROVAL' }));
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        code: 'SUP-00001',
        isActive: true,
        archivedAt: null,
      });
      prisma.purchaseOrderLine.count.mockResolvedValue(1);
      // Engine matched a workflow: it runs the claim inside its own
      // transaction and returns the created request.
      approvals.routeSubmit.mockImplementation(
        async (
          _args: unknown,
          claim: (tx: unknown) => Promise<void>,
        ) => {
          await claim(prisma);
          return { workflowId: 'wf-1', workflowCode: 'WF-1', requestId: 'req-1' };
        },
      );
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });

      await service.submit(superAdmin, 'po-1', {});
      const data = prisma.purchaseOrder.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING_APPROVAL');
      expect(data.approvedById).toBeUndefined();
    });

    it('refuses to submit an empty PO', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValueOnce(poHead());
      prisma.supplier.findUnique.mockResolvedValue({
        id: 'sup-1',
        code: 'SUP-00001',
        isActive: true,
        archivedAt: null,
      });
      prisma.purchaseOrderLine.count.mockResolvedValue(0);
      const error = await catchError(service.submit(superAdmin, 'po-1', {}));
      expectAppError(error, 400, 'VALIDATION_ERROR');
    });
  });

  describe('approve / reject — the self-approval block', () => {
    it('blocks the requester from approving their own PO', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValueOnce(
        poHead({ status: 'PENDING_APPROVAL', createdById: 'admin-1' }),
      );
      const error = await catchError(
        service.approve(superAdmin, 'po-1', undefined, {}),
      );
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
      expect(prisma.purchaseOrder.updateMany).not.toHaveBeenCalled();
    });

    it('blocks the requester from rejecting their own PO', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValueOnce(
        poHead({ status: 'PENDING_APPROVAL', createdById: 'admin-1' }),
      );
      const error = await catchError(
        service.reject(superAdmin, 'po-1', 'wrong prices', {}),
      );
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
    });

    it('a different approver approves and is recorded', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce(
          poHead({ status: 'PENDING_APPROVAL', createdById: 'admin-1' }),
        )
        .mockResolvedValue(poDetailRow({ status: 'APPROVED' }));
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      await service.approve(otherApprover, 'po-1', 'looks good', {});
      const call = prisma.purchaseOrder.updateMany.mock.calls[0][0];
      expect(call.where.status).toBe('PENDING_APPROVAL');
      expect(call.data.status).toBe('APPROVED');
      expect(call.data.approvedById).toBe('approver-2');
    });

    it('reject returns the PO to DRAFT for revision', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce(
          poHead({ status: 'PENDING_APPROVAL', createdById: 'admin-1' }),
        )
        .mockResolvedValue(poDetailRow({ status: 'DRAFT' }));
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      await service.reject(otherApprover, 'po-1', 'wrong warehouse', {});
      const data = prisma.purchaseOrder.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('DRAFT');
      expect(data.notes).toContain('[rejected: wrong warehouse]');
    });

    it('cannot approve a draft (state machine guard)', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValueOnce(poHead());
      const error = await catchError(
        service.approve(otherApprover, 'po-1', undefined, {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });
  });

  describe('update — optimistic concurrency', () => {
    it('stale version → 409 VERSION_CONFLICT', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValueOnce(poHead());
      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback(prisma),
      );
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 0 });
      const error = await catchError(
        service.update(superAdmin, 'po-1', { version: 1, notes: 'x' }, {}),
      );
      expectAppError(error, 409, 'VERSION_CONFLICT');
    });

    it('non-draft POs cannot be edited', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValueOnce(
        poHead({ status: 'APPROVED' }),
      );
      const error = await catchError(
        service.update(superAdmin, 'po-1', { version: 2, notes: 'x' }, {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });
  });

  describe('cancel / close — receipt guards', () => {
    it('cancel is blocked once a receipt exists against the PO', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValueOnce(
        poHead({ status: 'APPROVED' }),
      );
      prisma.goodsReceipt.findFirst.mockResolvedValue({
        receiptNumber: 'GR-2026-00001',
        status: 'POSTED',
      });
      const error = await catchError(
        service.cancel(superAdmin, 'po-1', 'no longer needed', {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });

    it('cancel works pre-receipt and records the reason', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce(poHead({ status: 'APPROVED' }))
        .mockResolvedValue(poDetailRow({ status: 'CANCELED' }));
      prisma.goodsReceipt.findFirst.mockResolvedValue(null);
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      await service.cancel(superAdmin, 'po-1', 'supplier folded', {});
      const data = prisma.purchaseOrder.updateMany.mock.calls[0][0].data;
      expect(data.status).toBe('CANCELED');
      expect(data.notes).toContain('[canceled: supplier folded]');
    });

    it('close-short cancels each line’s outstanding quantity', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce(poHead({ status: 'PARTIALLY_RECEIVED' }))
        .mockResolvedValue(poDetailRow({ status: 'CLOSED' }));
      prisma.goodsReceipt.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) =>
          callback(prisma),
      );
      prisma.purchaseOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.purchaseOrderLine.findMany.mockResolvedValue([
        {
          id: 'line-1',
          quantity: new Prisma.Decimal('10'),
          receivedQuantity: new Prisma.Decimal('4'),
          canceledQuantity: new Prisma.Decimal('0'),
        },
        {
          id: 'line-2',
          quantity: new Prisma.Decimal('3'),
          receivedQuantity: new Prisma.Decimal('3'),
          canceledQuantity: new Prisma.Decimal('0'),
        },
      ]);
      await service.close(superAdmin, 'po-1', 'supplier cannot deliver', {});
      // Only line-1 has outstanding 6 → exactly one canceledQuantity write.
      expect(prisma.purchaseOrderLine.update).toHaveBeenCalledTimes(1);
      const update = prisma.purchaseOrderLine.update.mock.calls[0][0];
      expect(update.where.id).toBe('line-1');
      expect(update.data.canceledQuantity.toString()).toBe('6');
    });

    it('close from APPROVED (nothing received) is not allowed', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValueOnce(
        poHead({ status: 'APPROVED' }),
      );
      const error = await catchError(
        service.close(superAdmin, 'po-1', 'n/a', {}),
      );
      expectAppError(error, 409, 'INVALID_STATE_TRANSITION');
    });
  });
});
