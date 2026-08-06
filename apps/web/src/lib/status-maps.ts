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
  PurchaseOrderStatus,
  StockTransactionStatus,
  StockTransactionType,
  TransferStatus,
  WorkOrderStatus,
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
  [StockTransactionType.INTER_BRANCH_TRANSFER_OUT]: 'Inter-branch transfer (out)',
  [StockTransactionType.INTER_BRANCH_TRANSFER_IN]: 'Inter-branch transfer (in)',
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

/** Approve/reject pending stock transactions (Phase 3.5 catalog entry). */
export const INVENTORY_APPROVE_PERMISSIONS = [
  PERMISSIONS.inventory.approve,
  PERMISSIONS.approval.act,
];

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

/* --------------------------- Purchase orders ------------------------------- */

/**
 * Cost/price visibility on procurement documents. The shared catalog spells it
 * `procurement.po.view_cost`; the API outline sometimes shortens it to
 * `procurement.view_cost` — tolerate both.
 */
export const PROCUREMENT_COST_PERMISSIONS = [
  PERMISSIONS.procurementPo.viewCost,
  'procurement.view_cost',
];

export type PurchaseOrderAction =
  | 'edit'
  | 'submit'
  | 'approve'
  | 'reject'
  | 'receive'
  | 'cancel'
  | 'close';

/**
 * Legal actions per PO status (docs/status-transitions.md §3). `receive` is
 * the entry point into the goods-receipt flow, not a PO transition itself.
 * Receipt posting drives PARTIALLY/FULLY_RECEIVED as system events.
 */
const PURCHASE_ORDER_ACTIONS: Record<string, PurchaseOrderAction[]> = {
  [PurchaseOrderStatus.DRAFT]: ['edit', 'submit', 'cancel'],
  [PurchaseOrderStatus.PENDING_APPROVAL]: ['approve', 'reject', 'cancel'],
  [PurchaseOrderStatus.APPROVED]: ['receive', 'cancel'],
  [PurchaseOrderStatus.PARTIALLY_RECEIVED]: ['receive', 'close'],
  [PurchaseOrderStatus.FULLY_RECEIVED]: ['close'],
  [PurchaseOrderStatus.CANCELED]: [],
  [PurchaseOrderStatus.CLOSED]: [],
  // Prisma also knows a REJECTED status; the contract folds rejection back to
  // Draft, but tolerate the value should the API ever surface it.
  REJECTED: ['edit', 'submit', 'cancel'],
};

export function purchaseOrderActionsFor(status: string): PurchaseOrderAction[] {
  return PURCHASE_ORDER_ACTIONS[status] ?? [];
}

/** Permission "any of" list per PO action (contract §5.2 bindings). */
export function purchaseOrderActionPermissions(action: PurchaseOrderAction): string[] {
  switch (action) {
    case 'edit':
      return [PERMISSIONS.procurementPo.update];
    case 'submit':
      return [PERMISSIONS.procurementPo.create, PERMISSIONS.procurementPo.submit];
    case 'approve':
      return [PERMISSIONS.procurementPo.approve];
    case 'reject':
      return [PERMISSIONS.procurementPo.approve, PERMISSIONS.procurementPo.reject];
    case 'receive':
      return [PERMISSIONS.procurementReceipt.create];
    case 'cancel':
      return [PERMISSIONS.procurementPo.cancel];
    case 'close':
      return [PERMISSIONS.procurementPo.close];
  }
}

/** Ordered steps for the PO status stepper (terminal bad states excluded). */
export const PURCHASE_ORDER_STEPS: Array<{ status: string; label: string }> = [
  { status: PurchaseOrderStatus.DRAFT, label: 'Draft' },
  { status: PurchaseOrderStatus.PENDING_APPROVAL, label: 'Pending approval' },
  { status: PurchaseOrderStatus.APPROVED, label: 'Approved' },
  { status: PurchaseOrderStatus.PARTIALLY_RECEIVED, label: 'Partially received' },
  { status: PurchaseOrderStatus.FULLY_RECEIVED, label: 'Fully received' },
  { status: PurchaseOrderStatus.CLOSED, label: 'Closed' },
];

