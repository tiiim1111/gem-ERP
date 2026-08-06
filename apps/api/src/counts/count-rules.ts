import { CountLineFlag, InventoryCountStatus, Prisma } from '@prisma/client';

/**
 * Pure count-session rules (spec §17, docs/status-transitions.md §6,
 * api-outline 7.1). No Nest/Prisma clients — the state machine, variance
 * math, and line classification are unit-testable without infrastructure.
 *
 * Status mapping (endpoint contract → InventoryCountStatus):
 *   create → DRAFT; start → IN_PROGRESS (snapshot); complete → REVIEW
 *   (counting closed, lines locked, variance frozen); create-adjustments →
 *   COMPLETED (terminal; also reached with zero variance); cancel →
 *   CANCELED. Recount from REVIEW reopens the session to IN_PROGRESS.
 */

export type CountSessionEvent =
  | 'update'
  | 'start'
  | 'record'
  | 'recount'
  | 'complete'
  | 'create-adjustments'
  | 'cancel';

const TRANSITIONS: Record<InventoryCountStatus, readonly CountSessionEvent[]> = {
  [InventoryCountStatus.DRAFT]: ['update', 'start', 'cancel'],
  [InventoryCountStatus.IN_PROGRESS]: ['record', 'recount', 'complete', 'cancel'],
  [InventoryCountStatus.REVIEW]: ['recount', 'create-adjustments', 'cancel'],
  [InventoryCountStatus.COMPLETED]: [],
  [InventoryCountStatus.CANCELED]: [],
};

export function canCountTransition(
  from: InventoryCountStatus,
  event: CountSessionEvent,
): boolean {
  return TRANSITIONS[from].includes(event);
}

export function countTransitionError(
  from: InventoryCountStatus,
  event: CountSessionEvent,
): string {
  const allowed = TRANSITIONS[from];
  return `Cannot ${event} a ${from} count session${
    allowed.length > 0
      ? ` (allowed: ${allowed.join(', ')})`
      : ' (terminal status)'
  }.`;
}

/**
 * Blind sessions hide expected quantities until counting closes
 * (api-outline 7.1): masked while DRAFT / IN_PROGRESS, revealed from
 * REVIEW on. Variance is masked with it — it trivially leaks the expected.
 */
export function shouldMaskExpected(session: {
  isBlind: boolean;
  status: InventoryCountStatus;
}): boolean {
  return (
    session.isBlind &&
    (session.status === InventoryCountStatus.DRAFT ||
      session.status === InventoryCountStatus.IN_PROGRESS)
  );
}

/** The pass a new entry lands in: recounted lines write the recount value. */
export function activeQuantityField(line: {
  recountRequested: boolean;
}): 'countedQuantity' | 'recountQuantity' {
  return line.recountRequested ? 'recountQuantity' : 'countedQuantity';
}

/** Recount supersedes first count; null = never counted. */
export function effectiveCountedQuantity(line: {
  countedQuantity: Prisma.Decimal | null;
  recountQuantity: Prisma.Decimal | null;
}): Prisma.Decimal | null {
  return line.recountQuantity ?? line.countedQuantity;
}

/**
 * SNAPSHOT-ISOLATED variance math: computed exclusively from the line's
 * frozen expectedQuantity (captured atomically at start) and the recorded
 * counts — stock that moved AFTER the snapshot can never corrupt it.
 * Uncounted lines count as 0 (the physical count found nothing).
 */
export function computeVarianceQuantity(line: {
  expectedQuantity: Prisma.Decimal | null;
  countedQuantity: Prisma.Decimal | null;
  recountQuantity: Prisma.Decimal | null;
}): Prisma.Decimal {
  const counted = effectiveCountedQuantity(line) ?? new Prisma.Decimal(0);
  const expected = line.expectedQuantity ?? new Prisma.Decimal(0);
  return counted.sub(expected);
}

/**
 * Final flag for a QUANTITY line at complete time. UNEXPECTED (created by
 * scanning something outside the snapshot) and DUPLICATE (double-counted)
 * are preserved as the more informative finding; otherwise the variance
 * decides MATCHED vs VARIANCE.
 */
export function classifyQuantityLine(line: {
  expectedQuantity: Prisma.Decimal | null;
  countedQuantity: Prisma.Decimal | null;
  recountQuantity: Prisma.Decimal | null;
  flag: CountLineFlag | null;
}): CountLineFlag {
  if (line.flag === CountLineFlag.UNEXPECTED) {
    return CountLineFlag.UNEXPECTED;
  }
  if (line.flag === CountLineFlag.DUPLICATE) {
    return CountLineFlag.DUPLICATE;
  }
  return computeVarianceQuantity(line).isZero()
    ? CountLineFlag.MATCHED
    : CountLineFlag.VARIANCE;
}

/**
 * Final flag for an ASSET line (spec §17: existence, condition, location
 * verification with missing / unexpected / duplicate / misplaced flags).
 * Priority: UNEXPECTED (not in snapshot) → MISSING (never verified or
 * explicitly not found) → MISPLACED (found but location not confirmed) →
 * DUPLICATE (verified twice) → MATCHED.
 */
export function classifyAssetLine(line: {
  assetFound: boolean | null;
  locationConfirmed: boolean | null;
  flag: CountLineFlag | null;
}): CountLineFlag {
  if (line.flag === CountLineFlag.UNEXPECTED) {
    return CountLineFlag.UNEXPECTED;
  }
  if (line.assetFound !== true) {
    return CountLineFlag.MISSING;
  }
  if (line.locationConfirmed === false) {
    return CountLineFlag.MISPLACED;
  }
  if (line.flag === CountLineFlag.DUPLICATE) {
    return CountLineFlag.DUPLICATE;
  }
  return CountLineFlag.MATCHED;
}
