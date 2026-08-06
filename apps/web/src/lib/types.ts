/**
 * Web-side view of the Phase 1 + Phase 2 API resources (docs/api-outline.md
 * §2–3). Contract types shared across packages (SessionUser, Paginated,
 * ApiError) come from @gemerp/shared; the shapes below cover the resource
 * payloads.
 */
import type {
  AssetStatus,
  EmployeeStatus,
  ItemBusinessCategory,
  PurchaseOrderStatus,
  SessionUser,
  StockTransactionStatus,
  StockTransactionType,
  TrackingMethod,
  TransferStatus,
} from '@gemerp/shared';

/**
 * GET /auth/me — SessionUser plus the forced-password-change flag. The
 * optional employee link (when the account is tied to an employee record)
 * powers self-service views such as "my pending acknowledgments".
 */
export type Me = SessionUser & {
  mustChangePassword?: boolean;
  employeeId?: string | null;
  employee?: { id: string } | null;
};

/** Employee id linked to the session user, when the API exposes one. */
export function meEmployeeId(me: Me): string | null {
  return me.employeeId ?? me.employee?.id ?? null;
}

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

/* ========================================================================== */
/* Phase 3 — Inventory, stock ledger, serialized assets (api-outline §4)      */
/* ========================================================================== */

/** Decimal quantities/costs are serialized as strings; tolerate numbers. */
export type DecimalString = string | number;

/** "12.0000" -> "12", "2.5000" -> "2.5" for display; null-safe. */
export function formatQuantity(value: DecimalString | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(parsed)) return String(value);
  return String(parsed);
}

/** Numeric value of a decimal string (NaN-safe, defaults to 0). */
export function decimalValue(value: DecimalString | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(parsed) ? parsed : 0;
}

const phpFormatter = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
});

/** "1250.00" -> "₱1,250.00"; null-safe (cost fields are permission-gated). */
export function formatMoney(value: DecimalString | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(parsed)) return String(value);
  return phpFormatter.format(parsed);
}

/** Compact reference embeds (server may hydrate relations differently). */
export interface ItemRef {
  id: string;
  sku?: string;
  name?: string;
  trackingMethod?: TrackingMethod | string;
  baseUomId?: string;
  baseUom?: Uom | null;
  isExpiryTracked?: boolean;
}

export interface WarehouseRef {
  id: string;
  code?: string;
  name?: string;
  branchId?: string;
}

export interface LocationRef {
  id: string;
  code?: string;
  name?: string;
  barcode?: string | null;
}

export interface UserRef {
  id: string;
  displayName?: string;
  email?: string;
}

export function refLabel(
  ref: { code?: string; name?: string; id: string } | null | undefined,
  fallback = '—',
): string {
  if (!ref) return fallback;
  return ref.name ?? ref.code ?? fallback;
}

export function itemRefLabel(item: ItemRef | null | undefined): string {
  if (!item) return '—';
  if (item.name && item.sku) return `${item.name} (${item.sku})`;
  return item.name ?? item.sku ?? item.id;
}

/* ------------------------- Lots (contract §4.2) --------------------------- */

export interface Lot {
  id: string;
  lotNumber?: string;
  number?: string;
  code?: string;
  itemId?: string;
  item?: ItemRef | null;
  warehouseId?: string;
  warehouse?: WarehouseRef | null;
  manufactureDate?: string | null;
  manufacturingDate?: string | null;
  expiryDate?: string | null;
  expirationDate?: string | null;
  status?: string | null;
  onHand?: DecimalString | null;
  quantityOnHand?: DecimalString | null;
  available?: DecimalString | null;
  availableQuantity?: DecimalString | null;
  createdAt?: string;
}

export function lotNumber(lot: Lot): string {
  return lot.lotNumber ?? lot.number ?? lot.code ?? lot.id;
}

export function lotExpiry(lot: Lot): string | null {
  return lot.expiryDate ?? lot.expirationDate ?? null;
}

export function lotOnHand(lot: Lot): DecimalString | null {
  return lot.onHand ?? lot.quantityOnHand ?? null;
}

export function lotAvailable(lot: Lot): DecimalString | null {
  return lot.available ?? lot.availableQuantity ?? null;
}

/** Days until an ISO date (negative = past). Null when the date is absent. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const target = new Date(date).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - Date.now()) / 86_400_000);
}

/* ----------------- Stock transactions (contract §4.1) --------------------- */

export interface StockTransactionLine {
  id?: string;
  lineNumber?: number;
  itemId: string;
  item?: ItemRef | null;
  uomId?: string;
  uom?: Uom | null;
  /** Entered quantity in the entered UOM. */
  quantity: DecimalString;
  enteredQuantity?: DecimalString;
  /** Normalized base-unit quantity. */
  baseQuantity?: DecimalString | null;
  baseUomId?: string;
  baseUom?: Uom | null;
  lotId?: string | null;
  lot?: Lot | null;
  locationId?: string | null;
  location?: LocationRef | null;
  /** Cost fields present only with inventory.view_cost. */
  unitCost?: DecimalString | null;
  totalCost?: DecimalString | null;
  notes?: string | null;
}

export interface ApprovalTrailEntry {
  id?: string;
  step?: number | null;
  action?: string;
  status?: string;
  decision?: string;
  actorUserId?: string | null;
  actor?: UserRef | null;
  actorDisplayName?: string | null;
  comment?: string | null;
  decidedAt?: string | null;
  createdAt?: string | null;
}

export interface StockLedgerEntry {
  id: string;
  transactionId?: string | null;
  transactionNumber?: string | null;
  transactionType?: StockTransactionType | string | null;
  type?: string | null;
  /** The list endpoint nests the source document here. */
  transaction?: {
    id: string;
    transactionNumber?: string | null;
    type?: StockTransactionType | string | null;
  } | null;
  /** Detail-endpoint entries reference their document line. */
  transactionLineId?: string | null;
  itemId?: string;
  item?: ItemRef | null;
  warehouseId?: string;
  warehouse?: WarehouseRef | null;
  locationId?: string | null;
  location?: LocationRef | null;
  lotId?: string | null;
  lot?: Lot | null;
  /** Signed base-unit quantity (+ in, − out) — the API serializes this as `quantityDelta`. */
  quantityDelta?: DecimalString;
  quantity?: DecimalString;
  baseQuantity?: DecimalString;
  uomId?: string;
  uom?: Uom | null;
  unitCost?: DecimalString | null;
  balanceAfter?: DecimalString | null;
  occurredAt?: string;
  postedAt?: string;
  createdAt?: string;
}

export function ledgerTimestamp(entry: StockLedgerEntry): string | undefined {
  return entry.occurredAt ?? entry.postedAt ?? entry.createdAt;
}

export function ledgerQuantity(entry: StockLedgerEntry): number {
  return decimalValue(entry.quantityDelta ?? entry.baseQuantity ?? entry.quantity);
}