/** PO statuses a goods receipt can be recorded against. */
export const RECEIVABLE_PO_STATUSES: string[] = [
  PurchaseOrderStatus.APPROVED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
];

/* ----------------------------- Goods receipts ------------------------------ */

export type GoodsReceiptAction = 'post' | 'cancel' | 'reverse';

/** GoodsReceiptStatus: DRAFT | POSTED | CANCELED | REVERSED. */
const GOODS_RECEIPT_ACTIONS: Record<string, GoodsReceiptAction[]> = {
  DRAFT: ['post', 'cancel'],
  POSTED: ['reverse'],
  CANCELED: [],
  REVERSED: [],
};

export function goodsReceiptActionsFor(status: string): GoodsReceiptAction[] {
  return GOODS_RECEIPT_ACTIONS[status] ?? [];
}

export function goodsReceiptActionPermissions(action: GoodsReceiptAction): string[] {
  switch (action) {
    case 'post':
      return [PERMISSIONS.procurementReceipt.post];
    case 'cancel':
      return [PERMISSIONS.procurementReceipt.create, PERMISSIONS.procurementReceipt.cancel];
    case 'reverse':
      return [PERMISSIONS.procurementReceipt.reverse];
  }
}

/* ===================== Phase 5 — Maintenance (contract §6) ================= */

/**
 * Cost visibility on work orders / plans. The shared catalog spells it
 * `maintenance.work_order.view_cost`; api-outline Appendix A shortens it to
 * `maintenance.view_cost` — tolerate both.
 */
export const MAINTENANCE_COST_PERMISSIONS = [
  PERMISSIONS.maintenanceWorkOrder.viewCost,
  'maintenance.view_cost',
];

/**
 * Plan administration. The contract binds writes to `maintenance.plan.manage`;
 * the shared catalog splits create/update/archive — any of them unlocks the UI.
 */
export const MAINTENANCE_PLAN_MANAGE_PERMISSIONS = [
  'maintenance.plan.manage',
  PERMISSIONS.maintenancePlan.create,
  PERMISSIONS.maintenancePlan.update,
];

/** Create a work order (contract §6.2 binds POST to manage). */
export const WORK_ORDER_CREATE_PERMISSIONS = [
  PERMISSIONS.maintenanceWorkOrder.create,
  PERMISSIONS.maintenanceWorkOrder.manage,
];

/* ------------------------ Work-order lifecycle ----------------------------- */

export const WORK_ORDER_STATUS_LABELS: Record<string, string> = {
  [WorkOrderStatus.DRAFT]: 'Draft',
  [WorkOrderStatus.OPEN]: 'Open',
  [WorkOrderStatus.ASSIGNED]: 'Assigned',
  [WorkOrderStatus.SCHEDULED]: 'Scheduled',
  [WorkOrderStatus.IN_PROGRESS]: 'In progress',
  [WorkOrderStatus.ON_HOLD]: 'On hold',
  [WorkOrderStatus.AWAITING_PARTS]: 'Awaiting parts',
  [WorkOrderStatus.AWAITING_VENDOR]: 'Awaiting vendor',
  [WorkOrderStatus.COMPLETED]: 'Completed',
  [WorkOrderStatus.VERIFIED]: 'Verified',
  [WorkOrderStatus.CANCELED]: 'Canceled',
};

export function workOrderStatusLabel(status: string): string {
  return WORK_ORDER_STATUS_LABELS[status] ?? status;
}

/** Statuses that count as "open" (not yet completed/verified/canceled). */
export const OPEN_WORK_ORDER_STATUSES: string[] = [
  WorkOrderStatus.OPEN,
  WorkOrderStatus.ASSIGNED,
  WorkOrderStatus.SCHEDULED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.ON_HOLD,
  WorkOrderStatus.AWAITING_PARTS,
  WorkOrderStatus.AWAITING_VENDOR,
];

