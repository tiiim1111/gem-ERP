import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import {
  canReceiveAgainst,
  canTransitionPo,
  computeDocumentTotals,
  computeLineAmounts,
  deriveReceiptStatus,
  outstandingQuantity,
} from './purchase-order-rules';

const D = (value: string | number) => new Prisma.Decimal(value);

describe('PO money math (Decimal, server-side totals)', () => {
  it('computes gross and line total with discount and tax', () => {
    const line = computeLineAmounts({
      quantity: D('3'),
      unitPrice: D('65000.00'),
      discountAmount: D('500.00'),
      taxAmount: D('780.00'),
    });
    expect(line.gross.toString()).toBe('195000');
    expect(line.lineTotal.toString()).toBe('195280');
  });

  it('rounds gross to 2 decimal places (banker-free half-up)', () => {
    const line = computeLineAmounts({
      quantity: D('3'),
      unitPrice: D('33.335'),
      discountAmount: D(0),
      taxAmount: D(0),
    });
    // 3 × 33.335 = 100.005 → 100.01 at 2dp
    expect(line.gross.toString()).toBe('100.01');
    expect(line.lineTotal.toString()).toBe('100.01');
  });

  it('keeps fractional quantities exact where floats would drift', () => {
    const line = computeLineAmounts({
      quantity: D('0.3'),
      unitPrice: D('0.1'),
      discountAmount: D(0),
      taxAmount: D(0),
    });
    // 0.3 × 0.1 = 0.03 exactly (0.030000000000000004 in binary floats)
    expect(line.gross.toString()).toBe('0.03');
  });

  it('aggregates document totals: sub − discounts + taxes = grand', () => {
    const lines = [
      computeLineAmounts({
        quantity: D('2'),
        unitPrice: D('1200.50'),
        discountAmount: D('100.00'),
        taxAmount: D('288.12'),
      }),
      computeLineAmounts({
        quantity: D('10'),
        unitPrice: D('85.00'),
        discountAmount: D('0'),
        taxAmount: D('102.00'),
      }),
    ];
    const totals = computeDocumentTotals(lines);
    expect(totals.subtotal.toString()).toBe('3251'); // 2401 + 850
    expect(totals.discountTotal.toString()).toBe('100');
    expect(totals.taxTotal.toString()).toBe('390.12');
    expect(totals.grandTotal.toString()).toBe('3541.12');
  });

  it('handles a zero-line document', () => {
    const totals = computeDocumentTotals([]);
    expect(totals.grandTotal.toString()).toBe('0');
  });
});

