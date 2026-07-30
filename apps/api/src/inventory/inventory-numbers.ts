/**
 * Pure document-number formatting for Phase 3 (api-outline 1.9). Numbers come
 * from sequence_counters via SequenceService — never from primary keys. The
 * counter key embeds scope + period following the ERD examples
 * ("STK-2026", "TRF-2026", "LOT-SKU-PPR-00017-20260301").
 */

function pad(value: number | bigint, width: number): string {
  return value.toString().padStart(width, '0');
}

/** Counter key for stock transaction numbers of one calendar year. */
export function stockTransactionSequenceKey(year: number): string {
  return `STK-${year}`;
}

/** Stock transaction number: STK-{YYYY}-{SEQ6} (e.g. STK-2026-000482). */
export function formatStockTransactionNumber(
  year: number,
  sequence: number | bigint,
): string {
  return `STK-${year}-${pad(sequence, 6)}`;
}

/** Counter key for transfer numbers of one calendar year. */
export function transferSequenceKey(year: number): string {
  return `TRF-${year}`;
}

/** Transfer number: TRF-{YYYY}-{SEQ5} (e.g. TRF-2026-00021). */
export function formatTransferNumber(
  year: number,
  sequence: number | bigint,
): string {
  return `TRF-${year}-${pad(sequence, 5)}`;
}

/** Counter key for transfer receipt numbers of one calendar year. */
export function transferReceiptSequenceKey(year: number): string {
  return `TRFR-${year}`;
}

/** Transfer receipt number: TRFR-{YYYY}-{SEQ5}. */
export function formatTransferReceiptNumber(
  year: number,
  sequence: number | bigint,
): string {
  return `TRFR-${year}-${pad(sequence, 5)}`;
}

/** YYYYMMDD stamp (UTC) used inside lot numbers. */
export function lotDateStamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1, 2)}${pad(
    date.getUTCDate(),
    2,
  )}`;
}

/** Counter key for auto-generated lot numbers of one item + day. */
export function lotSequenceKey(sku: string, date: Date): string {
  return `LOT-${sku.toUpperCase()}-${lotDateStamp(date)}`;
}

/**
 * Lot number: LOT-{SKU}-{YYYYMMDD}-{SEQ2} with the SKU's leading "SKU-"
 * prefix dropped, matching the ERD example LOT-PPR-00017-20260301-01.
 */
export function formatLotNumber(
  sku: string,
  date: Date,
  sequence: number | bigint,
): string {
  const skuPart = sku.toUpperCase().replace(/^SKU-/, '');
  return `LOT-${skuPart}-${lotDateStamp(date)}-${pad(sequence, 2)}`;
}