/** Waiting side-states that render at the In Progress stepper position. */
export const WORK_ORDER_WAITING_STATUSES: string[] = [
  WorkOrderStatus.ON_HOLD,
  WorkOrderStatus.AWAITING_PARTS,
  WorkOrderStatus.AWAITING_VENDOR,
];

export type WorkOrderAction =
  | 'edit'
  | 'assign'
  | 'schedule'
  | 'start'
  | 'hold'
  | 'resume'
  | 'complete'
  | 'verify'
  | 'cancel';

/**
 * Legal actions per WO status (docs/status-transitions.md §5, mirrored by the
 * API's work-order-rules). Creation requires the Draft→Open guard fields, so
 * API-created WOs land directly on OPEN (no separate `open` action).
 * `await-parts` / `await-vendor` are the hold endpoint with the matching
 * reason; `parts-received` / `vendor-done` are resume.
 */
const WORK_ORDER_ACTIONS: Record<string, WorkOrderAction[]> = {
  [WorkOrderStatus.DRAFT]: ['edit', 'assign', 'schedule', 'cancel'],
  [WorkOrderStatus.OPEN]: ['edit', 'assign', 'schedule', 'cancel'],
  [WorkOrderStatus.ASSIGNED]: ['edit', 'assign', 'schedule', 'start', 'cancel'],
  [WorkOrderStatus.SCHEDULED]: ['edit', 'assign', 'schedule', 'start', 'cancel'],
  [WorkOrderStatus.IN_PROGRESS]: ['edit', 'hold', 'complete', 'cancel'],
  [WorkOrderStatus.ON_HOLD]: ['edit', 'resume', 'cancel'],
  [WorkOrderStatus.AWAITING_PARTS]: ['edit', 'resume', 'cancel'],
  [WorkOrderStatus.AWAITING_VENDOR]: ['edit', 'resume', 'cancel'],
  [WorkOrderStatus.COMPLETED]: ['verify'],
  [WorkOrderStatus.VERIFIED]: [],
  [WorkOrderStatus.CANCELED]: [],
};

export function workOrderActionsFor(status: string): WorkOrderAction[] {
  return WORK_ORDER_ACTIONS[status] ?? [];
}

/**
 * Actions the assigned technician may fire without the manage permission
 * (status-transitions §5: "technician or manager"). Callers OR this with the
 * permission check when the session user is the WO's assignee.
 */
export const TECHNICIAN_WORK_ORDER_ACTIONS: ReadonlySet<WorkOrderAction> = new Set([
  'start',
  'hold',
  'resume',
  'complete',
]);

/** Permission "any of" list per WO action (contract §6.2 bindings). */
export function workOrderActionPermissions(action: WorkOrderAction): string[] {
  switch (action) {
    case 'edit':
      return [PERMISSIONS.maintenanceWorkOrder.update, PERMISSIONS.maintenanceWorkOrder.manage];
    case 'schedule':
      return [PERMISSIONS.maintenanceWorkOrder.manage];
    case 'assign':
      return [PERMISSIONS.maintenanceWorkOrder.assign, PERMISSIONS.maintenanceWorkOrder.manage];
    case 'start':
    case 'hold':
    case 'resume':
      return [PERMISSIONS.maintenanceWorkOrder.manage];
    case 'complete':
      return [PERMISSIONS.maintenanceWorkOrder.complete, PERMISSIONS.maintenanceWorkOrder.manage];
    case 'verify':
      return [PERMISSIONS.maintenanceWorkOrder.verify];
    case 'cancel':
      return [PERMISSIONS.maintenanceWorkOrder.cancel, PERMISSIONS.maintenanceWorkOrder.manage];
  }
}

/**
 * Ordered steps for the WO status stepper (waiting states pin to In Progress).
 * Draft is omitted — API-created WOs land directly on Open.
 */
