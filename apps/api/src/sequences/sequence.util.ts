/**
 * Pure formatting helpers for business document numbers (api-outline 1.9).
 * Numbers are always generated from sequence_counters — never from primary
 * keys. Keeping the formatting pure makes it unit-testable without a database.
 */

/** Zero-pad a sequence value to the given width (wider values are kept). */
export function formatSequence(value: number | bigint, width: number): string {
  return value.toString().padStart(width, '0');
}

/** Sequence-counter key for employee numbers. */
export const EMPLOYEE_NUMBER_SEQUENCE_KEY = 'EMP';

/** Employee number pattern: EMP-{SEQ6} (e.g. EMP-000123). */
export function formatEmployeeNumber(sequence: number | bigint): string {
  return `EMP-${formatSequence(sequence, 6)}`;
}

/** Sequence-counter key for SKUs of a category (per-category counters). */
export function skuSequenceKey(categoryCode: string): string {
  return `SKU-${categoryCode.toUpperCase()}`;
}

/** Item SKU pattern: SKU-{CATEGORY_CODE}-{SEQ5} (e.g. SKU-PPR-00017). */
export function formatSku(
  categoryCode: string,
  sequence: number | bigint,
): string {
  return `SKU-${categoryCode.toUpperCase()}-${formatSequence(sequence, 5)}`;
}
