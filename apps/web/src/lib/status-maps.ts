/**
 * Client-side mirrors of docs/status-transitions.md — which actions are legal
 * from each document/asset status, and which permission(s) unlock each action.
 * The server is always the authority (`409 INVALID_STATE_TRANSITION`); these
 * maps only drive button visibility.
 *
 * Permission entries are "any of" lists so UI gating tolerates the small
 * naming drifts between the spec appendix and the @gemerp/shared catalog
 * (e.g. `asset.print_label` vs `asset.print`).
 */
import {
  AssetStatus,
  PERMISSIONS,
  StockTransactionStatus,
  StockTransactionType,
  TransferStatus,
} from '@gemerp/shared';

/* ---------------------- Stock transaction types --------------------------- */

export const STOCK_TRANSACTION_TYPE_LABELS: Record<string, string> = {
  [StockTransactionType.OPENING_BALANCE]: 'Opening balance',
  [StockTransactionType.PURCHASE_RECEIPT]: 'Purchase receipt',
  [StockTransactionType.NON_PURCHASE_RECEIPT]: 'Non-purchase receipt',
  [StockTransactionType.ISSUE_TO_EMPLOYEE]: 'Issue to employee',
  [StockTransactionType.ISSUE_TO_DEPARTMENT]: 'Issue to department',
  [StockTransactionType.RETURN_FROM_EMPLOYEE]: 'Return from employee',
  [StockTransactionType.RETURN_TO_SUPPLIER]: 'Return to supplier',
  [StockTransactionType.LOCATION_TRANSFER]: 'Location transfer',
  [StockTransactionType.INTER_BRANCH_TRANSFER]: 'Inter-branch transfer',
  [StockTransactionType.ADJUSTMENT_INCREASE]: 'Adjustment (increase)',
  [StockTransactionType.ADJUSTMENT_DECREASE]: 'Adjustment (decrease)',
  [StockTransactionType.MAINTENANCE_ISSUE]: 'Maintenance-parts issue',
  [StockTransactionType.DISPOSAL]: 'Disposal / write-off',
  [StockTransactionType.REVERSAL]: 'Reversal',
};

export function stockTransactionTypeLabel(type: string): string {
  return STOCK_TRANSACTION_TYPE_LABELS[type] ?? type;
}

/** Create/edit permission per transaction type (contract §4.1). */
export const STOCK_TRANSACTION_TYPE_PERMISSION: Record<string, string> = {
  [StockTransactionType.OPENING_BALANCE]: PERMISSIONS.inventory.adjust,
  [StockTransactionType.PURCHASE_RECEIPT]: PERMISSIONS.inventory.receive,
  [StockTransactionType.NON_PURCHASE_RECEIPT]: PERMISSIONS.inventory.receive,
  [StockTransactionType.ISSUE_TO_EMPLOYEE]: PERMISSIONS.inventory.issue,
  [StockTransactionType.ISSUE_TO_DEPARTMENT]: PERMISSIONS.inventory.issue,
  [StockTransactionType.RETURN_FROM_EMPLOYEE]: PERMISSIONS.inventory.return,
  [StockTransactionType.RETURN_TO_SUPPLIER]: PERMISSIONS.inventory.return,
  [StockTransactionType.LOCATION_TRANSFER]: PERMISSIONS.inventory.transfer,
  [StockTransactionType.ADJUSTMENT_INCREASE]: PERMISSIONS.inventory.adjust,
  [StockTransactionType.ADJUSTMENT_DECREASE]: PERMISSIONS.inventory.adjust,
  [StockTransactionType.MAINTENANCE_ISSUE]: PERMISSIONS.inventory.issue,
  [StockTransactionType.DISPOSAL]: PERMISSIONS.inventory.adjust,
};

/** Types offered by the create wizard (reversal and inter-branch legs are system-made). */
export const CREATABLE_TRANSACTION_TYPES: string[] = [
  StockTransactionType.PURCHASE_RECEIPT,
  StockTransactionType.NON_PURCHASE_RECEIPT,
  StockTransactionType.ISSUE_TO_EMPLOYEE,
  StockTransactionType.ISSUE_TO_DEPARTMENT,
  StockTransactionType.RETURN_FROM_EMPLOYEE,
  StockTransactionType.RETURN_TO_SUPPLIER,
  StockTransactionType.LOCATION_TRANSFER,
  StockTransactionType.ADJUSTMENT_INCREASE,
  StockTransactionType.ADJUSTMENT_DECREASE,
  StockTransactionType.DISPOSAL,
  StockTransactionType.MAINTENANCE_ISSUE,
  StockTransactionType.OPENING_BALANCE,
];

