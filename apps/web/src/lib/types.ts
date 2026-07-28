/**
 * Web-side view of the Phase 1 + Phase 2 API resources (docs/api-outline.md
 * §2–3). Contract types shared across packages (SessionUser, Paginated,
 * ApiError) come from @gemerp/shared; the shapes below cover the resource
 * payloads.
 */
import type {
  EmployeeStatus,
  ItemBusinessCategory,
  SessionUser,
  TrackingMethod,
} from '@gemerp/shared';

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

/* ========================================================================== */
/* Phase 2 — Employees, lookups, and catalog (docs/api-outline.md §3)         */
/* ========================================================================== */

/* ------------------------------- Employees ------------------------------- */

export interface EmployeeSummary {
  id: string;
  employeeNumber?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string | null;
}

export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  middleName?: string | null;
  lastName: string;
  /** Preferred/display name. */
  displayName?: string | null;
  workEmail?: string | null;
  workPhone?: string | null;
  branchId: string;
  branch?: BranchSummary | null;
  departmentId?: string | null;
  department?: { id: string; code?: string; name: string } | null;
  positionId?: string | null;
  position?: { id: string; code?: string; name: string } | null;
  supervisorId?: string | null;
  supervisor?: EmployeeSummary | null;
  status: EmployeeStatus;
  startDate?: string | null;
  separationDate?: string | null;
  photoUrl?: string | null;
  /** Restricted-visibility notes (present only when the caller may see them). */
  notes?: string | null;
  userId?: string | null;
  user?: { id: string; email?: string; displayName?: string } | null;
  archivedAt?: string | null;
  /** Optimistic-concurrency version; must be echoed on PATCH. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Best display name for an employee ("preferred" first, then legal name). */
export function employeeName(
  employee: Pick<Employee, 'firstName' | 'lastName' | 'displayName'> | EmployeeSummary,
): string {
  if (employee.displayName) return employee.displayName;
  return [employee.firstName, employee.lastName].filter(Boolean).join(' ') || '—';
}

/** Asset summary rows returned by separation / custody endpoints. */
export interface OutstandingAsset {
  id: string;
  assetTag?: string | null;
  tag?: string | null;
  serialNumber?: string | null;
  name?: string | null;
  itemName?: string | null;
  item?: { id: string; sku?: string; name?: string } | null;
  status?: string | null;
  assignedAt?: string | null;
}

export function outstandingAssetLabel(asset: OutstandingAsset): string {
  return (
    asset.assetTag ??
    asset.tag ??
    asset.serialNumber ??
    asset.name ??
    asset.itemName ??
    asset.item?.name ??
    asset.id
  );
}

/** POST /employees/:id/separate response (employee + outstanding custody). */
export interface EmployeeSeparationResult {
  employee?: Employee;
  outstandingAssets?: OutstandingAsset[];
  /** Alternate field name tolerated defensively. */
  outstanding?: OutstandingAsset[];
}

export function separationOutstandingAssets(result: EmployeeSeparationResult): OutstandingAsset[] {
  return result.outstandingAssets ?? result.outstanding ?? [];
}

/* -------------------- Departments, positions, lookups -------------------- */

