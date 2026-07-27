/**
 * Web-side view of the Phase 1 API resources (docs/api-outline.md §2).
 * Contract types shared across packages (SessionUser, Paginated, ApiError)
 * come from @gemerp/shared; the shapes below cover the resource payloads.
 */
import type { SessionUser } from '@gemerp/shared';

/** GET /auth/me — SessionUser plus the forced-password-change flag. */
export type Me = SessionUser & { mustChangePassword?: boolean };

/** One of the caller's own sessions (GET /auth/sessions). */
export interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ip?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** True for the session making the request. */
  current: boolean;
}

export interface RoleSummary {
  id: string;
  code: string;
  name: string;
  isSystem?: boolean;
}

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
}

/** Users as returned by /users list + detail (roles and branch access included). */
export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: string | null;
  lastActivityAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  roles?: RoleSummary[];
  branches?: BranchSummary[];
  branchIds?: string[];
}

/** Branch access of a user regardless of which field the API populated. */
export function userBranchIds(user: UserRecord): string[] {
  if (user.branchIds) return user.branchIds;
  if (user.branches) return user.branches.map((branch) => branch.id);
  return [];
}

export interface Role {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isSystem: boolean;
  isActive?: boolean;
  /** List endpoints return a count; detail returns the full permission list. */
  permissionCount?: number;
  permissions?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** GET /permissions — catalog grouped by resource. */
export interface PermissionCatalogEntry {
  key: string;
  description?: string | null;
}

export interface PermissionCatalogGroup {
  resource: string;
  permissions: PermissionCatalogEntry[];
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  city?: string | null;
  region?: string | null;
  phone?: string | null;
  timezone?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Warehouse {
  id: string;
  branchId: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface StorageLocation {
  id: string;
  warehouseId: string;
  parentId?: string | null;
  code: string;
  name: string;
  /** API contract field; `locationType` mirrors the persistence name. */
  kind?: string | null;
  locationType?: string | null;
  barcode?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function storageLocationKind(location: StorageLocation): string | null {
  return location.kind ?? location.locationType ?? null;
}

/** GET /audit-logs entries. */
export interface AuditLogEntry {
  id: string;
  actorUserId?: string | null;
  actorDisplayName?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  branchId?: string | null;
  timestamp?: string;
  occurredAt?: string;
  ip?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
  reason?: string | null;
}

export function auditTimestamp(entry: AuditLogEntry): string | undefined {
  return entry.timestamp ?? entry.occurredAt;
}

export function auditIp(entry: AuditLogEntry): string | null | undefined {
  return entry.ip ?? entry.ipAddress;
}

export function auditCorrelationId(entry: AuditLogEntry): string | null | undefined {
  return entry.correlationId ?? entry.requestId;
}