describe('PO state machine (docs/status-transitions.md §3)', () => {
  it('drafts can be updated, submitted, and canceled — nothing else', () => {
    expect(canTransitionPo(PurchaseOrderStatus.DRAFT, 'update')).toBe(true);
    expect(canTransitionPo(PurchaseOrderStatus.DRAFT, 'submit')).toBe(true);
    expect(canTransitionPo(PurchaseOrderStatus.DRAFT, 'cancel')).toBe(true);
    expect(canTransitionPo(PurchaseOrderStatus.DRAFT, 'approve')).toBe(false);
    expect(canTransitionPo(PurchaseOrderStatus.DRAFT, 'close')).toBe(false);
  });

  it('pending approval allows approve/reject/cancel only', () => {
    const from = PurchaseOrderStatus.PENDING_APPROVAL;
    expect(canTransitionPo(from, 'approve')).toBe(true);
    expect(canTransitionPo(from, 'reject')).toBe(true);
    expect(canTransitionPo(from, 'cancel')).toBe(true);
    expect(canTransitionPo(from, 'update')).toBe(false);
    expect(canTransitionPo(from, 'submit')).toBe(false);
  });

  it('approved POs are immutable: no update, no re-approve', () => {
    const from = PurchaseOrderStatus.APPROVED;
    expect(canTransitionPo(from, 'update')).toBe(false);
    expect(canTransitionPo(from, 'approve')).toBe(false);
    expect(canTransitionPo(from, 'cancel')).toBe(true);
    expect(canTransitionPo(from, 'receipt-posted')).toBe(true);
  });

  it('partially received can close short or keep receiving; fully received closes', () => {
    expect(
      canTransitionPo(PurchaseOrderStatus.PARTIALLY_RECEIVED, 'close'),
    ).toBe(true);
    expect(
      canTransitionPo(PurchaseOrderStatus.PARTIALLY_RECEIVED, 'receipt-posted'),
    ).toBe(true);
    expect(
      canTransitionPo(PurchaseOrderStatus.PARTIALLY_RECEIVED, 'cancel'),
    ).toBe(false);
    expect(canTransitionPo(PurchaseOrderStatus.FULLY_RECEIVED, 'close')).toBe(
      true,
    );
    expect(
      canTransitionPo(PurchaseOrderStatus.FULLY_RECEIVED, 'receipt-posted'),
    ).toBe(false);
  });

  it('canceled and closed are terminal', () => {
    for (const from of [
      PurchaseOrderStatus.CANCELED,
      PurchaseOrderStatus.CLOSED,
    ]) {
      for (const event of [
        'update',
        'submit',
        'approve',
        'reject',
        'cancel',
        'close',
        'receipt-posted',
      ] as const) {
        expect(canTransitionPo(from, event)).toBe(false);
      }
    }
  });

  it('receipts may only be recorded against APPROVED or PARTIALLY_RECEIVED', () => {
    expect(canReceiveAgainst(PurchaseOrderStatus.APPROVED)).toBe(true);
    expect(canReceiveAgainst(PurchaseOrderStatus.PARTIALLY_RECEIVED)).toBe(
      true,
    );
    expect(canReceiveAgainst(PurchaseOrderStatus.DRAFT)).toBe(false);
    expect(canReceiveAgainst(PurchaseOrderStatus.PENDING_APPROVAL)).toBe(false);
    expect(canReceiveAgainst(PurchaseOrderStatus.FULLY_RECEIVED)).toBe(false);
    expect(canReceiveAgainst(PurchaseOrderStatus.CLOSED)).toBe(false);
  });
});

describe('Outstanding quantity math', () => {
  it('outstanding = ordered − received − canceled', () => {
    expect(
      outstandingQuantity({
        quantity: D('10'),
        receivedQuantity: D('4'),
        canceledQuantity: D('1'),
      }).toString(),
    ).toBe('5');
  });

  it('never goes negative', () => {
    expect(
      outstandingQuantity({
        quantity: D('10'),
        receivedQuantity: D('12'),
        canceledQuantity: D('0'),
      }).toString(),
    ).toBe('0');
  });

  it('supports fractional (4dp) quantities', () => {
    expect(
      outstandingQuantity({
        quantity: D('2.5'),
        receivedQuantity: D('1.2500'),
        canceledQuantity: D('0'),
      }).toString(),
    ).toBe('1.25');
  });
});

describe('Receipt-driven PO status derivation', () => {
  it('nothing received → APPROVED', () => {
    expect(
      deriveReceiptStatus([
        { quantity: D('5'), receivedQuantity: D('0'), canceledQuantity: D('0') },
      ]),
    ).toBe(PurchaseOrderStatus.APPROVED);
  });

  it('some received, some outstanding → PARTIALLY_RECEIVED', () => {
    expect(
      deriveReceiptStatus([
        { quantity: D('5'), receivedQuantity: D('5'), canceledQuantity: D('0') },
        { quantity: D('3'), receivedQuantity: D('0'), canceledQuantity: D('0') },
      ]),
    ).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
  });

  it('every line fulfilled → FULLY_RECEIVED', () => {
    expect(
      deriveReceiptStatus([
        { quantity: D('5'), receivedQuantity: D('5'), canceledQuantity: D('0') },
        { quantity: D('3'), receivedQuantity: D('3'), canceledQuantity: D('0') },
      ]),
    ).toBe(PurchaseOrderStatus.FULLY_RECEIVED);
  });

  it('canceled remainders count as fulfilled (close-short semantics)', () => {
    expect(
      deriveReceiptStatus([
        { quantity: D('5'), receivedQuantity: D('3'), canceledQuantity: D('2') },
      ]),
    ).toBe(PurchaseOrderStatus.FULLY_RECEIVED);
  });
});
