import { AssetLifecycleStatus } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import { AppException } from '../common/errors/app.exception';

/**
 * Serialized-asset lifecycle state machine (docs/status-transitions.md §1).
 *
 * Status is never mutated by a generic PATCH: every transition is a named
 * event with a dedicated action endpoint, validated here inside the same
 * database transaction that performs the side effects. Illegal events raise
 * 409 INVALID_STATE_TRANSITION.
 *
 * `dispatch` / `receive` / `receive-damaged` / `lost-in-transit` are driven by
 * transfer documents (owned by the transfers module) but are part of this map
 * so the machine stays the single source of truth.
 */

const S = AssetLifecycleStatus;

export type AssetEvent =
  | 'activate'
  | 'reserve'
  | 'release'
  | 'assign'
  | 'reassign'
  | 'return'
  | 'return-damaged'
  | 'report-damage'
  | 'report-loss'
  | 'send-to-inspection'
  | 'inspection-pass'
  | 'inspection-fail'
  | 'send-to-maintenance'
  | 'maintenance-complete'
  | 'recover'
  | 'write-off'
  | 'retire'
  | 'dispose'
  | 'reverse-disposal'
  | 'dispatch'
  | 'receive'
  | 'receive-damaged'
  | 'lost-in-transit';

interface TransitionRule {
  from: readonly AssetLifecycleStatus[];
  /** Default target status. Events with a chosen outcome list alternatives. */
  to: AssetLifecycleStatus;
  /** Additional target statuses the event may legally resolve to. */
  outcomes?: readonly AssetLifecycleStatus[];
  /** Permission string required to fire the event. */
  permission: string;
  /** Whether a reason/description is mandatory (spec §25). */
  reasonRequired?: boolean;
}

export const ASSET_TRANSITIONS: Record<AssetEvent, TransitionRule> = {
  activate: {
    from: [S.DRAFT],
    to: S.AVAILABLE,
    permission: PERMISSIONS.asset.create,
  },
  reserve: {
    from: [S.AVAILABLE],
    to: S.RESERVED,
    permission: PERMISSIONS.asset.assign,
  },
  release: {
    from: [S.RESERVED],
    to: S.AVAILABLE,
    permission: PERMISSIONS.asset.assign,
  },
  assign: {
    from: [S.AVAILABLE, S.RESERVED],
    to: S.ASSIGNED,
    permission: PERMISSIONS.asset.assign,
  },
  reassign: {
    from: [S.ASSIGNED],
    to: S.ASSIGNED,
    permission: PERMISSIONS.asset.assign,
  },
  return: {
    from: [S.ASSIGNED],
    to: S.AVAILABLE,
    permission: PERMISSIONS.asset.assign,
  },
  'return-damaged': {
    from: [S.ASSIGNED],
    to: S.DAMAGED,
    permission: PERMISSIONS.asset.assign,
    reasonRequired: true,
  },
  'report-damage': {
    from: [S.AVAILABLE, S.RESERVED, S.ASSIGNED],
    to: S.DAMAGED,
    permission: PERMISSIONS.asset.reportIncident,
    reasonRequired: true,
  },
  'report-loss': {
    from: [S.AVAILABLE, S.ASSIGNED, S.IN_TRANSFER],
    to: S.LOST,
    permission: PERMISSIONS.asset.reportIncident,
    reasonRequired: true,
  },
  'send-to-inspection': {
    from: [S.AVAILABLE, S.ASSIGNED, S.DAMAGED],
    to: S.UNDER_INSPECTION,
    permission: PERMISSIONS.asset.inspect,
  },
  'inspection-pass': {
    from: [S.UNDER_INSPECTION],
    to: S.AVAILABLE,
    permission: PERMISSIONS.asset.inspect,
  },
  'inspection-fail': {
    from: [S.UNDER_INSPECTION],
    to: S.DAMAGED,
    permission: PERMISSIONS.asset.inspect,
    reasonRequired: true,
  },
  'send-to-maintenance': {
    from: [S.AVAILABLE, S.ASSIGNED, S.DAMAGED, S.UNDER_INSPECTION],
    to: S.UNDER_MAINTENANCE,
    permission: PERMISSIONS.maintenanceWorkOrder.manage,
  },
  'maintenance-complete': {
    from: [S.UNDER_MAINTENANCE],
    to: S.AVAILABLE,
    outcomes: [S.AVAILABLE, S.ASSIGNED, S.DAMAGED, S.RETIRED],
    permission: PERMISSIONS.maintenanceWorkOrder.manage,
  },
  recover: {
    from: [S.LOST],
    to: S.UNDER_INSPECTION,
    permission: PERMISSIONS.asset.update,
    reasonRequired: true,
  },
  'write-off': {
    from: [S.LOST],
    to: S.RETIRED,
    permission: PERMISSIONS.asset.retire,
    reasonRequired: true,
  },
  retire: {
    from: [S.AVAILABLE, S.DAMAGED],
    to: S.RETIRED,
    permission: PERMISSIONS.asset.retire,
    reasonRequired: true,
  },
  dispose: {
    from: [S.RETIRED],
    to: S.DISPOSED,
    permission: PERMISSIONS.asset.dispose,
    reasonRequired: true,
  },
  'reverse-disposal': {
    from: [S.DISPOSED],
    to: S.RETIRED,
    permission: PERMISSIONS.asset.dispose,
    reasonRequired: true,
  },
  // Transfer-document-driven events (transfers module fires these).
  dispatch: {
    from: [S.AVAILABLE, S.RESERVED],
    to: S.IN_TRANSFER,
    permission: PERMISSIONS.asset.transfer,
  },
  receive: {
    from: [S.IN_TRANSFER],
    to: S.AVAILABLE,
    permission: PERMISSIONS.asset.transfer,
  },
  'receive-damaged': {
    from: [S.IN_TRANSFER],
    to: S.DAMAGED,
    permission: PERMISSIONS.asset.transfer,
    reasonRequired: true,
  },
  'lost-in-transit': {
    from: [S.IN_TRANSFER],
    to: S.LOST,
    permission: PERMISSIONS.asset.reportIncident,
    reasonRequired: true,
  },
};

