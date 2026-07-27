/**
 * Shared API contract types and cross-package constants for GEM ERP.
 *
 * The status/enum consts in this file mirror the Prisma enums in
 * packages/database (identical names and identical string values) so that the
 * web app can reference document statuses without importing the Prisma client.
 */

/** One entry in an error's `details` array (per-field for validation errors). */
export interface ApiErrorDetail {
  /** Dot-path of the offending field, when applicable (e.g. "email"). */
  field?: string;
  /** Human-friendly explanation of this detail. */
  message: string;
  /** Optional machine-readable sub-code for this detail. */
  code?: string;
}

/**
 * Canonical error envelope returned by ALL API errors:
 * `{ "error": { "code": "MACHINE_CODE", "message": "...", "details?": [...] } }`.
 * Validation failures use code "VALIDATION_ERROR" with per-field details.
 */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
}

/** Pagination metadata returned by all paginated list endpoints. */
export interface PaginationMeta {
  /** 1-based page number. */
  page: number;
  /** Items per page (default 25, max 100). */
  pageSize: number;
  /** Total matching items across all pages. */
  total: number;
  /** Total number of pages. */
  totalPages: number;
}

/** Canonical paginated list response: `{ data: [...], meta: {...} }`. */
export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

/** The authenticated user as returned by GET /api/v1/auth/me. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  isSuperAdmin: boolean;
  /** System/custom role codes assigned to the user (e.g. "BRANCH_ADMIN"). */
  roles: string[];
  /** Effective flattened permission strings (e.g. "asset.view"). */
  permissions: string[];
  /** IDs of branches the user may access. */
  branchIds: string[];
}

/** Session cookie name used by the API and web app. */
export const SESSION_COOKIE_NAME = 'gemerp_session';

/** Default page size for paginated list endpoints. */
export const DEFAULT_PAGE_SIZE = 25;

/** Maximum accepted page size for paginated list endpoints. */
export const MAX_PAGE_SIZE = 100;

/** Organization display timezone (storage is always UTC). */
export const ORG_TIMEZONE = 'Asia/Manila';

/** Default currency code. */
export const DEFAULT_CURRENCY = 'PHP';

/* -------------------------------------------------------------------------- */
/* Enums-as-const mirroring the Prisma enums (names and values identical).    */
/* -------------------------------------------------------------------------- */

/** Business category of a catalog item (Prisma enum `ItemBusinessCategory`). */
export const ItemBusinessCategory = {
  SERIALIZED_ASSET: 'SERIALIZED_ASSET',
  CONSUMABLE: 'CONSUMABLE',
  BULK_NON_CONSUMABLE: 'BULK_NON_CONSUMABLE',
} as const;
export type ItemBusinessCategory =
  (typeof ItemBusinessCategory)[keyof typeof ItemBusinessCategory];

/** How stock of an item is tracked (Prisma enum `TrackingMethod`). */
export const TrackingMethod = {
  SERIAL: 'SERIAL',
  QUANTITY: 'QUANTITY',
  LOT: 'LOT',
} as const;
export type TrackingMethod =
  (typeof TrackingMethod)[keyof typeof TrackingMethod];

/** Lifecycle status of a serialized asset instance (Prisma enum `AssetStatus`). */
export const AssetStatus = {
  DRAFT: 'DRAFT',
  AVAILABLE: 'AVAILABLE',
  RESERVED: 'RESERVED',
  ASSIGNED: 'ASSIGNED',
  IN_TRANSFER: 'IN_TRANSFER',
  UNDER_INSPECTION: 'UNDER_INSPECTION',
  UNDER_MAINTENANCE: 'UNDER_MAINTENANCE',
  DAMAGED: 'DAMAGED',
  LOST: 'LOST',
  RETIRED: 'RETIRED',
  DISPOSED: 'DISPOSED',
} as const;
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

/** Employment status of an employee record (Prisma enum `EmployeeStatus`). */
export const EmployeeStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
  SEPARATED: 'SEPARATED',
} as const;
export type EmployeeStatus =
  (typeof EmployeeStatus)[keyof typeof EmployeeStatus];

/** Type of a stock transaction (Prisma enum `StockTransactionType`). */
export const StockTransactionType = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  PURCHASE_RECEIPT: 'PURCHASE_RECEIPT',
  NON_PURCHASE_RECEIPT: 'NON_PURCHASE_RECEIPT',
  ISSUE_TO_EMPLOYEE: 'ISSUE_TO_EMPLOYEE',
  ISSUE_TO_DEPARTMENT: 'ISSUE_TO_DEPARTMENT',
  RETURN_FROM_EMPLOYEE: 'RETURN_FROM_EMPLOYEE',
  RETURN_TO_SUPPLIER: 'RETURN_TO_SUPPLIER',
  LOCATION_TRANSFER: 'LOCATION_TRANSFER',
  INTER_BRANCH_TRANSFER: 'INTER_BRANCH_TRANSFER',
  ADJUSTMENT_INCREASE: 'ADJUSTMENT_INCREASE',
  ADJUSTMENT_DECREASE: 'ADJUSTMENT_DECREASE',
  MAINTENANCE_ISSUE: 'MAINTENANCE_ISSUE',
  DISPOSAL: 'DISPOSAL',
  REVERSAL: 'REVERSAL',
} as const;
export type StockTransactionType =
  (typeof StockTransactionType)[keyof typeof StockTransactionType];

/**
 * Status of a stock transaction document (Prisma enum
 * `StockTransactionStatus`). Only POSTED transactions affect stock.
 */
export const StockTransactionStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  POSTED: 'POSTED',
  CANCELED: 'CANCELED',
  REVERSED: 'REVERSED',
} as const;
export type StockTransactionStatus =
  (typeof StockTransactionStatus)[keyof typeof StockTransactionStatus];

/** Status of a purchase order (Prisma enum `PurchaseOrderStatus`). */
export const PurchaseOrderStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
  FULLY_RECEIVED: 'FULLY_RECEIVED',
  CANCELED: 'CANCELED',
  CLOSED: 'CLOSED',
} as const;
export type PurchaseOrderStatus =
  (typeof PurchaseOrderStatus)[keyof typeof PurchaseOrderStatus];

/** Status of a controlled transfer document (Prisma enum `TransferStatus`). */
export const TransferStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  IN_TRANSIT: 'IN_TRANSIT',
  RECEIVED: 'RECEIVED',
  CANCELED: 'CANCELED',
} as const;
export type TransferStatus =
  (typeof TransferStatus)[keyof typeof TransferStatus];

/** Status of a maintenance work order (Prisma enum `WorkOrderStatus`). */
export const WorkOrderStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  ASSIGNED: 'ASSIGNED',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  ON_HOLD: 'ON_HOLD',
  AWAITING_PARTS: 'AWAITING_PARTS',
  AWAITING_VENDOR: 'AWAITING_VENDOR',
  COMPLETED: 'COMPLETED',
  VERIFIED: 'VERIFIED',
  CANCELED: 'CANCELED',
} as const;
export type WorkOrderStatus =
  (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

/** Status of an approval request (Prisma enum `ApprovalRequestStatus`). */
export const ApprovalRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  RETURNED: 'RETURNED',
  CANCELED: 'CANCELED',
} as const;
export type ApprovalRequestStatus =
  (typeof ApprovalRequestStatus)[keyof typeof ApprovalRequestStatus];