export interface Department {
  id: string;
  code: string;
  name: string;
  branchId?: string | null;
  headEmployeeId?: string | null;
  headEmployee?: EmployeeSummary | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Position {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Generic /lookups/:type value row. */
export interface LookupValue {
  id: string;
  category?: string;
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
  isActive: boolean;
  isSystem?: boolean;
  branchId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/* --------------------------- UOMs & conversions -------------------------- */

export interface Uom {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface UomConversion {
  id: string;
  fromUomId: string;
  toUomId: string;
  fromUom?: Uom | null;
  toUom?: Uom | null;
  /** Decimal serialized as a string (e.g. "10.0000"). */
  factor: string | number;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** "10.0000" -> "10", 2.5 -> "2.5" for display. */
export function formatFactor(factor: string | number): string {
  const value = typeof factor === 'string' ? Number(factor) : factor;
  if (!Number.isFinite(value)) return String(factor);
  return String(value);
}

/* ------------------ Brands, manufacturers, categories -------------------- */

export interface Brand {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type Manufacturer = Brand;

export interface ItemCategory {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ItemSubcategory extends ItemCategory {
  categoryId: string;
}

/* ------------------------------ Item master ------------------------------ */

export interface ItemUomConversion {
  id?: string;
  fromUomId: string;
  toUomId: string;
  fromUom?: Uom | null;
  toUom?: Uom | null;
  factor: string | number;
}

export interface ItemBarcode {
  id: string;
  itemId?: string;
  barcode: string;
  barcodeType?: string | null;
  uomId?: string | null;
  uom?: Uom | null;
  isPrimary: boolean;
  /** Unique-while-active flag: true = live; null/false = archived. */
  active?: boolean | null;
  isActive?: boolean | null;
  deactivatedAt?: string | null;
  createdAt?: string;
}

export function barcodeIsActive(barcode: ItemBarcode): boolean {
  return (barcode.active ?? barcode.isActive ?? true) === true;
}

export interface ItemWarehouseSetting {
  id?: string;
  itemId?: string;
  warehouseId: string;
  warehouse?: (Warehouse & { branch?: BranchSummary | null }) | null;
  reorderLevel?: string | number | null;
  reorderQuantity?: string | number | null;
  minQuantity?: string | number | null;
  maxQuantity?: string | number | null;
  updatedAt?: string;
}

export interface Item {
  id: string;
  sku: string;
  name: string;
  description?: string | null;
  businessCategory: ItemBusinessCategory;
  trackingMethod: TrackingMethod;
  categoryId?: string | null;
  category?: ItemCategory | null;
  subcategoryId?: string | null;
  subcategory?: ItemSubcategory | null;
  brandId?: string | null;
  brand?: Brand | null;
  manufacturerId?: string | null;
  manufacturer?: Manufacturer | null;
  model?: string | null;
  baseUomId: string;
  baseUom?: Uom | null;
  purchaseUomId?: string | null;
  purchaseUom?: Uom | null;
  issueUomId?: string | null;
  issueUom?: Uom | null;
  defaultSupplierId?: string | null;
  /** Money as decimal strings; present only with item.view_cost. */
  standardCost?: string | null;
  lastPurchaseCost?: string | null;
  isLotTracked: boolean;
  isExpiryTracked: boolean;
  requiresSerialNumber: boolean;
  isMaintainable: boolean;
  imageUrl?: string | null;
  notes?: string | null;
  isActive: boolean;
  uomConversions?: ItemUomConversion[];
  barcodes?: ItemBarcode[];
  warehouseSettings?: ItemWarehouseSetting[];
  archivedAt?: string | null;
  /** Optimistic-concurrency version; must be echoed on PATCH. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** GET /items/resolve-barcode?code= result (kind varies: item, lot, bin…). */
export interface ResolvedBarcode {
  kind?: string;
  type?: string;
  id?: string;
  itemId?: string;
  item?: { id: string; sku?: string; name?: string } | null;
  sku?: string;
  name?: string;
  summary?: string;
}

/** Item id a resolved barcode points at, when it points at an item at all. */
export function resolvedItemId(resolved: ResolvedBarcode): string | null {
  if (resolved.item?.id) return resolved.item.id;
  const kind = (resolved.kind ?? resolved.type ?? '').toLowerCase();
  if (kind === 'item' && resolved.id) return resolved.id;
  if (resolved.itemId) return resolved.itemId;
  return null;
}

/* -------------------------------- Imports -------------------------------- */

export interface ImportRowIssue {
  row?: number | null;
  field?: string | null;
  message: string;
}

export interface ImportValidationSummaryCounts {
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
  warningCount?: number;
}

/** POST /imports/:type/validate response. */
export interface ImportValidationResult {
  stagingId: string;
  type?: string;
  summary?: ImportValidationSummaryCounts;
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
  errors?: ImportRowIssue[];
  warnings?: ImportRowIssue[];
  /** Parsed valid rows for preview (column set depends on the import type). */
  preview?: Array<Record<string, unknown>>;
}

export function importCounts(result: ImportValidationResult): {
  total: number;
  valid: number;
  invalid: number;
  warnings: number;
} {
  const errors = result.errors ?? [];
  const total = result.summary?.totalRows ?? result.totalRows ?? 0;
  const invalid =
    result.summary?.invalidRows ??
    result.invalidRows ??
    new Set(errors.map((issue) => issue.row)).size;
  const valid = result.summary?.validRows ?? result.validRows ?? Math.max(total - invalid, 0);
  const warnings = result.summary?.warningCount ?? (result.warnings ?? []).length;
  return { total, valid, invalid, warnings };
}

/** POST /imports/:type/commit response. */
export interface ImportCommitResult {
  id?: string;
  importId?: string;
  status?: string;
  mode?: string;
  summary?: {
    created?: number;
    updated?: number;
    skipped?: number;
    failed?: number;
    total?: number;
  };
  created?: number;
  updated?: number;
  skipped?: number;
  failed?: number;
  resultFileUrl?: string | null;
}

export function commitCounts(result: ImportCommitResult): Array<{ label: string; value: number }> {
  const source = {
    Created: result.summary?.created ?? result.created,
    Updated: result.summary?.updated ?? result.updated,
    Skipped: result.summary?.skipped ?? result.skipped,
    Failed: result.summary?.failed ?? result.failed,
  };
  return Object.entries(source)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([label, value]) => ({ label, value }));
}
