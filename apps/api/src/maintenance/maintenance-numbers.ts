/**
 * Pure document-number formatting for Phase 5 maintenance (api-outline 1.9).
 * Numbers come from sequence_counters via SequenceService — never from
 * primary keys. Counter keys embed the calendar year ("WO-2026").
 */

function pad(value: number | bigint, width: number): string {
  return value.toString().padStart(width, '0');
}

/** Counter key for work-order numbers of one calendar year. */
export function workOrderSequenceKey(year: number): string {
  return `WO-${year}`;
}

/** Work order number: WO-{YYYY}-{SEQ5} (e.g. WO-2026-00077). */
export function formatWorkOrderNumber(
  year: number,
  sequence: number | bigint,
): string {
  return `WO-${year}-${pad(sequence, 5)}`;
}

/** Counter key for auto-generated maintenance plan codes. */
export const MAINTENANCE_PLAN_CODE_SEQUENCE_KEY = 'MPL';

/** Maintenance plan code: MPL-{SEQ5} (e.g. MPL-00003). */
export function formatMaintenancePlanCode(sequence: number | bigint): string {
  return `MPL-${pad(sequence, 5)}`;
}
