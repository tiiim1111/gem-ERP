import { MaintenanceWorkOrderStatus, Prisma } from '@prisma/client';

/**
 * Pure domain rules for maintenance work orders (spec §18,
 * docs/status-transitions.md §5). No Nest/Prisma clients so the state
 * machine and cost math are unit-testable without infrastructure.
 *
 * Machine: Draft, Open, Assigned, Scheduled, In Progress, On Hold,
 * Awaiting Parts, Awaiting Vendor, Completed, Verified, Canceled.
 *
 * The REST contract (api-outline 6.2) exposes no separate `open` action:
 * creation requires problem/type/priority — exactly the Draft→Open guard —
 * so API-created (and plan-generated) WOs land directly on OPEN. DRAFT stays
 * in the enum for the machine's completeness but is never a resting state
 * of this API (mirrors the PO machine's unused REJECTED member).
 */

const S = MaintenanceWorkOrderStatus;

export type WorkOrderEvent =
  | 'update'
  | 'assign'
  | 'schedule'
  | 'start'
  | 'hold'
  | 'resume'
  | 'issue-parts'
  | 'replace-tasks'
  | 'complete-task'
  | 'complete'
  | 'verify'
  | 'cancel';

const TRANSITIONS: Record<
  MaintenanceWorkOrderStatus,
  readonly WorkOrderEvent[]
> = {
  [S.DRAFT]: ['update', 'assign', 'schedule', 'replace-tasks', 'cancel'],
  [S.OPEN]: ['update', 'assign', 'schedule', 'replace-tasks', 'cancel'],
  [S.ASSIGNED]: [
    'update',
    'assign',
    'schedule',
    'start',
    'replace-tasks',
    'cancel',
  ],
  [S.SCHEDULED]: [
    'update',
    'assign',
    'schedule',
    'start',
    'replace-tasks',
    'cancel',
  ],
  [S.IN_PROGRESS]: [
    'update',
    'hold',
    'issue-parts',
    'complete-task',
    'complete',
    'cancel',
  ],
  [S.ON_HOLD]: ['update', 'resume', 'complete-task', 'cancel'],
  // Parts may be issued straight from AWAITING_PARTS — the posted issue is
  // the `parts-received` event and resumes the WO (status-transitions §5).
  [S.AWAITING_PARTS]: ['update', 'resume', 'issue-parts', 'complete-task', 'cancel'],
  [S.AWAITING_VENDOR]: ['update', 'resume', 'complete-task', 'cancel'],
  [S.COMPLETED]: ['verify'],
  [S.VERIFIED]: [],
  [S.CANCELED]: [],
};

export function canTransitionWo(
  from: MaintenanceWorkOrderStatus,
  event: WorkOrderEvent,
): boolean {
  return TRANSITIONS[from].includes(event);
}

/** Human-readable transition failure message for the 409 envelope. */
export function woTransitionError(
  from: MaintenanceWorkOrderStatus,
  event: WorkOrderEvent,
): string {
  const allowed = TRANSITIONS[from];
  return `Cannot ${event} a ${from} work order${
    allowed.length > 0
      ? ` (allowed: ${allowed.join(', ')})`
      : ' (terminal status)'
  }.`;
}

// ---------------------------------------------------------------------------
// Hold reasons (api-outline 6.2: POST .../hold {reason})
// ---------------------------------------------------------------------------

/** The contract's hold reasons map 1:1 onto waiting statuses. */
export const HOLD_REASONS = [
  'On Hold',
  'Awaiting Parts',
  'Awaiting Vendor',
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

const HOLD_TARGETS: Record<HoldReason, MaintenanceWorkOrderStatus> = {
  'On Hold': S.ON_HOLD,
  'Awaiting Parts': S.AWAITING_PARTS,
  'Awaiting Vendor': S.AWAITING_VENDOR,
};

export function holdTargetStatus(reason: HoldReason): MaintenanceWorkOrderStatus {
  return HOLD_TARGETS[reason];
}

/** Statuses `resume` may fire from (back to IN_PROGRESS). */
export const RESUMABLE_STATUSES: readonly MaintenanceWorkOrderStatus[] = [
  S.ON_HOLD,
  S.AWAITING_PARTS,
  S.AWAITING_VENDOR,
];

// ---------------------------------------------------------------------------
// Open / terminal status sets
// ---------------------------------------------------------------------------

/**
 * Statuses that count as "open" — one open WO per (plan, asset) is the
 * generation invariant, and an open WO blocks asset retirement/dispatch.
 */
export const OPEN_WO_STATUSES: readonly MaintenanceWorkOrderStatus[] = [
  S.DRAFT,
  S.OPEN,
  S.ASSIGNED,
  S.SCHEDULED,
  S.IN_PROGRESS,
  S.ON_HOLD,
  S.AWAITING_PARTS,
  S.AWAITING_VENDOR,
];

export const TERMINAL_WO_STATUSES: readonly MaintenanceWorkOrderStatus[] = [
  S.COMPLETED,
  S.VERIFIED,
  S.CANCELED,
];

// ---------------------------------------------------------------------------
// Cost math (Decimal, server-side only)
// ---------------------------------------------------------------------------

/** total = labor + parts + external (nulls count as zero), 2dp. */
export function computeWorkOrderTotalCost(
  laborCost: Prisma.Decimal | null,
  partsCost: Prisma.Decimal | null,
  externalCost: Prisma.Decimal | null,
): Prisma.Decimal {
  const zero = new Prisma.Decimal(0);
  return (laborCost ?? zero)
    .add(partsCost ?? zero)
    .add(externalCost ?? zero)
    .toDecimalPlaces(2);
}

/** Σ line totalCost with nulls skipped, 2dp — the WO parts-cost roll-up. */
export function sumPartsCost(
  parts: ReadonlyArray<{ totalCost: Prisma.Decimal | null }>,
): Prisma.Decimal {
  return parts
    .reduce(
      (sum, part) => (part.totalCost ? sum.add(part.totalCost) : sum),
      new Prisma.Decimal(0),
    )
    .toDecimalPlaces(2);
}