export const WORK_ORDER_STEPS: Array<{ status: string; label: string }> = [
  { status: WorkOrderStatus.OPEN, label: 'Open' },
  { status: WorkOrderStatus.ASSIGNED, label: 'Assigned' },
  { status: WorkOrderStatus.SCHEDULED, label: 'Scheduled' },
  { status: WorkOrderStatus.IN_PROGRESS, label: 'In progress' },
  { status: WorkOrderStatus.COMPLETED, label: 'Completed' },
  { status: WorkOrderStatus.VERIFIED, label: 'Verified' },
];

/** Contract §6.2 hold-reason strings and the status each one produces. */
export const WORK_ORDER_HOLD_REASONS: Array<{
  reason: 'On Hold' | 'Awaiting Parts' | 'Awaiting Vendor';
  status: string;
  label: string;
  hint: string;
}> = [
  {
    reason: 'On Hold',
    status: WorkOrderStatus.ON_HOLD,
    label: 'On hold',
    hint: 'Work paused for another reason (access, safety, prioritization).',
  },
  {
    reason: 'Awaiting Parts',
    status: WorkOrderStatus.AWAITING_PARTS,
    label: 'Awaiting parts',
    hint: 'Waiting for spare parts — draft the parts issue before or after holding.',
  },
  {
    reason: 'Awaiting Vendor',
    status: WorkOrderStatus.AWAITING_VENDOR,
    label: 'Awaiting vendor',
    hint: 'External vendor engaged; waiting on their service.',
  },
];

/**
 * Legal completion outcomes (spec §18): the asset's next lifecycle status must
 * be chosen explicitly. Assigned is only valid while the pre-maintenance
 * assignment is still active; Retired routes through retirement approval.
 */
export const WORK_ORDER_COMPLETION_OUTCOMES: Array<{
  value: string;
  label: string;
  hint: string;
}> = [
  {
    value: AssetStatus.AVAILABLE,
    label: 'Available',
    hint: 'Asset returns to stock, ready for use or assignment.',
  },
  {
    value: AssetStatus.ASSIGNED,
    label: 'Assigned (back to custodian)',
    hint: 'Only valid when the pre-maintenance assignment is still active.',
  },
  {
    value: AssetStatus.DAMAGED,
    label: 'Damaged',
    hint: 'Repair unsuccessful — asset stays out of service as damaged.',
  },
  {
    value: AssetStatus.RETIRED,
    label: 'Retired',
    hint: 'Beyond economic repair — routes through the retirement approval.',
  },
];

/* ============== Phase 6 — Counts, approvals, notifications (§7) ============ */

/* ----------------------- Count sessions (contract §7.1) -------------------- */

export const COUNT_SESSION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  IN_PROGRESS: 'Counting',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
  CANCELED: 'Canceled',
};

export function countSessionStatusLabel(status: string): string {
  return COUNT_SESSION_STATUS_LABELS[status] ?? status;
}

/** Ordered steps for the count-session stepper (Canceled excluded). */
export const COUNT_SESSION_STEPS: Array<{ status: string; label: string }> = [
  { status: 'DRAFT', label: 'Draft' },
  { status: 'IN_PROGRESS', label: 'Counting' },
  { status: 'REVIEW', label: 'Review' },
  { status: 'COMPLETED', label: 'Completed' },
];

export type CountSessionAction =
  | 'edit'
  | 'start'
  | 'record'
  | 'recount'
  | 'complete'
  | 'create-adjustments'
  | 'cancel';

/**
 * Legal actions per count-session status — mirrors apps/api counts/count-rules
 * TRANSITIONS: start → In progress (snapshot), complete → Review (locks lines,
 * unmasks blind counts), create-adjustments → Completed; a Review recount
 * reopens the session to In progress.
 */
const COUNT_SESSION_ACTIONS: Record<string, CountSessionAction[]> = {
  DRAFT: ['edit', 'start', 'cancel'],
  IN_PROGRESS: ['record', 'recount', 'complete', 'cancel'],
  REVIEW: ['recount', 'create-adjustments', 'cancel'],
  COMPLETED: [],
  CANCELED: [],
};

export function countSessionActionsFor(status: string): CountSessionAction[] {
  return COUNT_SESSION_ACTIONS[status] ?? [];
}

