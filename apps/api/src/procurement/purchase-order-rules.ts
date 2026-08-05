import { Prisma, PurchaseOrderStatus } from '@prisma/client';

/**
 * Pure domain rules for purchase orders (spec §14,
 * docs/status-transitions.md §3). No Nest/Prisma clients so the state
 * machine and the money math are unit-testable without infrastructure.
 *
 * PO machine: Draft, Pending Approval, Approved, Partially Received,
 * Fully Received, Canceled, Closed. `reject` returns the document to DRAFT
 * for revision — the PO machine has no resting Rejected state
 * (docs/status-transitions.md §3); the enum's REJECTED member stays unused.
 */

/** Explicit action endpoints (outline 1.8) plus the receipt system events. */
export type PurchaseOrderEvent =
  | 'update'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'close'
  | 'receipt-posted'
  | 'receipt-reversed';

const TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderEvent[]> =
  {
    [PurchaseOrderStatus.DRAFT]: ['update', 'submit', 'cancel'],
    [PurchaseOrderStatus.PENDING_APPROVAL]: ['approve', 'reject', 'cancel'],
    // cancel from APPROVED additionally requires "no posted receipts"
    // (service-level guard — it needs the database).
    [PurchaseOrderStatus.APPROVED]: ['cancel', 'receipt-posted'],
    [PurchaseOrderStatus.REJECTED]: [],
    [PurchaseOrderStatus.PARTIALLY_RECEIVED]: [
      'close',
      'receipt-posted',
      'receipt-reversed',
    ],
    [PurchaseOrderStatus.FULLY_RECEIVED]: ['close', 'receipt-reversed'],
    [PurchaseOrderStatus.CANCELED]: [],
    [PurchaseOrderStatus.CLOSED]: [],
  };

export function canTransitionPo(
  from: PurchaseOrderStatus,
  event: PurchaseOrderEvent,
): boolean {
  return TRANSITIONS[from].includes(event);
}

/** Human-readable transition failure message for the 409 envelope. */
export function poTransitionError(
  from: PurchaseOrderStatus,
  event: PurchaseOrderEvent,
): string {
  const allowed = TRANSITIONS[from].filter(
    (candidate) => !candidate.startsWith('receipt-'),
  );
  return `Cannot ${event} a ${from} purchase order${
    allowed.length > 0
      ? ` (allowed: ${allowed.join(', ')})`
      : ' (terminal status)'
  }.`;
}

/** Statuses a goods receipt may be recorded against. */
export function canReceiveAgainst(status: PurchaseOrderStatus): boolean {
  return (
    status === PurchaseOrderStatus.APPROVED ||
    status === PurchaseOrderStatus.PARTIALLY_RECEIVED
  );
}

// ---------------------------------------------------------------------------
// Money math (server-side totals, spec §14 / status-transitions §3)
// ---------------------------------------------------------------------------

export interface PoLineAmountsInput {
  /** Entered quantity (> 0, up to 4 decimals). */
  quantity: Prisma.Decimal;
  /** Price per entered UOM unit (>= 0, 2 decimals). */
  unitPrice: Prisma.Decimal;
  /** Absolute discount on the line (>= 0, 2 decimals). */
  discountAmount: Prisma.Decimal;
  /** Absolute tax added on the line (>= 0, 2 decimals). */
  taxAmount: Prisma.Decimal;
}

export interface PoLineAmounts extends PoLineAmountsInput {
  /** quantity × unitPrice, rounded to 2 decimals. */
  gross: Prisma.Decimal;
  /** gross − discount + tax, rounded to 2 decimals. */
  lineTotal: Prisma.Decimal;
}

/**
 * Line money math: gross = qty × price (2dp), total = gross − discount + tax.
 * Throws nothing — validity (discount ≤ gross, non-negative values) is the
 * DTO/service layer's job; this function only computes.
 */
export function computeLineAmounts(input: PoLineAmountsInput): PoLineAmounts {
  const gross = input.quantity.mul(input.unitPrice).toDecimalPlaces(2);
  const lineTotal = gross
    .sub(input.discountAmount)
    .add(input.taxAmount)
    .toDecimalPlaces(2);
  return { ...input, gross, lineTotal };
}

export interface PoDocumentTotals {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
}

/** Document totals = Σ line gross / discount / tax; grand = sub − disc + tax. */
export function computeDocumentTotals(
  lines: readonly PoLineAmounts[],
): PoDocumentTotals {
  const zero = new Prisma.Decimal(0);
  const subtotal = lines
    .reduce((sum, line) => sum.add(line.gross), zero)
    .toDecimalPlaces(2);
  const discountTotal = lines
    .reduce((sum, line) => sum.add(line.discountAmount), zero)
    .toDecimalPlaces(2);
  const taxTotal = lines
    .reduce((sum, line) => sum.add(line.taxAmount), zero)
    .toDecimalPlaces(2);
  const grandTotal = subtotal.sub(discountTotal).add(taxTotal).toDecimalPlaces(2);
  return { subtotal, discountTotal, taxTotal, grandTotal };
}

// ---------------------------------------------------------------------------
// Quantity math (receipts, spec §14 receiving)
// ---------------------------------------------------------------------------

export interface PoLineQuantities {
  quantity: Prisma.Decimal;
  receivedQuantity: Prisma.Decimal;
  canceledQuantity: Prisma.Decimal;
}

/**
 * Outstanding = ordered − received − canceled, floored at zero. Receipts may
 * never exceed this per line (409 OVER_RECEIPT — a configurable over-receipt
 * tolerance is a deliberate future extension; today the block is hard).
 */
export function outstandingQuantity(line: PoLineQuantities): Prisma.Decimal {
  const outstanding = line.quantity
    .sub(line.receivedQuantity)
    .sub(line.canceledQuantity);
  return outstanding.lt(0) ? new Prisma.Decimal(0) : outstanding;
}

/**
 * Derive the PO status from its lines after a receipt posts or reverses:
 * nothing received → APPROVED, everything received (net of canceled
 * quantities) → FULLY_RECEIVED, otherwise PARTIALLY_RECEIVED.
 */
export function deriveReceiptStatus(
  lines: readonly PoLineQuantities[],
): PurchaseOrderStatus {
  const anyReceived = lines.some((line) => line.receivedQuantity.gt(0));
  if (!anyReceived) {
    return PurchaseOrderStatus.APPROVED;
  }
  const allFull = lines.every((line) => outstandingQuantity(line).lte(0));
  return allFull
    ? PurchaseOrderStatus.FULLY_RECEIVED
    : PurchaseOrderStatus.PARTIALLY_RECEIVED;
}
