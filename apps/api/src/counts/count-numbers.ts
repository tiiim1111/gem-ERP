import { formatSequence } from '../sequences/sequence.util';

/** Sequence-counter key for count sessions of a year. */
export function countSessionSequenceKey(year: number): string {
  return `CNT-${year}`;
}

/** Count session number pattern: CNT-{YYYY}-{SEQ5} (api-outline 1.9). */
export function formatCountSessionNumber(
  year: number,
  sequence: number | bigint,
): string {
  return `CNT-${year}-${formatSequence(sequence, 5)}`;
}