/** Permission "any of" list per count-session action (contract §7.1 bindings). */
export function countSessionActionPermissions(action: CountSessionAction): string[] {
  switch (action) {
    case 'edit':
    case 'start':
      return [PERMISSIONS.count.create];
    case 'record':
      return [PERMISSIONS.count.record];
    case 'recount':
      return [PERMISSIONS.count.record, PERMISSIONS.count.recount];
    case 'complete':
    case 'create-adjustments':
      return [PERMISSIONS.count.approve];
    case 'cancel':
      return [PERMISSIONS.count.cancel];
  }
}

export const COUNT_LINE_FLAG_LABELS: Record<string, string> = {
  MATCHED: 'Matched',
  VARIANCE: 'Variance',
  MISSING: 'Missing',
  UNEXPECTED: 'Unexpected',
  DUPLICATE: 'Duplicate',
  MISPLACED: 'Misplaced',
};

export function countLineFlagLabel(flag: string): string {
  return COUNT_LINE_FLAG_LABELS[flag] ?? flag;
}

/* --------------------- Approvals framework (contract §7.2) ----------------- */

export const APPROVAL_REQUEST_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RETURNED: 'Returned for revision',
  CANCELED: 'Canceled',
};

export function approvalRequestStatusLabel(status: string): string {
  return APPROVAL_REQUEST_STATUS_LABELS[status] ?? status;
}

/** Act on assigned requests — assignment itself is checked server-side. */
export const APPROVAL_ACT_PERMISSIONS = [PERMISSIONS.approval.act];

/** See the full queue beyond own/assigned requests. */
export const APPROVAL_VIEW_ALL_PERMISSIONS = [
  PERMISSIONS.approval.view,
  PERMISSIONS.approval.manage,
];

/**
 * The four approver-resolution types (GemCor requirement): role, position,
 * requester's department head (resolved at request time), or a named user.
 */
export const APPROVAL_APPROVER_TYPES: Array<{
  value: 'ROLE' | 'POSITION' | 'DEPT_HEAD' | 'USER';
  label: string;
  hint: string;
}> = [
  {
    value: 'ROLE',
    label: 'Role',
    hint: 'Any active user holding the selected role in the document branch can act.',
  },
  {
    value: 'POSITION',
    label: 'Position',
    hint: 'Any employee holding the selected position (with a user account) can act.',
  },
  {
    value: 'DEPT_HEAD',
    label: 'Department head',
    hint: "No selection needed — resolved at request time from the requester's department.",
  },
  {
    value: 'USER',
    label: 'Specific user',
    hint: 'Exactly the selected user (or their active delegate) can act.',
  },
];

/**
 * Document types the Phase 6 engine routes — canonical resource_type values
 * mirroring apps/api approvals/approval-rules.ts APPROVAL_RESOURCE_TYPES.
 */
export const APPROVAL_DOCUMENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'PURCHASE_ORDER', label: 'Purchase order' },
  { value: 'STOCK_TRANSACTION', label: 'Stock transaction (adjustment / disposal / write-off)' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'SUPPLIER_RETURN', label: 'Supplier return' },
];

/**
 * Sub-type choices per document type (workflow `documentSubtypes` scope).
 * Empty selection = every sub-type of the document.
 */
export const APPROVAL_DOCUMENT_SUBTYPES: Record<string, Array<{ value: string; label: string }>> = {
  STOCK_TRANSACTION: CREATABLE_TRANSACTION_TYPES.map((type) => ({
    value: type,
    label: STOCK_TRANSACTION_TYPE_LABELS[type] ?? type,
  })),
  TRANSFER: [
    { value: 'LOCATION', label: 'Location transfer' },
    { value: 'INTRA_BRANCH', label: 'Intra-branch transfer' },
    { value: 'INTER_BRANCH', label: 'Inter-branch transfer' },
  ],
};

export function approvalDocumentTypeLabel(value: string): string {
  const known = APPROVAL_DOCUMENT_TYPES.find((entry) => entry.value === value);
  if (known) return known.label;
  const spaced = value.replace(/[_.-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase() : value;
}
