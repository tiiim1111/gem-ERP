/**
 * Pure document-number formatting for Phase 4 procurement (api-outline 1.9).
 * Numbers come from sequence_counters via SequenceService — never from
 * primary keys. Counter keys embed the calendar year ("PO-2026").
 */

function pad(value: number | bigint, width: number): string {
  return value.toString().padStart(width, '0');
}

/** Counter key for purchase order numbers of one calendar year. */
export function purchaseOrderSequenceKey(year: number): string {
  return `PO-${year}`;
}

/** Purchase order number: PO-{YYYY}-{SEQ5} (e.g. PO-2026-00042). */
export function formatPurchaseOrderNumber(
  year: number,
  sequence: number | bigint,
): string {
  return `PO-${year}-${pad(sequence, 5)}`;
}

/** Counter key for goods receipt numbers of one calendar year. */
export function goodsReceiptSequenceKey(year: number): string {
  return `GR-${year}`;
}

/** Goods receipt number: GR-{YYYY}-{SEQ5} (e.g. GR-2026-00108). */
export function formatGoodsReceiptNumber(
  year: number,
  sequence: number | bigint,
): string {
  return `GR-${year}-${pad(sequence, 5)}`;
}

/** Counter key for supplier return numbers of one calendar year. */
export function supplierReturnSequenceKey(year: number): string {
  return `SRN-${year}`;
}

/** Supplier return number: SRN-{YYYY}-{SEQ5} (e.g. SRN-2026-00003). */
export function formatSupplierReturnNumber(
  year: number,
  sequence: number | bigint,
): string {
  return `SRN-${year}-${pad(sequence, 5)}`;
}

/** Counter key for auto-generated supplier codes. */
export const SUPPLIER_CODE_SEQUENCE_KEY = 'SUP';

/** Supplier code: SUP-{SEQ5} (e.g. SUP-00007). */
export function formatSupplierCode(sequence: number | bigint): string {
  return `SUP-${pad(sequence, 5)}`;
}