export function transactionTypeNeedsEmployee(type: string): boolean {
  return (
    type === StockTransactionType.ISSUE_TO_EMPLOYEE ||
    type === StockTransactionType.RETURN_FROM_EMPLOYEE
  );
}

export function transactionTypeNeedsDepartment(type: string): boolean {
  return type === StockTransactionType.ISSUE_TO_DEPARTMENT;
}

/** Reason capture is mandatory for adjustments and disposals (spec §25). */
export function transactionTypeNeedsReason(type: string): boolean {
  return (
    type === StockTransactionType.ADJUSTMENT_INCREASE ||
    type === StockTransactionType.ADJUSTMENT_DECREASE ||
    type === StockTransactionType.DISPOSAL
  );
}

/* --------------- Stock transaction document actions ----------------------- */

/** `inventory.approve` per api-outline Appendix A (not in the shared catalog yet). */
export const INVENTORY_APPROVE_PERMISSIONS = ['inventory.approve', PERMISSIONS.approval.act];

export type StockTransactionAction =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'post'
  | 'cancel'
  | 'reverse';

const STOCK_TRANSACTION_ACTIONS: Record<string, StockTransactionAction[]> = {
  [StockTransactionStatus.DRAFT]: ['submit', 'cancel'],
  [StockTransactionStatus.PENDING_APPROVAL]: ['approve', 'reject', 'cancel'],
  [StockTransactionStatus.APPROVED]: ['post', 'cancel'],
  [StockTransactionStatus.POSTED]: ['reverse'],
  [StockTransactionStatus.REJECTED]: [],
  [StockTransactionStatus.CANCELED]: [],
  [StockTransactionStatus.REVERSED]: [],
};

export function stockTransactionActionsFor(status: string): StockTransactionAction[] {
  return STOCK_TRANSACTION_ACTIONS[status] ?? [];
}

/** Permission "any of" list per stock-transaction action. */
export function stockTransactionActionPermissions(
  action: StockTransactionAction,
  type: string,
): string[] {
  switch (action) {
    case 'submit':
      return [
        STOCK_TRANSACTION_TYPE_PERMISSION[type] ?? PERMISSIONS.inventory.adjust,
        'inventory.submit',
      ];
    case 'approve':
    case 'reject':
      return INVENTORY_APPROVE_PERMISSIONS;
    case 'post':
      return [PERMISSIONS.inventory.post];
    case 'cancel':
      return [PERMISSIONS.inventory.cancel];
    case 'reverse':
      return [PERMISSIONS.inventory.reverse];
  }
}

/* --------------------------- Transfer documents --------------------------- */

export type TransferAction =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'dispatch'
  | 'receive'
  | 'cancel';

const TRANSFER_ACTIONS: Record<string, TransferAction[]> = {
  [TransferStatus.DRAFT]: ['submit', 'cancel'],
  [TransferStatus.PENDING_APPROVAL]: ['approve', 'reject', 'cancel'],
  [TransferStatus.APPROVED]: ['dispatch', 'cancel'],
  [TransferStatus.IN_TRANSIT]: ['receive'],
  [TransferStatus.RECEIVED]: [],
  [TransferStatus.REJECTED]: [],
  [TransferStatus.CANCELED]: [],
};

export function transferActionsFor(status: string): TransferAction[] {
  return TRANSFER_ACTIONS[status] ?? [];
}

export function transferActionPermissions(action: TransferAction): string[] {
  switch (action) {
    case 'submit':
      return [PERMISSIONS.transfer.create, PERMISSIONS.transfer.submit];
    case 'approve':
    case 'reject':
      return [PERMISSIONS.transfer.approve];
    case 'dispatch':
      return [PERMISSIONS.transfer.dispatch];
    case 'receive':
      return [PERMISSIONS.transfer.receive];
    case 'cancel':
      return [PERMISSIONS.transfer.cancel];
  }
}

/** Ordered steps for the transfer status stepper. */
export const TRANSFER_STEPS: Array<{ status: string; label: string }> = [
  { status: TransferStatus.DRAFT, label: 'Draft' },
  { status: TransferStatus.PENDING_APPROVAL, label: 'Pending approval' },
  { status: TransferStatus.APPROVED, label: 'Approved' },
  { status: TransferStatus.IN_TRANSIT, label: 'In transit' },
  { status: TransferStatus.RECEIVED, label: 'Received' },
];

/* ------------------------------ Asset actions ----------------------------- */