const STATUS_LABELS: Record<AssetLifecycleStatus, string> = {
  DRAFT: 'Draft',
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  ASSIGNED: 'Assigned',
  IN_TRANSFER: 'In Transfer',
  UNDER_INSPECTION: 'Under Inspection',
  UNDER_MAINTENANCE: 'Under Maintenance',
  DAMAGED: 'Damaged',
  LOST: 'Lost',
  RETIRED: 'Retired',
  DISPOSED: 'Disposed',
};

export function statusLabel(status: AssetLifecycleStatus): string {
  return STATUS_LABELS[status];
}

/** Whether `event` may legally fire from `current`. */
export function canTransition(
  current: AssetLifecycleStatus,
  event: AssetEvent,
): boolean {
  return ASSET_TRANSITIONS[event].from.includes(current);
}

/**
 * Validate the event against the machine and resolve the target status.
 * Illegal events → 409 INVALID_STATE_TRANSITION with an actionable message.
 * Events with alternative outcomes validate the chosen `outcome`.
 */
export function assertTransition(
  current: AssetLifecycleStatus,
  event: AssetEvent,
  outcome?: AssetLifecycleStatus,
): AssetLifecycleStatus {
  const rule = ASSET_TRANSITIONS[event];
  if (!rule.from.includes(current)) {
    throw AppException.invalidStateTransition(
      `Cannot ${event} an asset that is ${statusLabel(current)}. ` +
        `Allowed from: ${rule.from.map(statusLabel).join(', ')}.`,
    );
  }
  if (outcome !== undefined) {
    const allowed = rule.outcomes ?? [rule.to];
    if (!allowed.includes(outcome)) {
      throw AppException.invalidStateTransition(
        `"${statusLabel(outcome)}" is not a valid outcome of ${event}. ` +
          `Allowed outcomes: ${allowed.map(statusLabel).join(', ')}.`,
      );
    }
    return outcome;
  }
  return rule.to;
}

/** Events exposed as asset action endpoints (Phase 3 surface). */
const ENDPOINT_EVENTS: readonly AssetEvent[] = [
  'activate',
  'reserve',
  'release',
  'assign',
  'reassign',
  'return',
  'report-damage',
  'report-loss',
  'send-to-inspection',
  'inspection-pass',
  'inspection-fail',
  'send-to-maintenance',
  'maintenance-complete',
  'recover',
  'write-off',
  'retire',
  'dispose',
  'reverse-disposal',
];

/**
 * Actions the caller may fire on an asset in `status`, given their granted
 * permissions. Drives the scan-result action list and UI action menus —
 * the server re-validates on every actual call regardless.
 */
export function permittedActions(
  status: AssetLifecycleStatus,
  user: { isSuperAdmin: boolean; permissions: readonly string[] },
): AssetEvent[] {
  return ENDPOINT_EVENTS.filter((event) => {
    const rule = ASSET_TRANSITIONS[event];
    if (!rule.from.includes(status)) {
      return false;
    }
    return user.isSuperAdmin || user.permissions.includes(rule.permission);
  });
}