export interface StockTransaction {
  id: string;
  number?: string;
  transactionNumber?: string;
  type: StockTransactionType | string;
  status: StockTransactionStatus | string;
  branchId?: string;
  branch?: BranchSummary | null;
  warehouseId?: string;
  warehouse?: WarehouseRef | null;
  transactionDate?: string | null;
  postedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  canceledAt?: string | null;
  reversedAt?: string | null;
  rejectedAt?: string | null;
  reasonCode?: string | null;
  reason?: string | { id: string; code?: string; name?: string } | null;
  employeeId?: string | null;
  employee?: EmployeeSummary | null;
  departmentId?: string | null;
  department?: { id: string; code?: string; name?: string } | null;
  workOrderId?: string | null;
  notes?: string | null;
  lines?: StockTransactionLine[];
  ledgerEntries?: StockLedgerEntry[];
  approvals?: ApprovalTrailEntry[];
  approvalTrail?: ApprovalTrailEntry[];
  createdBy?: UserRef | null;
  createdByUserId?: string | null;
  approvedBy?: UserRef | null;
  postedBy?: UserRef | null;
  reversalOfId?: string | null;
  reversedByTransactionId?: string | null;
  cancelReason?: string | null;
  reverseReason?: string | null;
  /** Optimistic-concurrency version; must be echoed on PATCH. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function stockTransactionNumber(txn: StockTransaction): string {
  return txn.number ?? txn.transactionNumber ?? txn.id.slice(0, 8);
}

export function stockTransactionApprovals(txn: StockTransaction): ApprovalTrailEntry[] {
  return txn.approvals ?? txn.approvalTrail ?? [];
}

export function stockTransactionReasonLabel(txn: StockTransaction): string | null {
  if (txn.reasonCode) return txn.reasonCode;
  if (!txn.reason) return null;
  if (typeof txn.reason === 'string') return txn.reason;
  return txn.reason.name ?? txn.reason.code ?? null;
}

/* -------------------- Balances (contract §4.2) ---------------------------- */

export interface StockBalance {
  id?: string;
  itemId?: string;
  item?: ItemRef | null;
  branchId?: string;
  branch?: BranchSummary | null;
  warehouseId?: string;
  warehouse?: WarehouseRef | null;
  locationId?: string | null;
  location?: LocationRef | null;
  lotId?: string | null;
  lot?: Lot | null;
  uomId?: string;
  uom?: Uom | null;
  onHand?: DecimalString;
  onHandQuantity?: DecimalString;
  available?: DecimalString;
  availableQuantity?: DecimalString;
  reserved?: DecimalString;
  reservedQuantity?: DecimalString;
  inTransfer?: DecimalString;
  inTransferQuantity?: DecimalString;
  quarantined?: DecimalString;
  quarantinedQuantity?: DecimalString;
}

export function balanceOnHand(row: StockBalance): DecimalString | null {
  return row.onHand ?? row.onHandQuantity ?? null;
}

export function balanceAvailable(row: StockBalance): DecimalString | null {
  return row.available ?? row.availableQuantity ?? null;
}

export function balanceReserved(row: StockBalance): DecimalString | null {
  return row.reserved ?? row.reservedQuantity ?? null;
}

export function balanceInTransfer(row: StockBalance): DecimalString | null {
  return row.inTransfer ?? row.inTransferQuantity ?? null;
}

/* -------------------- Low stock (contract §4.2) --------------------------- */

export interface LowStockRow {
  id?: string;
  itemId?: string;
  item?: ItemRef | null;
  warehouseId?: string;
  warehouse?: WarehouseRef | null;
  branchId?: string;
  branch?: BranchSummary | null;
  available?: DecimalString;
  availableQuantity?: DecimalString;
  onHand?: DecimalString;
  reorderLevel?: DecimalString | null;
  reorderQuantity?: DecimalString | null;
  suggestedQuantity?: DecimalString | null;
  suggestedOrderQuantity?: DecimalString | null;
}

export function lowStockAvailable(row: LowStockRow): DecimalString | null {
  return row.available ?? row.availableQuantity ?? row.onHand ?? null;
}

export function lowStockSuggested(row: LowStockRow): DecimalString | null {
  return row.suggestedQuantity ?? row.suggestedOrderQuantity ?? row.reorderQuantity ?? null;
}

/* -------------------- Serialized assets (contract §4.3) ------------------- */

/** Lookup-backed condition value; the server may embed or flatten it. */
export type AssetCondition = string | { id: string; code?: string; name?: string } | null;

export function conditionLabel(condition: AssetCondition | undefined): string | null {
  if (!condition) return null;
  if (typeof condition === 'string') return condition;
  return condition.name ?? condition.code ?? null;
}

export interface Asset {
  id: string;
  assetTag?: string;
  tag?: string;
  serialNumber?: string | null;
  scanToken?: string | null;
  barcode?: string | null;
  itemId?: string;
  item?: ItemRef | null;
  status: AssetStatus | string;
  condition?: AssetCondition;
  conditionId?: string | null;
  branchId?: string;
  branch?: BranchSummary | null;
  warehouseId?: string | null;
  warehouse?: WarehouseRef | null;
  locationId?: string | null;
  location?: LocationRef | null;
  /** Server field name is storageLocation; location kept as an alias. */
  storageLocationId?: string | null;
  storageLocation?: LocationRef | null;
  custodianEmployeeId?: string | null;
  custodianEmployee?: EmployeeSummary | null;
  custodian?: EmployeeSummary | null;
  departmentId?: string | null;
  department?: { id: string; code?: string; name?: string } | null;
  projectRef?: string | null;
  acquisitionDate?: string | null;
  /** Present only with asset.view_cost. */
  acquisitionCost?: DecimalString | null;
  supplierId?: string | null;
  supplier?: { id: string; code?: string; name?: string; legalName?: string } | null;
  warrantyStartDate?: string | null;
  warrantyEndDate?: string | null;
  maintenanceRequired?: boolean;
  criticality?: { id: string; code?: string; name?: string } | null;
  lastInspectionAt?: string | null;
  nextMaintenanceAt?: string | null;
  retiredAt?: string | null;
  disposedAt?: string | null;
  disposalMethodId?: string | null;
  disposalMethod?: { id: string; code?: string; name?: string } | null;
  disposalNotes?: string | null;
  expectedReturnDate?: string | null;
  notes?: string | null;
  archivedAt?: string | null;
  /** Open custody record on the detail view. */
  openAssignment?: AssetAssignment | null;
  /** Lifecycle events the caller may fire; drives action-button visibility. */
  permittedActions?: string[];
  allowedActions?: string[];
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function assetTag(asset: Asset): string {
  return asset.assetTag ?? asset.tag ?? asset.id.slice(0, 8);
}

export function assetCustodian(asset: Asset): EmployeeSummary | null {
  return asset.custodianEmployee ?? asset.custodian ?? null;
}

export function assetPermittedActions(asset: Asset): string[] | null {
  return asset.permittedActions ?? asset.allowedActions ?? null;
}

export interface AssetAssignment {
  id: string;
  assetId?: string;
  asset?: Asset | null;
  employeeId?: string | null;
  employee?: EmployeeSummary | null;
  departmentId?: string | null;
  department?: { id: string; name?: string } | null;
  projectRef?: string | null;
  locationId?: string | null;
  location?: LocationRef | null;
  assignedAt?: string | null;
  issuedAt?: string | null;
  expectedReturnAt?: string | null;
  expectedReturnDate?: string | null;
  returnedAt?: string | null;
  conditionAtIssue?: AssetCondition;
  conditionAtReturn?: AssetCondition;
  acknowledgedAt?: string | null;
  acknowledgmentStatus?: string | null;
  status?: string | null;
  issueNotes?: string | null;
  returnNotes?: string | null;
  notes?: string | null;
  assignedBy?: UserRef | null;
  returnReceivedBy?: UserRef | null;
  acknowledgments?: Array<{
    id: string;
    type?: string | null;
    acknowledgedAt?: string | null;
    method?: string | null;
    notes?: string | null;
    acknowledgedByUser?: UserRef | null;
  }>;
  createdAt?: string | null;
}

/**
 * GET /assets/:id/history — unified timeline entry. `detail` carries the
 * kind-specific row (status: fromStatus/toStatus/reason/changedBy; condition:
 * condition/source/recordedBy; movement: from/to branch-warehouse-location-
 * employee + movedBy).
 */
export interface AssetHistoryEntry {
  kind: 'status' | 'condition' | 'movement' | string;
  at?: string | null;
  detail?: Record<string, unknown>;
}

export function historyTimestamp(entry: AssetHistoryEntry): string | null {
  return entry.at ?? null;
}

/** Read a nested display name out of a history `detail` blob. */
export function historyDetailName(
  detail: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = detail?.[key];
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.displayName === 'string' && record.displayName) return record.displayName;
  if (typeof record.name === 'string' && record.name) return record.name;
  const first = typeof record.firstName === 'string' ? record.firstName : '';
  const last = typeof record.lastName === 'string' ? record.lastName : '';
  const full = [first, last].filter(Boolean).join(' ');
  if (full) return full;
  if (typeof record.code === 'string' && record.code) return record.code;
  return null;
}

export function historyDetailString(
  detail: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = detail?.[key];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Open custody assignment row (GET /employees/:id/assets and the
 * outstanding/overdueReturns arrays of /employees/:id/acknowledgments).
 */
export interface CustodyAssignment {
  id: string;
  status?: string | null;
  assignedAt?: string | null;
  expectedReturnAt?: string | null;
  expectedReturnDate?: string | null;
  acknowledgedAt?: string | null;
  conditionAtIssue?: AssetCondition;
  issueNotes?: string | null;
  asset?: Asset | null;
}

/** GET /employees/:id/acknowledgments response. */
export interface EmployeeAcknowledgmentsView {
  outstanding?: CustodyAssignment[];
  overdueReturns?: CustodyAssignment[];
}

export function custodyExpectedReturn(row: CustodyAssignment): string | null {
  return row.expectedReturnAt ?? row.expectedReturnDate ?? null;
}

export function custodyIsOverdue(row: CustodyAssignment): boolean {
  const due = custodyExpectedReturn(row);
  if (!due) return false;
  const days = daysUntil(due);
  return days !== null && days < 0;
}

/* ------------------------- Transfers (contract §4.5) ---------------------- */

export interface TransferEndpoint {
  branchId?: string;
  branch?: BranchSummary | null;
  warehouseId?: string;
  warehouse?: WarehouseRef | null;
  locationId?: string | null;
  location?: LocationRef | null;
}

export interface TransferLine {
  id?: string;
  lineNumber?: number;
  itemId?: string | null;
  item?: ItemRef | null;
  assetId?: string | null;
  asset?: Asset | null;
  uomId?: string | null;
  uom?: Uom | null;
  lotId?: string | null;
  lot?: Lot | null;
  quantity?: DecimalString | null;
  qty?: DecimalString | null;
  requestedQuantity?: DecimalString | null;
  dispatchedQuantity?: DecimalString | null;
  receivedQuantity?: DecimalString | null;
  damagedQuantity?: DecimalString | null;
  shortQuantity?: DecimalString | null;
  rejectedQuantity?: DecimalString | null;
  notes?: string | null;
  status?: string | null;
}

export function transferLineQuantity(line: TransferLine): DecimalString | null {
  return line.quantity ?? line.qty ?? line.requestedQuantity ?? null;
}

export interface Transfer {
  id: string;
  number?: string;
  transferNumber?: string;
  kind?: string;
  status: TransferStatus | string;
  sourceBranchId?: string;
  sourceBranch?: BranchSummary | null;
  sourceWarehouseId?: string;
  sourceWarehouse?: WarehouseRef | null;
  sourceLocationId?: string | null;
  sourceLocation?: LocationRef | null;
  destinationBranchId?: string;
  destinationBranch?: BranchSummary | null;
  destinationWarehouseId?: string;
  destinationWarehouse?: WarehouseRef | null;
  destinationLocationId?: string | null;
  destinationLocation?: LocationRef | null;
  source?: TransferEndpoint | null;
  destination?: TransferEndpoint | null;
  notes?: string | null;
  lines?: TransferLine[];
  approvals?: ApprovalTrailEntry[];
  approvalTrail?: ApprovalTrailEntry[];
  createdBy?: UserRef | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  dispatchedAt?: string | null;
  receivedAt?: string | null;
  canceledAt?: string | null;
  rejectedAt?: string | null;
  cancelReason?: string | null;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function transferNumber(transfer: Transfer): string {
  return transfer.number ?? transfer.transferNumber ?? transfer.id.slice(0, 8);
}

export function transferSource(transfer: Transfer): TransferEndpoint {
  return (
    transfer.source ?? {
      branchId: transfer.sourceBranchId,
      branch: transfer.sourceBranch,
      warehouseId: transfer.sourceWarehouseId,
      warehouse: transfer.sourceWarehouse,
      locationId: transfer.sourceLocationId,
      location: transfer.sourceLocation,
    }
  );
}

export function transferDestination(transfer: Transfer): TransferEndpoint {
  return (
    transfer.destination ?? {
      branchId: transfer.destinationBranchId,
      branch: transfer.destinationBranch,
      warehouseId: transfer.destinationWarehouseId,
      warehouse: transfer.destinationWarehouse,
      locationId: transfer.destinationLocationId,
      location: transfer.destinationLocation,
    }
  );
}

export function transferApprovals(transfer: Transfer): ApprovalTrailEntry[] {
  return transfer.approvals ?? transfer.approvalTrail ?? [];
}

/* ========================================================================== */
/* Phase 4 — Procurement (docs/api-outline.md §5)                             */
/* ========================================================================== */

/* ------------------------- Suppliers (contract §5.1) ---------------------- */

export interface SupplierContact {
  id: string;
  supplierId?: string;
  name: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Supplier {
  id: string;
  code: string;
  legalName?: string;
  tradeName?: string | null;
  /** Some payloads may flatten to a single name field. */
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  taxId?: string | null;
  paymentTerms?: string | null;
  categoryId?: string | null;
  category?: LookupValue | null;
  /** Tolerated plural shape should the API expose multiple categories. */
  categories?: LookupValue[] | null;
  notes?: string | null;
  isActive: boolean;
  archivedAt?: string | null;
  contacts?: SupplierContact[];
  contactsCount?: number;
  _count?: { contacts?: number; purchaseOrders?: number };
  createdAt?: string;
  updatedAt?: string;
}

/** Preferred display name: trade name, then legal name. */
export function supplierName(supplier: Supplier): string {
  return supplier.tradeName ?? supplier.legalName ?? supplier.name ?? supplier.code;
}

export function supplierLegalName(supplier: Supplier): string | null {
  return supplier.legalName ?? supplier.name ?? null;
}

export function supplierCategories(supplier: Supplier): LookupValue[] {
  if (supplier.categories && supplier.categories.length > 0) return supplier.categories;
  return supplier.category ? [supplier.category] : [];
}

export function supplierContactsCount(supplier: Supplier): number | null {
  return supplier.contactsCount ?? supplier._count?.contacts ?? supplier.contacts?.length ?? null;
}

/** GET /suppliers/:id/history — rollup; every field optional/tolerated. */
export interface SupplierHistoryRollup {
  totalPurchaseOrders?: number;
  poCount?: number;
  openPurchaseOrders?: number;
  openPoCount?: number;
  totalReceipts?: number;
  receiptCount?: number;
  lastOrderDate?: string | null;
  lastDeliveryDate?: string | null;
  lastReceiptDate?: string | null;
  /** Money — present only with cost permission. */
  totalSpend?: DecimalString | null;
  totalPurchased?: DecimalString | null;
}

export function supplierHistoryPoCount(rollup: SupplierHistoryRollup): number | null {
  return rollup.totalPurchaseOrders ?? rollup.poCount ?? null;
}

export function supplierHistoryOpenPoCount(rollup: SupplierHistoryRollup): number | null {
  return rollup.openPurchaseOrders ?? rollup.openPoCount ?? null;
}

export function supplierHistoryReceiptCount(rollup: SupplierHistoryRollup): number | null {
  return rollup.totalReceipts ?? rollup.receiptCount ?? null;
}

export function supplierHistoryLastDelivery(rollup: SupplierHistoryRollup): string | null {
  return rollup.lastDeliveryDate ?? rollup.lastReceiptDate ?? null;
}

export function supplierHistorySpend(rollup: SupplierHistoryRollup): DecimalString | null {
  return rollup.totalSpend ?? rollup.totalPurchased ?? null;
}

export interface SupplierRef {
  id: string;
  code?: string;
  legalName?: string;
  tradeName?: string | null;
  name?: string | null;
}

export function supplierRefLabel(supplier: SupplierRef | null | undefined): string {
  if (!supplier) return '—';
  return supplier.tradeName ?? supplier.legalName ?? supplier.name ?? supplier.code ?? supplier.id;
}

/* ---------------------- Purchase orders (contract §5.2) ------------------- */

export interface PurchaseOrderLine {
  id?: string;
  purchaseOrderId?: string;
  lineNumber?: number;
  itemId: string;
  item?: ItemRef | null;
  description?: string | null;
  uomId?: string;
  uom?: Uom | null;
  quantity: DecimalString;
  /** Money fields — present only with procurement cost permission. */
  unitPrice?: DecimalString | null;
  discountAmount?: DecimalString | null;
  discount?: DecimalString | null;
  taxAmount?: DecimalString | null;
  tax?: DecimalString | null;
  lineTotal?: DecimalString | null;
  total?: DecimalString | null;
  receivedQuantity?: DecimalString | null;
  canceledQuantity?: DecimalString | null;
  outstandingQuantity?: DecimalString | null;
  notes?: string | null;
}

export function poLineDiscount(line: PurchaseOrderLine): DecimalString | null {
  return line.discountAmount ?? line.discount ?? null;
}

export function poLineTax(line: PurchaseOrderLine): DecimalString | null {
  return line.taxAmount ?? line.tax ?? null;
}

export function poLineTotal(line: PurchaseOrderLine): DecimalString | null {
  return line.lineTotal ?? line.total ?? null;
}

/** Outstanding = ordered − received − canceled (server value wins when sent). */
export function poLineOutstanding(line: PurchaseOrderLine): number {
  if (line.outstandingQuantity !== undefined && line.outstandingQuantity !== null) {
    return decimalValue(line.outstandingQuantity);
  }
  return Math.max(
    decimalValue(line.quantity) -
      decimalValue(line.receivedQuantity) -
      decimalValue(line.canceledQuantity),
    0,
  );
}

export interface PurchaseOrder {
  id: string;
  poNumber?: string;
  number?: string;
  status: PurchaseOrderStatus | string;
  supplierId?: string;
  supplier?: SupplierRef | null;
  branchId?: string;
  branch?: BranchSummary | null;
  destinationWarehouseId?: string;
  destinationWarehouse?: WarehouseRef | null;
  warehouse?: WarehouseRef | null;
  orderDate?: string | null;
  expectedDeliveryDate?: string | null;
  expectedDate?: string | null;
  currency?: string | null;
  currencyCode?: string | null;
  /** Money totals — present only with procurement cost permission. */
  subtotal?: DecimalString | null;
  discountTotal?: DecimalString | null;
  taxTotal?: DecimalString | null;
  grandTotal?: DecimalString | null;
  total?: DecimalString | null;
  terms?: string | null;
  notes?: string | null;
  lines?: PurchaseOrderLine[];
  receipts?: GoodsReceipt[];
  goodsReceipts?: GoodsReceipt[];
  approvals?: ApprovalTrailEntry[];
  approvalTrail?: ApprovalTrailEntry[];
  createdBy?: UserRef | null;
  createdById?: string | null;
  submittedAt?: string | null;
  approvedBy?: UserRef | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  canceledBy?: UserRef | null;
  canceledAt?: string | null;
  closedAt?: string | null;
  cancelReason?: string | null;
  closeReason?: string | null;
  /** Optimistic-concurrency version; must be echoed on PATCH. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function purchaseOrderNumber(po: PurchaseOrder): string {
  return po.poNumber ?? po.number ?? po.id.slice(0, 8);
}

export function poExpectedDate(po: PurchaseOrder): string | null {
  return po.expectedDeliveryDate ?? po.expectedDate ?? null;
}

export function poCurrency(po: PurchaseOrder): string {
  return po.currency ?? po.currencyCode ?? 'PHP';
}

export function poGrandTotal(po: PurchaseOrder): DecimalString | null {
  return po.grandTotal ?? po.total ?? null;
}

export function poDestinationWarehouse(po: PurchaseOrder): WarehouseRef | null {
  return po.destinationWarehouse ?? po.warehouse ?? null;
}

export function purchaseOrderApprovals(po: PurchaseOrder): ApprovalTrailEntry[] {
  return po.approvals ?? po.approvalTrail ?? [];
}

export function poReceipts(po: PurchaseOrder): GoodsReceipt[] | null {
  return po.receipts ?? po.goodsReceipts ?? null;
}

/* ----------------------- Goods receipts (contract §5.3) ------------------- */

export interface GoodsReceiptLineLot {
  id?: string;
  lotNo?: string | null;
  lotNumber?: string | null;
  mfgDate?: string | null;
  expiryDate?: string | null;
  qty?: DecimalString | null;
  quantity?: DecimalString | null;
}

export interface GoodsReceiptLine {
  id?: string;
  goodsReceiptId?: string;
  purchaseOrderLineId?: string;
  poLineId?: string;
  lineNumber?: number;
  itemId?: string;
  item?: ItemRef | null;
  uomId?: string;
  uom?: Uom | null;
  quantity?: DecimalString;
  receivedQuantity?: DecimalString;
  baseQuantity?: DecimalString | null;
  /** Money — present only with cost permission. */
  unitCost?: DecimalString | null;
  serials?: string[] | null;
  serialNumbers?: string[] | null;
  lots?: GoodsReceiptLineLot[] | null;
  lotId?: string | null;
  lot?: Lot | null;
  locationId?: string | null;
  storageLocationId?: string | null;
  location?: LocationRef | null;
  storageLocation?: LocationRef | null;
  notes?: string | null;
}

export function grLineQuantity(line: GoodsReceiptLine): DecimalString | null {
  return line.receivedQuantity ?? line.quantity ?? null;
}

export function grLinePoLineId(line: GoodsReceiptLine): string | null {
  return line.purchaseOrderLineId ?? line.poLineId ?? null;
}

export function grLineSerials(line: GoodsReceiptLine): string[] {
  return line.serials ?? line.serialNumbers ?? [];
}

export function grLineLocation(line: GoodsReceiptLine): LocationRef | null {
  return line.location ?? line.storageLocation ?? null;
}

export interface GoodsReceipt {
  id: string;
  receiptNumber?: string;
  number?: string;
  purchaseOrderId?: string;
  purchaseOrder?: PurchaseOrder | null;
  branchId?: string;
  branch?: BranchSummary | null;
  warehouseId?: string;
  warehouse?: WarehouseRef | null;
  supplierId?: string;
  supplier?: SupplierRef | null;
  /** DRAFT | POSTED | CANCELED | REVERSED. */
  status: string;
  receiptDate?: string | null;
  receivedDate?: string | null;
  supplierReference?: string | null;
  deliveryRefNo?: string | null;
  invoiceRefNo?: string | null;
  notes?: string | null;
  lines?: GoodsReceiptLine[];
  createdBy?: UserRef | null;
  postedBy?: UserRef | null;
  postedAt?: string | null;
  canceledAt?: string | null;
  reversedAt?: string | null;
  cancelReason?: string | null;
  reverseReason?: string | null;
  /** Optimistic-concurrency version; must be echoed on PATCH. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function goodsReceiptNumber(receipt: GoodsReceipt): string {
  return receipt.receiptNumber ?? receipt.number ?? receipt.id.slice(0, 8);
}

export function goodsReceiptDate(receipt: GoodsReceipt): string | null {
  return receipt.receiptDate ?? receipt.receivedDate ?? null;
}

export function goodsReceiptSupplierRef(receipt: GoodsReceipt): string | null {
  return receipt.supplierReference ?? receipt.deliveryRefNo ?? receipt.invoiceRefNo ?? null;
}

/* ------------------ Purchase history (contract §5.4) ---------------------- */

/** One row of GET /purchase-history; field names tolerated defensively. */
export interface PurchaseHistoryRow {
  id?: string;
  purchaseOrderId?: string | null;
  poNumber?: string | null;
  purchaseOrder?: PurchaseOrder | null;
  receiptId?: string | null;
  receiptNumber?: string | null;
  supplierId?: string | null;
  supplier?: SupplierRef | null;
  itemId?: string | null;
  item?: ItemRef | null;
  branchId?: string | null;
  branch?: BranchSummary | null;
  warehouseId?: string | null;
  warehouse?: WarehouseRef | null;
  status?: string | null;
  orderDate?: string | null;
  uom?: Uom | null;
  orderedQuantity?: DecimalString | null;
  ordered?: DecimalString | null;
  receivedQuantity?: DecimalString | null;
  received?: DecimalString | null;
  outstandingQuantity?: DecimalString | null;
  outstanding?: DecimalString | null;
  canceledQuantity?: DecimalString | null;
  canceled?: DecimalString | null;
  returnedQuantity?: DecimalString | null;
  returned?: DecimalString | null;
  /** Money — present only with procurement cost permission. */
  orderedCost?: DecimalString | null;
  totalCost?: DecimalString | null;
  amount?: DecimalString | null;
}

export function historyOrdered(row: PurchaseHistoryRow): DecimalString | null {
  return row.orderedQuantity ?? row.ordered ?? null;
}

export function historyReceived(row: PurchaseHistoryRow): DecimalString | null {
  return row.receivedQuantity ?? row.received ?? null;
}

export function historyOutstanding(row: PurchaseHistoryRow): DecimalString | null {
  if (row.outstandingQuantity !== undefined && row.outstandingQuantity !== null) {
    return row.outstandingQuantity;
  }
  if (row.outstanding !== undefined && row.outstanding !== null) return row.outstanding;
  const ordered = historyOrdered(row);
  if (ordered === null) return null;
  return Math.max(
    decimalValue(ordered) -
      decimalValue(historyReceived(row)) -
      decimalValue(row.canceledQuantity ?? row.canceled),
    0,
  );
}

export function historyCanceled(row: PurchaseHistoryRow): DecimalString | null {
  return row.canceledQuantity ?? row.canceled ?? null;
}

export function historyReturned(row: PurchaseHistoryRow): DecimalString | null {
  return row.returnedQuantity ?? row.returned ?? null;
}

export function historyCost(row: PurchaseHistoryRow): DecimalString | null {
  return row.totalCost ?? row.orderedCost ?? row.amount ?? null;
}

export function historyPoNumber(row: PurchaseHistoryRow): string | null {
  return row.poNumber ?? row.purchaseOrder?.poNumber ?? row.purchaseOrder?.number ?? null;
}

export function historyPoId(row: PurchaseHistoryRow): string | null {
  return row.purchaseOrderId ?? row.purchaseOrder?.id ?? null;
}

/* ========================================================================== */
/* Phase 5 — Maintenance (docs/api-outline.md §6)                             */
/* ========================================================================== */

/* ------------------- Maintenance plans (contract §6.1) -------------------- */

export interface MaintenancePlanTask {
  id?: string;
  planId?: string;
  sequence?: number;
  name: string;
  description?: string | null;
  isRequired?: boolean;
  required?: boolean;
}

export function planTaskIsRequired(task: MaintenancePlanTask): boolean {
  return task.isRequired ?? task.required ?? true;
}

export interface MaintenancePlan {
  id: string;
  code?: string | null;
  name: string;
  description?: string | null;
  /** Single covered asset and/or every maintainable asset of an item. */
  assetId?: string | null;
  asset?: Asset | null;
  itemId?: string | null;
  item?: ItemRef | null;
  maintenanceTypeId?: string | null;
  maintenanceType?: LookupValue | null;
  type?: LookupValue | null;
  /** Frequency — exactly one of interval / meter / cron schedule. */
  intervalDays?: number | null;
  meterInterval?: DecimalString | null;
  meterType?: string | null;
  scheduleCron?: string | null;
  assignedTeam?: string | null;
  vendorId?: string | null;
  vendor?: SupplierRef | null;
  estimatedDurationHours?: DecimalString | null;
  /** Present only with maintenance cost permission. */
  estimatedCost?: DecimalString | null;
  reminderLeadDays?: number | null;
  nextDueAt?: string | null;
  nextDueDate?: string | null;
  isActive?: boolean;
  active?: boolean;
  archivedAt?: string | null;
  tasks?: MaintenancePlanTask[];
  checklist?: MaintenancePlanTask[];
  /** Covered assets (PUT :id/assets replaces this set; detail only). */
  assets?: Asset[];
  coveredAssets?: Asset[];
  /** List rows carry counts instead of the expanded collections. */
  coveredAssetCount?: number;
  taskCount?: number;
  /** Optimistic-concurrency version; must be echoed on PATCH. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function planType(plan: MaintenancePlan): LookupValue | null {
  return plan.maintenanceType ?? plan.type ?? null;
}

export function planIsActive(plan: MaintenancePlan): boolean {
  return plan.isActive ?? plan.active ?? false;
}

export function planTasks(plan: MaintenancePlan): MaintenancePlanTask[] {
  return plan.tasks ?? plan.checklist ?? [];
}

export function planCoveredAssets(plan: MaintenancePlan): Asset[] {
  return plan.assets ?? plan.coveredAssets ?? [];
}

export function planNextDue(plan: MaintenancePlan): string | null {
  return plan.nextDueAt ?? plan.nextDueDate ?? null;
}

/** Human description of the plan's frequency rule. */
export function planFrequencyLabel(plan: MaintenancePlan): string {
  if (plan.intervalDays !== null && plan.intervalDays !== undefined) {
    return `Every ${plan.intervalDays} day${plan.intervalDays === 1 ? '' : 's'}`;
  }
  if (plan.meterInterval !== null && plan.meterInterval !== undefined) {
    return `Every ${formatQuantity(plan.meterInterval)} ${plan.meterType ?? 'meter units'}`;
  }
  if (plan.scheduleCron) return `Schedule: ${plan.scheduleCron}`;
  return 'No frequency set';
}

/* --------------------- Work orders (contract §6.2) ------------------------- */

export interface WorkOrderTask {
  id?: string;
  workOrderId?: string;
  planTaskId?: string | null;
  sequence?: number;
  name: string;
  description?: string | null;
  isRequired?: boolean;
  required?: boolean;
  isCompleted?: boolean;
  completed?: boolean;
  completedAt?: string | null;
  completedBy?: UserRef | null;
  notes?: string | null;
}

export function woTaskIsRequired(task: WorkOrderTask): boolean {
  return task.isRequired ?? task.required ?? true;
}

export function woTaskIsCompleted(task: WorkOrderTask): boolean {
  return task.isCompleted ?? task.completed ?? !!task.completedAt;
}

/** Spare part consumed by a WO — backed by a MAINTENANCE_ISSUE stock issue. */
export interface WorkOrderPart {
  id?: string;
  workOrderId?: string;
  itemId?: string;
  item?: ItemRef | null;
  lotId?: string | null;
  lot?: { id: string; lotNumber?: string } | null;
  uomId?: string;
  uom?: Uom | null;
  quantity?: DecimalString | null;
  baseQuantity?: DecimalString | null;
  /** Money fields — present only with maintenance cost permission. */
  unitCost?: DecimalString | null;
  totalCost?: DecimalString | null;
  stockTransactionId?: string | null;
  stockTransaction?: { id: string; number?: string; transactionNumber?: string; status?: string } | null;
  notes?: string | null;
  createdAt?: string;
}

export function woPartTransactionId(part: WorkOrderPart): string | null {
  return part.stockTransactionId ?? part.stockTransaction?.id ?? null;
}

export function woPartTransactionStatus(part: WorkOrderPart): string | null {
  return part.stockTransaction?.status ?? null;
}

export interface WorkOrder {
  id: string;
  workOrderNumber?: string;
  number?: string;
  status: string;
  assetId?: string;
  asset?: Asset | null;
  planId?: string | null;
  plan?: { id: string; code?: string | null; name?: string } | null;
  branchId?: string;
  branch?: BranchSummary | null;
  typeId?: string;
  type?: LookupValue | null;
  maintenanceType?: LookupValue | null;
  priorityId?: string | null;
  priority?: LookupValue | null;
  problem?: string | null;
  problemDescription?: string | null;
  reportedById?: string | null;
  reportedBy?: UserRef | null;
  reportedAt?: string | null;
  assignedToEmployeeId?: string | null;
  assignedToEmployee?: EmployeeSummary | null;
  technicianUserId?: string | null;
  technician?: UserRef | null;
  assignedTeam?: string | null;
  assignedVendorId?: string | null;
  assignedVendor?: SupplierRef | null;
  scheduledStartAt?: string | null;
  plannedStart?: string | null;
  scheduledEndAt?: string | null;
  plannedEnd?: string | null;
  actualStartAt?: string | null;
  actualEndAt?: string | null;
  diagnosis?: string | null;
  actionTaken?: string | null;
  resolution?: string | null;
  holdReason?: string | null;
  /** Money fields — present only with maintenance cost permission. */
  laborCost?: DecimalString | null;
  partsCost?: DecimalString | null;
  externalCost?: DecimalString | null;
  totalCost?: DecimalString | null;
  downtimeHours?: DecimalString | null;
  downtimeMinutes?: DecimalString | null;
  completionConditionId?: string | null;
  completionCondition?: LookupValue | null;
  finalCondition?: LookupValue | null;
  nextMaintenanceAt?: string | null;
  nextMaintenanceDate?: string | null;
  /** Asset lifecycle status chosen at completion (AVAILABLE | … | RETIRED). */
  outcomeStatus?: string | null;
  /** Status the asset held before the WO started (restored on cancel). */
  assetStatusBeforeWo?: string | null;
  completionMeterReading?: DecimalString | null;
  completedBy?: UserRef | null;
  verifiedById?: string | null;
  verifiedBy?: UserRef | null;
  verifiedAt?: string | null;
  canceledBy?: UserRef | null;
  canceledAt?: string | null;
  cancelReason?: string | null;
  completedAt?: string | null;
  createdBy?: UserRef | null;
  createdById?: string | null;
  tasks?: WorkOrderTask[];
  checklist?: WorkOrderTask[];
  parts?: WorkOrderPart[];
  partsIssues?: WorkOrderPart[];
  /** Optimistic-concurrency version; must be echoed on PATCH. */
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function workOrderNumber(wo: WorkOrder): string {
  return wo.workOrderNumber ?? wo.number ?? wo.id.slice(0, 8);
}

export function woProblem(wo: WorkOrder): string | null {
  return wo.problemDescription ?? wo.problem ?? null;
}

export function woType(wo: WorkOrder): LookupValue | null {
  return wo.type ?? wo.maintenanceType ?? null;
}

export function woPlannedStart(wo: WorkOrder): string | null {
  return wo.scheduledStartAt ?? wo.plannedStart ?? null;
}

export function woPlannedEnd(wo: WorkOrder): string | null {
  return wo.scheduledEndAt ?? wo.plannedEnd ?? null;
}

export function woNextMaintenance(wo: WorkOrder): string | null {
  return wo.nextMaintenanceAt ?? wo.nextMaintenanceDate ?? null;
}

export function woCompletionCondition(wo: WorkOrder): LookupValue | null {
  return wo.completionCondition ?? wo.finalCondition ?? null;
}

export function woTasks(wo: WorkOrder): WorkOrderTask[] {
  return wo.tasks ?? wo.checklist ?? [];
}

export function woParts(wo: WorkOrder): WorkOrderPart[] {
  return wo.parts ?? wo.partsIssues ?? [];
}

/** Who the WO is assigned to, for display (employee, team, or vendor). */
export function woAssigneeLabel(wo: WorkOrder): string | null {
  if (wo.assignedToEmployee) return employeeName(wo.assignedToEmployee);
  if (wo.technician?.displayName) return wo.technician.displayName;
  if (wo.assignedTeam) return wo.assignedTeam;
  if (wo.assignedVendor) return supplierRefLabel(wo.assignedVendor);
  return null;
}

/** Downtime in minutes, tolerating hour- or minute-based payloads. */
export function woDowntimeMinutes(wo: WorkOrder): number | null {
  if (wo.downtimeMinutes !== undefined && wo.downtimeMinutes !== null) {
    return decimalValue(wo.downtimeMinutes);
  }
  if (wo.downtimeHours !== undefined && wo.downtimeHours !== null) {
    return decimalValue(wo.downtimeHours) * 60;
  }
  return null;
}

export function formatDowntime(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
}

/** Total cost — server value wins; falls back to summing the components. */
export function woTotalCost(wo: WorkOrder): DecimalString | null {
  if (wo.totalCost !== undefined && wo.totalCost !== null) return wo.totalCost;
  const components = [wo.laborCost, wo.partsCost, wo.externalCost].filter(
    (value): value is DecimalString => value !== undefined && value !== null,
  );
  if (components.length === 0) return null;
  return components.reduce<number>((sum, value) => sum + decimalValue(value), 0);
}

/** True when the session user's employee/user id is the assigned technician. */
export function woIsAssignedTo(wo: WorkOrder, me: Me): boolean {
  const employeeId = meEmployeeId(me);
  if (employeeId && (wo.assignedToEmployeeId === employeeId || wo.assignedToEmployee?.id === employeeId)) {
    return true;
  }
  const userId = me.id;
  return !!userId && (wo.technicianUserId === userId || wo.technician?.id === userId);
}

/* ------------------ Asset meter readings (contract §6.2) ------------------- */

export interface AssetMeterReading {
  id: string;
  assetId?: string;
  meterType?: string | null;
  readingValue?: DecimalString | null;
  value?: DecimalString | null;
  readingAt?: string | null;
  readAt?: string | null;
  recordedBy?: UserRef | null;
  notes?: string | null;
  createdAt?: string;
}

export function meterReadingValue(reading: AssetMeterReading): DecimalString | null {
  return reading.readingValue ?? reading.value ?? null;
}

export function meterReadingAt(reading: AssetMeterReading): string | null {
  return reading.readingAt ?? reading.readAt ?? reading.createdAt ?? null;
}

/* ------------------------- Scanning (contract §4.4) ----------------------- */

export interface ScanResolution {
  kind?: string;
  type?: string;
  id?: string;
  /** Kind-specific record snapshot (asset: tag/serial/status/item, …). */
  summary?: string | Record<string, unknown> | null;
  /** Asset resolutions include the lifecycle actions the caller may fire. */
  permittedActions?: string[];
}

export function scanKind(resolution: ScanResolution): string {
  return (resolution.kind ?? resolution.type ?? '').toLowerCase();
}

export function scanTargetId(resolution: ScanResolution): string | null {
  return resolution.id ?? null;
}

function summaryString(summary: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = summary[key];
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

/** Primary display line for a scan hit. */
export function scanSummaryText(resolution: ScanResolution): string {
  const summary = resolution.summary;
  if (typeof summary === 'string' && summary) return summary;
  if (summary && typeof summary === 'object') {
    const direct = summaryString(summary, ['assetTag', 'lotNumber', 'name', 'sku', 'code', 'barcode']);
    if (direct) return direct;
    const item = summary['item'];
    if (item && typeof item === 'object') {
      const viaItem = summaryString(item as Record<string, unknown>, ['name', 'sku']);
      if (viaItem) return viaItem;
    }
  }
  return 'Resolved record';
}

/** Secondary display line for a scan hit (item name, status, …). */
export function scanSummaryDetail(resolution: ScanResolution): string | null {
  const summary = resolution.summary;
  if (!summary || typeof summary !== 'object') return null;
  const parts: string[] = [];
  const item = summary['item'];
  if (item && typeof item === 'object') {
    const label = summaryString(item as Record<string, unknown>, ['name', 'sku']);
    if (label && label !== scanSummaryText(resolution)) parts.push(label);
  }
  const status = summary['status'];
  if (typeof status === 'string' && status) parts.push(status);
  const serial = summary['serialNumber'];
  if (typeof serial === 'string' && serial) parts.push(`SN ${serial}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/* ========================================================================== */
/* Phase 3.5 — Attachments (contract §4.6)                                    */
/* ========================================================================== */

/**
 * Attachment metadata row (bytes live in S3/MinIO; downloads proxy through
 * the API). Field names mirror the persistence model with the usual tolerant
 * aliases.
 */
export interface Attachment {
  id: string;
  resourceType?: string;
  resourceId?: string;
  fileName?: string;
  filename?: string;
  originalName?: string;
  mimeType?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  size?: number | null;
  documentTypeId?: string | null;
  documentType?: { id: string; code?: string; name?: string } | null;
  kind?: string | null;
  branchId?: string | null;
  uploadedById?: string | null;
  uploadedBy?: UserRef | null;
  uploader?: UserRef | null;
  archivedAt?: string | null;
  uploadedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function attachmentFileName(attachment: Attachment): string {
  return (
    attachment.fileName ?? attachment.filename ?? attachment.originalName ?? attachment.id
  );
}

export function attachmentMimeType(attachment: Attachment): string | null {
  return attachment.mimeType ?? attachment.contentType ?? null;
}

export function attachmentSizeBytes(attachment: Attachment): number | null {
  return attachment.sizeBytes ?? attachment.size ?? null;
}

export function attachmentUploader(attachment: Attachment): UserRef | null {
  return attachment.uploadedBy ?? attachment.uploader ?? null;
}

export function attachmentUploadedAt(attachment: Attachment): string | null {
  return attachment.uploadedAt ?? attachment.createdAt ?? null;
}

/** DOCUMENT_TYPE lookup label, or the raw kind string when not hydrated. */
export function attachmentKindLabel(attachment: Attachment): string | null {
  if (attachment.documentType) {
    return attachment.documentType.name ?? attachment.documentType.code ?? null;
  }
  return attachment.kind ?? null;
}

/** "2048" -> "2.0 KB"; null-safe. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/* ========================================================================== */
/* Phase 3.5 — Global search (contract §4.7)                                  */
/* ========================================================================== */

/**
 * One global-search hit. The server serializes each entity with its natural
 * fields, so every label field is optional and read through helpers.
 */
export interface GlobalSearchResult {
  id: string;
  /** Entity discriminator (e.g. "asset", "purchase_order"). */
  type?: string;
  resourceType?: string;
  entity?: string;
  /** Common label fields across entity payloads. */
  assetTag?: string | null;
  tag?: string | null;
  serialNumber?: string | null;
  sku?: string | null;
  name?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  employeeNumber?: string | null;
  legalName?: string | null;
  tradeName?: string | null;
  code?: string | null;
  number?: string | null;
  poNumber?: string | null;
  receiptNumber?: string | null;
  workOrderNumber?: string | null;
  transactionNumber?: string | null;
  transferNumber?: string | null;
  status?: string | null;
  /** Nested summaries some entities carry. */
  item?: { id?: string; sku?: string; name?: string } | null;
  supplier?: { id?: string; code?: string; legalName?: string; tradeName?: string | null } | null;
  branch?: { id?: string; code?: string; name?: string } | null;
  /** Optional pre-computed display fields, when the API provides them. */
  title?: string | null;
  label?: string | null;
  subtitle?: string | null;
  description?: string | null;
}

/** Canonical entity keys the search UI groups by. */
export type SearchEntityType =
  | 'asset'
  | 'item'
  | 'employee'
  | 'supplier'
  | 'purchase_order'
  | 'goods_receipt'
  | 'work_order'
  | 'stock_transaction'
  | 'transfer'
  | 'lot';

/** "purchaseOrders" / "PURCHASE_ORDER" / "purchase-orders" -> "purchase_order". */
function canonicalSearchType(raw: string): SearchEntityType | null {
  const normalized = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
    .replace(/s$/, '');
  switch (normalized) {
    case 'asset':
      return 'asset';
    case 'item':
      return 'item';
    case 'employee':
      return 'employee';
    case 'supplier':
      return 'supplier';
    case 'purchase_order':
    case 'po':
      return 'purchase_order';
    case 'goods_receipt':
    case 'receipt':
      return 'goods_receipt';
    case 'work_order':
    case 'maintenance_work_order':
      return 'work_order';
    case 'stock_transaction':
    case 'transaction':
      return 'stock_transaction';
    case 'transfer':
      return 'transfer';
    case 'lot':
      return 'lot';
    default:
      return null;
  }
}

export interface GlobalSearchGroup {
  type: SearchEntityType;
  results: GlobalSearchResult[];
}

const SEARCH_GROUP_ORDER: SearchEntityType[] = [
  'asset',
  'item',
  'employee',
  'supplier',
  'purchase_order',
  'goods_receipt',
  'work_order',
  'stock_transaction',
  'transfer',
  'lot',
];

function isSearchResult(value: unknown): value is GlobalSearchResult & Record<string, unknown> {
  return !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';
}

/**
 * Normalize any of the plausible GET /search payload shapes — a flat result
 * array (each row carrying a `type`), `{ results: [...] }`, or an object
 * keyed by entity group (`{ assets: [...], purchaseOrders: [...] }`) — into
 * ordered groups. Unrecognized rows/groups are dropped rather than crashing.
 */
export function normalizeSearchResults(payload: unknown): GlobalSearchGroup[] {
  const buckets = new Map<SearchEntityType, GlobalSearchResult[]>();
  const add = (type: SearchEntityType | null, row: GlobalSearchResult) => {
    if (!type) return;
    const bucket = buckets.get(type) ?? [];
    if (!bucket.some((existing) => existing.id === row.id)) bucket.push(row);
    buckets.set(type, bucket);
  };
  const addFlat = (rows: unknown[]) => {
    for (const row of rows) {
      if (!isSearchResult(row)) continue;
      const raw = row.type ?? row.resourceType ?? row.entity;
      add(typeof raw === 'string' ? canonicalSearchType(raw) : null, row);
    }
  };

  if (Array.isArray(payload)) {
    addFlat(payload);
  } else if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const flat = record['results'] ?? record['data'];
    if (Array.isArray(flat)) {
      addFlat(flat);
    } else {
      for (const [key, value] of Object.entries(record)) {
        if (!Array.isArray(value)) continue;
        const type = canonicalSearchType(key);
        for (const row of value) {
          if (isSearchResult(row)) add(type, row);
        }
      }
    }
  }

  return SEARCH_GROUP_ORDER.filter((type) => buckets.has(type)).map((type) => ({
    type,
    results: buckets.get(type)!,
  }));
}

/** Primary display line for a search hit. */
export function searchResultTitle(type: SearchEntityType, row: GlobalSearchResult): string {
  if (row.title) return row.title;
  if (row.label) return row.label;
  switch (type) {
    case 'asset':
      return row.assetTag ?? row.tag ?? row.serialNumber ?? row.id.slice(0, 8);
    case 'item':
      return row.name ?? row.sku ?? row.id.slice(0, 8);
    case 'employee': {
      const name =
        row.displayName ?? [row.firstName, row.lastName].filter(Boolean).join(' ');
      return name || (row.employeeNumber ?? row.id.slice(0, 8));
    }
    case 'supplier':
      return row.tradeName ?? row.legalName ?? row.name ?? row.code ?? row.id.slice(0, 8);
    case 'purchase_order':
      return row.poNumber ?? row.number ?? row.id.slice(0, 8);
    case 'goods_receipt':
      return row.receiptNumber ?? row.number ?? row.id.slice(0, 8);
    case 'work_order':
      return row.workOrderNumber ?? row.number ?? row.id.slice(0, 8);
    case 'stock_transaction':
      return row.transactionNumber ?? row.number ?? row.id.slice(0, 8);
    case 'transfer':
      return row.transferNumber ?? row.number ?? row.id.slice(0, 8);
    case 'lot':
      return row.number ?? row.code ?? row.name ?? row.id.slice(0, 8);
  }
}

/** Secondary display line for a search hit (item, serial, supplier, status…). */
export function searchResultSubtitle(
  type: SearchEntityType,
  row: GlobalSearchResult,
): string | null {
  const parts: string[] = [];
  if (row.subtitle || row.description) {
    // Server-computed context line (SearchResult.subtitle) + status.
    parts.push(row.subtitle ?? row.description ?? '');
  } else if (type === 'asset') {
    if (row.item?.name || row.item?.sku) parts.push(row.item.name ?? row.item.sku ?? '');
    if (row.serialNumber) parts.push(`SN ${row.serialNumber}`);
  } else if (type === 'item') {
    if (row.sku && row.name) parts.push(row.sku);
  } else if (type === 'employee') {
    if (row.employeeNumber) parts.push(row.employeeNumber);
  } else if (type === 'supplier') {
    if (row.code) parts.push(row.code);
  } else if (type === 'purchase_order' || type === 'goods_receipt') {
    const supplier = row.supplier;
    if (supplier) {
      parts.push(supplier.tradeName ?? supplier.legalName ?? supplier.code ?? '');
    }
  } else if (type === 'work_order' || type === 'stock_transaction' || type === 'transfer') {
    if (row.item?.name) parts.push(row.item.name);
  } else if (type === 'lot') {
    if (row.item?.name || row.item?.sku) parts.push(row.item.name ?? row.item.sku ?? '');
  }
  if (row.status) {
    const spaced = row.status.replace(/[_-]+/g, ' ').toLowerCase();
    parts.push(spaced.charAt(0).toUpperCase() + spaced.slice(1));
  }
  const text = parts.filter(Boolean).join(' · ');
  return text || null;
}