/**
 * Lifecycle event names as exposed by the API's `permittedActions` array
 * (apps/api asset-status-machine). Events driven by other modules
 * (dispatch/receive/maintenance-complete/…) are intentionally not listed —
 * they never render as direct buttons on the asset page.
 */
export type AssetAction =
  | 'activate'
  | 'reserve'
  | 'release'
  | 'assign'
  | 'reassign'
  | 'return'
  | 'send-to-inspection'
  | 'inspection-pass'
  | 'inspection-fail'
  | 'send-to-maintenance'
  | 'report-damage'
  | 'report-loss'
  | 'recover'
  | 'write-off'
  | 'retire'
  | 'dispose'
  | 'reverse-disposal';

export const ASSET_ACTION_LABELS: Record<AssetAction, string> = {
  activate: 'Activate',
  reserve: 'Reserve',
  release: 'Release reservation',
  assign: 'Assign',
  reassign: 'Reassign / move',
  return: 'Return',
  'send-to-inspection': 'Send to inspection',
  'inspection-pass': 'Record inspection',
  'inspection-fail': 'Record inspection',
  'send-to-maintenance': 'Send to maintenance',
  'report-damage': 'Report damage',
  'report-loss': 'Report loss',
  recover: 'Recover',
  'write-off': 'Write off',
  retire: 'Retire',
  dispose: 'Dispose',
  'reverse-disposal': 'Reverse disposal',
};

/** Fallback menus per status (used when the API omits permittedActions). */
const ASSET_ACTIONS: Record<string, AssetAction[]> = {
  [AssetStatus.DRAFT]: ['activate'],
  [AssetStatus.AVAILABLE]: [
    'assign',
    'reserve',
    'send-to-inspection',
    'send-to-maintenance',
    'report-damage',
    'report-loss',
    'retire',
  ],
  [AssetStatus.RESERVED]: ['assign', 'release', 'report-damage', 'report-loss'],
  [AssetStatus.ASSIGNED]: [
    'return',
    'reassign',
    'send-to-inspection',
    'send-to-maintenance',
    'report-damage',
    'report-loss',
  ],
  [AssetStatus.IN_TRANSFER]: ['report-loss'],
  [AssetStatus.UNDER_INSPECTION]: ['inspection-pass', 'inspection-fail'],
  [AssetStatus.UNDER_MAINTENANCE]: [],
  [AssetStatus.DAMAGED]: ['send-to-inspection', 'send-to-maintenance', 'retire'],
  [AssetStatus.LOST]: ['recover', 'write-off'],
  [AssetStatus.RETIRED]: ['dispose'],
  [AssetStatus.DISPOSED]: ['reverse-disposal'],
};

const KNOWN_ASSET_ACTIONS = new Set<string>(Object.keys(ASSET_ACTION_LABELS));

export function isKnownAssetAction(action: string): action is AssetAction {
  return KNOWN_ASSET_ACTIONS.has(action);
}

export function assetActionsFor(status: string): AssetAction[] {
  return ASSET_ACTIONS[status] ?? [];
}

/** Permission "any of" list per asset action (contract §4.3 bindings). */
export function assetActionPermissions(action: AssetAction): string[] {
  switch (action) {
    case 'activate':
      return [PERMISSIONS.asset.create, PERMISSIONS.asset.update];
    case 'assign':
      return [PERMISSIONS.asset.assign];
    case 'reassign':
      return [PERMISSIONS.asset.assign, PERMISSIONS.asset.transfer];
    case 'return':
      return [PERMISSIONS.asset.assign, PERMISSIONS.asset.return];
    case 'reserve':
    case 'release':
      return [PERMISSIONS.asset.assign, 'asset.reserve'];
    case 'send-to-inspection':
    case 'inspection-pass':
    case 'inspection-fail':
      return [PERMISSIONS.asset.inspect, PERMISSIONS.asset.update];
    case 'send-to-maintenance':
      return [PERMISSIONS.maintenanceWorkOrder.manage];
    case 'report-damage':
    case 'report-loss':
      return [PERMISSIONS.asset.reportIncident];
    case 'recover':
      return [PERMISSIONS.asset.update, 'asset.recover'];
    case 'write-off':
    case 'retire':
      return [PERMISSIONS.asset.retire];
    case 'dispose':
    case 'reverse-disposal':
      return [PERMISSIONS.asset.dispose];
  }
}

/** Label print permission tolerates both catalog spellings. */
export const ASSET_LABEL_PERMISSIONS = [PERMISSIONS.asset.print, 'asset.print_label'];
