/**
 * GEM ERP in-app notification catalog (master spec section 20).
 *
 * Shared between apps/api (NotificationsService, approval engine) and
 * apps/worker (scheduled detectors) so both processes agree on type codes,
 * dedupe-key construction, and deep-link paths. Delivery channels beyond
 * in-app are ON HOLD per GemCor (2026-07-27) — the type catalog is
 * channel-agnostic so email/SMS fan-out can be added without new codes.
 */

/** Machine notification type codes (spec section 20 alert list). */
export const NOTIFICATION_TYPES = {
  lowStock: 'LOW_STOCK',
  outOfStock: 'OUT_OF_STOCK',
  approvalPending: 'APPROVAL_PENDING',
  approvalApproved: 'APPROVAL_APPROVED',
  approvalRejected: 'APPROVAL_REJECTED',
  approvalReturned: 'APPROVAL_RETURNED',
  maintenanceDue: 'MAINTENANCE_DUE',
  maintenanceOverdue: 'MAINTENANCE_OVERDUE',
  warrantyExpiring: 'WARRANTY_EXPIRING',
  lotExpiring: 'LOT_EXPIRING',
  assetReturnOverdue: 'ASSET_RETURN_OVERDUE',
  transferUnreceived: 'TRANSFER_UNRECEIVED',
  separationOutstandingAssets: 'SEPARATION_OUTSTANDING_ASSETS',
  jobFailed: 'JOB_FAILED',
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/** Every notification type code, in catalog order. */
export const ALL_NOTIFICATION_TYPES: string[] = Object.values(
  NOTIFICATION_TYPES,
);

/**
 * Canonical dedupe key: `type|resourceType|resourceId[|discriminator]`.
 * Combined with the DB unique constraint on (recipient, dedupe_key) this
 * enforces the Phase 6 rule: never a duplicate unread notification for the
 * same type + resource + recipient. The optional discriminator scopes the
 * key further (e.g. an approval step sequence) when one resource may
 * legitimately alert the same recipient more than once.
 */
export function notificationDedupeKey(
  type: string,
  resourceType: string,
  resourceId: string,
  discriminator?: string,
): string {
  const base = `${type}|${resourceType}|${resourceId}`;
  return discriminator ? `${base}|${discriminator}` : base;
}

/**
 * Deep-link paths matching the apps/web routes. Keep in sync with the
 * (dashboard) route tree — notifications navigate with these verbatim.
 */
export const NOTIFICATION_LINKS = {
  approvalRequest: (id: string) => `/approvals/${id}`,
  purchaseOrder: (id: string) => `/procurement/purchase-orders/${id}`,
  workOrder: (id: string) => `/maintenance/work-orders/${id}`,
  maintenancePlans: () => `/maintenance/plans`,
  stockTransaction: (id: string) => `/inventory/transactions/${id}`,
  transfer: (id: string) => `/inventory/transfers/${id}`,
  countSession: (id: string) => `/counts/${id}`,
  asset: (id: string) => `/assets/${id}`,
  item: (id: string) => `/items/${id}`,
  lots: () => `/inventory/lots`,
  lowStock: () => `/inventory/low-stock`,
  employees: () => `/employees`,
} as const;
