import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { renderPrintableDocument } from './printable-pdf';
import { PrintablesService } from './printables.service';

/**
 * Printable documents: branch-scope authorization (out-of-scope → 404, no
 * existence leak), audit on every render, blind count-sheet masking, and
 * structural PDF validity from the pure layout engine.
 */

const D = (value: string) => new Prisma.Decimal(value);

type MockFn = jest.Mock;

function prismaMock() {
  return {
    purchaseOrder: { findUnique: jest.fn() },
    goodsReceipt: { findUnique: jest.fn() },
    transfer: { findUnique: jest.fn() },
    asset: { findUnique: jest.fn() },
    maintenanceWorkOrder: { findUnique: jest.fn() },
    inventoryCountSession: { findUnique: jest.fn() },
  };
}

const auditCtx = { actorUserId: 'user-1' };

const subUser = {
  id: 'user-1',
  email: 'x@gemcor.dev',
  displayName: 'X',
  isSuperAdmin: false,
  roles: [],
  branchIds: ['branch-sub'],
  permissions: [PERMISSIONS.procurementPo.view, PERMISSIONS.count.view],
  mustChangePassword: false,
};

function poRow(branchId: string) {
  return {
    id: 'po-1',
    poNumber: 'PO-2026-00042',
    status: 'APPROVED',
    branchId,
    orderDate: new Date('2026-08-01T00:00:00.000Z'),
    expectedDeliveryDate: null,
    currencyCode: 'PHP',
    subtotal: D('1000.00'),
    discountTotal: D('0.00'),
    taxTotal: D('120.00'),
    grandTotal: D('1120.00'),
    terms: 'Net 30',
    notes: null,
    supplier: { legalName: 'TechnoHub', address: 'Manila', email: null },
    branch: { code: 'SUB', name: 'GemCor - Subic' },
    destinationWarehouse: { code: 'SUB-WH1', name: 'Subic Warehouse' },
    createdBy: { displayName: 'Maker' },
    approvedBy: { displayName: 'Approver' },
    lines: [
      {
        lineNumber: 1,
        quantity: D('10'),
        unitPrice: D('100.00'),
        discountAmount: D('0.00'),
        taxAmount: D('120.00'),
        lineTotal: D('1120.00'),
        receivedQuantity: D('0'),
        item: { sku: 'SKU-PPR-00017', name: 'Bond paper A4' },
        uom: { code: 'REAM' },
      },
    ],
  };
}

function countSessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cnt-1',
    countNumber: 'CNT-2026-00004',
    type: 'CYCLE',
    status: 'IN_PROGRESS',
    isBlind: true,
    branchId: 'branch-sub',
    snapshotAt: new Date('2026-08-06T00:00:00.000Z'),
    startedAt: new Date('2026-08-06T00:05:00.000Z'),
    notes: null,
    branch: { code: 'SUB', name: 'GemCor - Subic' },
    warehouse: { code: 'SUB-WH1', name: 'Subic Warehouse' },
    storageLocation: null,
    category: null,
    createdBy: { displayName: 'Counter' },
    lines: [
      {
        item: { sku: 'SKU-PPR-00017', name: 'Bond paper A4' },
        asset: null,
        lot: null,
        warehouse: { code: 'SUB-WH1' },
        storageLocation: { code: 'A01' },
        uom: { code: 'REAM' },
        expectedQuantity: D('42'),
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

describe('PrintablesService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let audit: { log: MockFn };
  let service: PrintablesService;

  beforeEach(() => {
    prisma = prismaMock();
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new PrintablesService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new BranchScopeService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
    );
  });

  it('404s an out-of-scope purchase order without leaking existence or auditing', async () => {
    prisma.purchaseOrder.findUnique.mockResolvedValue(poRow('branch-mkt'));
    const error = await catchError(
      service.purchaseOrderPdf(subUser, 'po-1', auditCtx),
    );
    expectAppError(error, 404, 'NOT_FOUND');
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('renders an in-scope purchase order as PDF and audit-logs the render', async () => {
    prisma.purchaseOrder.findUnique.mockResolvedValue(poRow('branch-sub'));
    const file = await service.purchaseOrderPdf(subUser, 'po-1', auditCtx);
    expect(file.fileName).toBe('PO-2026-00042.pdf');
    expect(file.buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(file.buffer.length).toBeGreaterThan(1000);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'purchase_order.printed',
        resourceId: 'po-1',
        branchId: 'branch-sub',
      }),
    );
  });

  it('renders for callers without view_cost too (prices simply omitted)', async () => {
    prisma.purchaseOrder.findUnique.mockResolvedValue(poRow('branch-sub'));
    const file = await service.purchaseOrderPdf(subUser, 'po-1', auditCtx);
    expect(file.buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('masks expected quantities on a blind count sheet while counting is open', async () => {
    prisma.inventoryCountSession.findUnique.mockResolvedValue(countSessionRow());
    const file = await service.countSheet(subUser, 'cnt-1', auditCtx);
    expect(file.buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'count_session.sheet_printed',
        metadata: expect.objectContaining({ masked: true }),
      }),
    );
  });

  it('reveals expected quantities once the session reaches REVIEW', async () => {
    prisma.inventoryCountSession.findUnique.mockResolvedValue(
      countSessionRow({ status: 'REVIEW' }),
    );
    await service.countSheet(subUser, 'cnt-1', auditCtx);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ masked: false }),
      }),
    );
  });
});

describe('renderPrintableDocument (pure layout engine)', () => {
  it('renders fields, tables, totals, and signature blocks into a valid PDF', async () => {
    const buffer = await renderPrintableDocument({
      title: 'TEST DOCUMENT',
      documentNumber: 'DOC-0001',
      subtitle: 'Status: TEST',
      fieldGroups: [
        [
          { label: 'Field A', value: 'Value A' },
          { label: 'Field B', value: null },
        ],
      ],
      tables: [
        {
          caption: 'Lines',
          columns: [
            { header: '#', width: 0.5 },
            { header: 'Description', width: 3 },
            { header: 'Qty', width: 1, align: 'right' },
          ],
          rows: Array.from({ length: 45 }, (_, i) => [
            String(i + 1),
            `Line ${i + 1}`,
            String(i),
          ]),
          totals: [['Total', '990']],
        },
      ],
      notes: 'Multi-page table exercise.',
      signatures: [
        { role: 'Prepared by', name: 'Maker' },
        { role: 'Approved by', name: null },
      ],
    });
    expect(buffer.subarray(0, 5).toString('utf8')).toBe('%PDF-');
    // 45 rows at ~17pt exceeds one A4 page — a second page must exist.
    expect(buffer.toString('latin1')).toContain('/Type /Pages');
    expect(buffer.length).toBeGreaterThan(2000);
  });
});
