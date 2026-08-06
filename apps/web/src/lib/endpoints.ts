/**
 * Typed functions for the Phase 1–3 API surface
 * (docs/api-outline.md §2–4). All paths are relative to the /api/v1 base
 * handled by src/lib/api.ts.
 */
import type {
  EmployeeStatus,
  ItemBusinessCategory,
  Paginated,
  PurchaseOrderStatus,
  SessionUser,
  StockTransactionStatus,
  StockTransactionType,
  TrackingMethod,
  TransferStatus,
} from '@gemerp/shared';
import { api, fetchBinary, postBinary, type QueryParams } from './api';
import { normalizeSearchResults, normalizeUnreadCount, type GlobalSearchGroup } from './types';
import type {
  AppNotification,
  ApprovalDelegation,
  ApprovalRequest,
  ApprovalWorkflow,
  Asset,
  Attachment,
  CountLine,
  CountSession,
  AssetAssignment,
  AssetHistoryEntry,
  AssetMeterReading,
  AuditLogEntry,
  CustodyAssignment,
  EmployeeAcknowledgmentsView,
  Branch,
  Brand,
  Department,
  Employee,
  EmployeeSeparationResult,
  ImportCommitResult,
  ImportValidationResult,
  Item,
  ItemBarcode,
  ItemCategory,
  ItemSubcategory,
  ItemWarehouseSetting,
  LookupValue,
  Lot,
  LowStockRow,
  MaintenancePlan,
  Manufacturer,
  Me,
  OutstandingAsset,
  PermissionCatalogGroup,
  Position,
  GoodsReceipt,
  PurchaseHistoryRow,
  PurchaseOrder,
  ResolvedBarcode,
  Role,
  ScanResolution,
  SessionInfo,
  StockBalance,
  StockLedgerEntry,
  StockTransaction,
  StorageLocation,
  Supplier,
  SupplierContact,
  SupplierHistoryRollup,
  Transfer,
  Uom,
  UomConversion,
  UserRecord,
  Warehouse,
  WorkOrder,
  WorkOrderPart,
} from './types';

/* ------------------------------- Pagination ------------------------------ */

export interface ListParams extends QueryParams {
  page?: number;
  pageSize?: number;
  sort?: string;
}

/* --------------------------------- Auth ---------------------------------- */

export function login(body: { email: string; password: string }): Promise<SessionUser> {
  return api.post<SessionUser>('/auth/login', body);
}

export function logout(): Promise<void> {
  return api.post<void>('/auth/logout');
}

export function fetchMe(signal?: AbortSignal): Promise<Me> {
  return api.get<Me>('/auth/me', undefined, signal);
}

export function changePassword(body: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  return api.post<void>('/auth/change-password', body);
}

export function listMySessions(signal?: AbortSignal): Promise<SessionInfo[]> {
  return api.get<SessionInfo[]>('/auth/sessions', undefined, signal);
}

export function revokeMySession(sessionId: string): Promise<void> {
  return api.delete<void>(`/auth/sessions/${sessionId}`);
}

/* --------------------------------- Users --------------------------------- */

export interface UserListParams extends ListParams {
  q?: string;
  roleId?: string;
  branchId?: string;
  isActive?: boolean;
}

export function listUsers(params: UserListParams, signal?: AbortSignal): Promise<Paginated<UserRecord>> {
  return api.get<Paginated<UserRecord>>('/users', params, signal);
}

export function getUser(id: string, signal?: AbortSignal): Promise<UserRecord> {
  return api.get<UserRecord>(`/users/${id}`, undefined, signal);
}

export function createUser(body: {
  email: string;
  displayName: string;
  password: string;
  roleIds?: string[];
  branchIds?: string[];
}): Promise<UserRecord> {
  return api.post<UserRecord>('/users', body);
}

export function updateUser(
  id: string,
  body: { email?: string; displayName?: string },
): Promise<UserRecord> {
  return api.patch<UserRecord>(`/users/${id}`, body);
}

export function activateUser(id: string): Promise<UserRecord> {
  return api.post<UserRecord>(`/users/${id}/activate`);
}

export function deactivateUser(id: string): Promise<UserRecord> {
  return api.post<UserRecord>(`/users/${id}/deactivate`);
}

export function setUserRoles(id: string, roleIds: string[]): Promise<UserRecord> {
  return api.put<UserRecord>(`/users/${id}/roles`, { roleIds });
}

export function setUserBranchAccess(id: string, branchIds: string[]): Promise<UserRecord> {
  return api.put<UserRecord>(`/users/${id}/branch-access`, { branchIds });
}

export function resetUserPassword(id: string, newPassword: string): Promise<void> {
  return api.post<void>(`/users/${id}/reset-password`, { newPassword });
}

/* --------------------------------- Roles --------------------------------- */

export interface RoleListParams extends ListParams {
  q?: string;
}

export function listRoles(params: RoleListParams = {}, signal?: AbortSignal): Promise<Paginated<Role>> {
  return api.get<Paginated<Role>>('/roles', params, signal);
}

export function getRole(id: string, signal?: AbortSignal): Promise<Role> {
  return api.get<Role>(`/roles/${id}`, undefined, signal);
}

export function createRole(body: {
  code: string;
  name: string;
  description?: string;
  permissions?: string[];
}): Promise<Role> {
  return api.post<Role>('/roles', body);
}

export function updateRole(
  id: string,
  body: { name?: string; description?: string },
): Promise<Role> {
  return api.patch<Role>(`/roles/${id}`, body);
}

export function setRolePermissions(id: string, permissions: string[]): Promise<Role> {
  return api.put<Role>(`/roles/${id}/permissions`, { permissions });
}

export function listPermissionCatalog(signal?: AbortSignal): Promise<PermissionCatalogGroup[]> {
  return api.get<PermissionCatalogGroup[]>('/permissions', undefined, signal);
}

/* ------------------------------ Organization ----------------------------- */

export interface BranchListParams extends ListParams {
  isActive?: boolean;
}

export function listBranches(
  params: BranchListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Branch>> {
  return api.get<Paginated<Branch>>('/branches', params, signal);
}

export function getBranch(id: string, signal?: AbortSignal): Promise<Branch> {
  return api.get<Branch>(`/branches/${id}`, undefined, signal);
}

export function createBranch(body: {
  code: string;
  name: string;
  address?: string;
  timezone?: string;
}): Promise<Branch> {
  return api.post<Branch>('/branches', body);
}

export function updateBranch(
  id: string,
  body: { code?: string; name?: string; address?: string; timezone?: string },
): Promise<Branch> {
  return api.patch<Branch>(`/branches/${id}`, body);
}

export function activateBranch(id: string): Promise<Branch> {
  return api.post<Branch>(`/branches/${id}/activate`);
}

export function deactivateBranch(id: string): Promise<Branch> {
  return api.post<Branch>(`/branches/${id}/deactivate`);
}

export function listWarehouses(
  branchId: string,
  params: ListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Warehouse>> {
  return api.get<Paginated<Warehouse>>(`/branches/${branchId}/warehouses`, params, signal);
}

export function createWarehouse(
  branchId: string,
  body: { code: string; name: string; description?: string },
): Promise<Warehouse> {
  return api.post<Warehouse>(`/branches/${branchId}/warehouses`, body);
}

export function getWarehouse(id: string, signal?: AbortSignal): Promise<Warehouse> {
  return api.get<Warehouse>(`/warehouses/${id}`, undefined, signal);
}

export function updateWarehouse(
  id: string,
  body: { code?: string; name?: string; description?: string; isActive?: boolean },
): Promise<Warehouse> {
  return api.patch<Warehouse>(`/warehouses/${id}`, body);
}

export function listStorageLocations(
  warehouseId: string,
  params: ListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<StorageLocation>> {
  return api.get<Paginated<StorageLocation>>(
    `/warehouses/${warehouseId}/storage-locations`,
    params,
    signal,
  );
}

export function createStorageLocation(
  warehouseId: string,
  body: { code: string; name: string; parentId?: string; kind?: string },
): Promise<StorageLocation> {
  return api.post<StorageLocation>(`/warehouses/${warehouseId}/storage-locations`, body);
}

export function getStorageLocation(id: string, signal?: AbortSignal): Promise<StorageLocation> {
  return api.get<StorageLocation>(`/storage-locations/${id}`, undefined, signal);
}

export function updateStorageLocation(
  id: string,
  body: { code?: string; name?: string; parentId?: string | null; kind?: string; isActive?: boolean },
): Promise<StorageLocation> {
  return api.patch<StorageLocation>(`/storage-locations/${id}`, body);
}

/* ------------------------------- Audit log ------------------------------- */

export interface AuditLogListParams extends ListParams {
  actor?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  branchId?: string;
  from?: string;
  to?: string;
}

export function listAuditLogs(
  params: AuditLogListParams,
  signal?: AbortSignal,
): Promise<Paginated<AuditLogEntry>> {
  return api.get<Paginated<AuditLogEntry>>('/audit-logs', params, signal);
}

/* ========================================================================== */
/* Phase 2 — Employees, lookups, and catalog (docs/api-outline.md §3)         */
/* ========================================================================== */

/* ------------------------------- Employees ------------------------------- */

export interface EmployeeListParams extends ListParams {
  q?: string;
  branchId?: string;
  departmentId?: string;
  positionId?: string;
  status?: EmployeeStatus | string;
}

export interface EmployeeWriteBody {
  employeeNumber?: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  displayName?: string | null;
  workEmail?: string | null;
  workPhone?: string | null;
  branchId?: string;
  departmentId?: string | null;
  positionId?: string | null;
  supervisorId?: string | null;
  status?: EmployeeStatus;
  startDate?: string | null;
  notes?: string | null;
  userId?: string | null;
}

export function listEmployees(
  params: EmployeeListParams,
  signal?: AbortSignal,
): Promise<Paginated<Employee>> {
  return api.get<Paginated<Employee>>('/employees', params, signal);
}

export function getEmployee(id: string, signal?: AbortSignal): Promise<Employee> {
  return api.get<Employee>(`/employees/${id}`, undefined, signal);
}

export function createEmployee(body: EmployeeWriteBody): Promise<Employee> {
  return api.post<Employee>('/employees', body);
}

/** PATCH requires the current `version` (409 VERSION_CONFLICT when stale). */
export function updateEmployee(
  id: string,
  body: EmployeeWriteBody & { version?: number },
): Promise<Employee> {
  return api.patch<Employee>(`/employees/${id}`, body);
}

export function activateEmployee(id: string): Promise<Employee> {
  return api.post<Employee>(`/employees/${id}/activate`);
}

export function deactivateEmployee(
  id: string,
  body: { status: EmployeeStatus; reason: string },
): Promise<Employee> {
  return api.post<Employee>(`/employees/${id}/deactivate`, body);
}

export function separateEmployee(
  id: string,
  body: { separationDate: string },
): Promise<EmployeeSeparationResult> {
  return api.post<EmployeeSeparationResult>(`/employees/${id}/separate`, body);
}

export function archiveEmployee(id: string): Promise<Employee> {
  return api.post<Employee>(`/employees/${id}/archive`);
}

/** Phase 3 endpoint — the caller must treat a 404 as "not available yet". */
export function listEmployeeAssets(
  id: string,
  signal?: AbortSignal,
): Promise<Paginated<OutstandingAsset> | OutstandingAsset[]> {
  return api.get<Paginated<OutstandingAsset> | OutstandingAsset[]>(
    `/employees/${id}/assets`,
    undefined,
    signal,
  );
}

/* --------------------- Departments & positions (§3.2) -------------------- */

export interface LookupListParams extends ListParams {
  q?: string;
  isActive?: boolean;
}

export function listDepartments(
  params: LookupListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Department>> {
  return api.get<Paginated<Department>>('/departments', params, signal);
}

export function createDepartment(body: {
  code: string;
  name: string;
  headEmployeeId?: string | null;
}): Promise<Department> {
  return api.post<Department>('/departments', body);
}

export function updateDepartment(
  id: string,
  body: { code?: string; name?: string; headEmployeeId?: string | null; isActive?: boolean },
): Promise<Department> {
  return api.patch<Department>(`/departments/${id}`, body);
}

export function listPositions(
  params: LookupListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Position>> {
  return api.get<Paginated<Position>>('/positions', params, signal);
}

export function createPosition(body: { code: string; name: string }): Promise<Position> {
  return api.post<Position>('/positions', body);
}

export function updatePosition(
  id: string,
  body: { code?: string; name?: string; isActive?: boolean },
): Promise<Position> {
  return api.patch<Position>(`/positions/${id}`, body);
}

/* ---------------------- Generic lookup values (§3.3) --------------------- */

/** Path segments accepted by /lookups/:type. */
export type LookupType =
  | 'asset-conditions'
  | 'asset-types'
  | 'transaction-reasons'
  | 'adjustment-reasons'
  | 'disposal-methods'
  | 'maintenance-types'
  | 'maintenance-priorities'
  | 'work-order-statuses'
  | 'supplier-categories'
  | 'document-types'
  | 'notification-types';

export interface LookupValueWriteBody {
  code?: string;
  name?: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export function listLookupValues(
  type: LookupType,
  params: LookupListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<LookupValue>> {
  return api.get<Paginated<LookupValue>>(`/lookups/${type}`, params, signal);
}

export function createLookupValue(type: LookupType, body: LookupValueWriteBody): Promise<LookupValue> {
  return api.post<LookupValue>(`/lookups/${type}`, body);
}

export function updateLookupValue(
  type: LookupType,
  id: string,
  body: LookupValueWriteBody,
): Promise<LookupValue> {
  return api.patch<LookupValue>(`/lookups/${type}/${id}`, body);
}

/* ---------------------- UOMs & conversions (§3.4) ------------------------ */

export function listUoms(
  params: LookupListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Uom>> {
  return api.get<Paginated<Uom>>('/uoms', params, signal);
}

export function createUom(body: {
  code: string;
  name: string;
  description?: string | null;
}): Promise<Uom> {
  return api.post<Uom>('/uoms', body);
}

export function updateUom(
  id: string,
  body: { code?: string; name?: string; description?: string | null; isActive?: boolean },
): Promise<Uom> {
  return api.patch<Uom>(`/uoms/${id}`, body);
}

export function listUomConversions(
  params: ListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<UomConversion>> {
  return api.get<Paginated<UomConversion>>('/uom-conversions', params, signal);
}

export function createUomConversion(body: {
  fromUomId: string;
  toUomId: string;
  factor: string | number;
  /** Omit for a global conversion; set for an item-specific override. */
  itemId?: string;
}): Promise<UomConversion> {
  return api.post<UomConversion>('/uom-conversions', body);
}

export function deleteUomConversion(id: string): Promise<void> {
  return api.delete<void>(`/uom-conversions/${id}`);
}

export function updateUomConversion(
  id: string,
  body: { fromUomId?: string; toUomId?: string; factor?: string | number; isActive?: boolean },
): Promise<UomConversion> {
  return api.patch<UomConversion>(`/uom-conversions/${id}`, body);
}

/* ----------- Brands, manufacturers, item categories (§3.5) --------------- */

export function listBrands(
  params: LookupListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Brand>> {
  return api.get<Paginated<Brand>>('/brands', params, signal);
}

export function createBrand(body: { code: string; name: string }): Promise<Brand> {
  return api.post<Brand>('/brands', body);
}

export function updateBrand(
  id: string,
  body: { code?: string; name?: string; isActive?: boolean },
): Promise<Brand> {
  return api.patch<Brand>(`/brands/${id}`, body);
}

export function listManufacturers(
  params: LookupListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<Manufacturer>> {
  return api.get<Paginated<Manufacturer>>('/manufacturers', params, signal);
}

export function createManufacturer(body: { code: string; name: string }): Promise<Manufacturer> {
  return api.post<Manufacturer>('/manufacturers', body);
}

export function updateManufacturer(
  id: string,
  body: { code?: string; name?: string; isActive?: boolean },
): Promise<Manufacturer> {
  return api.patch<Manufacturer>(`/manufacturers/${id}`, body);
}

export function listItemCategories(
  params: LookupListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<ItemCategory>> {
  return api.get<Paginated<ItemCategory>>('/item-categories', params, signal);
}

export function createItemCategory(body: {
  code: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
}): Promise<ItemCategory> {
  return api.post<ItemCategory>('/item-categories', body);
}

export function updateItemCategory(
  id: string,
  body: {
    code?: string;
    name?: string;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<ItemCategory> {
  return api.patch<ItemCategory>(`/item-categories/${id}`, body);
}

export function listItemSubcategories(
  categoryId: string,
  params: LookupListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<ItemSubcategory>> {
  return api.get<Paginated<ItemSubcategory>>(
    `/item-categories/${categoryId}/subcategories`,
    params,
    signal,
  );
}

export function createItemSubcategory(
  categoryId: string,
  body: { code: string; name: string; description?: string | null; sortOrder?: number },
): Promise<ItemSubcategory> {
  return api.post<ItemSubcategory>(`/item-categories/${categoryId}/subcategories`, body);
}

export function updateItemSubcategory(
  id: string,
  body: {
    code?: string;
    name?: string;
    description?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  },
): Promise<ItemSubcategory> {
  return api.patch<ItemSubcategory>(`/item-subcategories/${id}`, body);
}

/* --------------------------- Item master (§3.6) -------------------------- */

export interface ItemListParams extends ListParams {
  q?: string;
  businessCategory?: ItemBusinessCategory | string;
  trackingMethod?: TrackingMethod | string;
  categoryId?: string;
  brandId?: string;
  isActive?: boolean;
  barcode?: string;
}

export interface ItemWriteBody {
  sku?: string;
  name?: string;
  description?: string | null;
  businessCategory?: ItemBusinessCategory;
  trackingMethod?: TrackingMethod;
  categoryId?: string | null;
  subcategoryId?: string | null;
  brandId?: string | null;
  manufacturerId?: string | null;
  model?: string | null;
  baseUomId?: string;
  purchaseUomId?: string | null;
  issueUomId?: string | null;
  standardCost?: string | null;
  lastPurchaseCost?: string | null;
  isLotTracked?: boolean;
  isExpiryTracked?: boolean;
  requiresSerialNumber?: boolean;
  isMaintainable?: boolean;
  notes?: string | null;
  uomConversions?: Array<{ fromUomId: string; toUomId: string; factor: string | number }>;
}

export function listItems(params: ItemListParams, signal?: AbortSignal): Promise<Paginated<Item>> {
  return api.get<Paginated<Item>>('/items', params, signal);
}

export function getItem(id: string, signal?: AbortSignal): Promise<Item> {
  return api.get<Item>(`/items/${id}`, undefined, signal);
}

export function createItem(body: ItemWriteBody): Promise<Item> {
  return api.post<Item>('/items', body);
}

/** PATCH requires the current `version` (409 VERSION_CONFLICT when stale). */
export function updateItem(id: string, body: ItemWriteBody & { version?: number }): Promise<Item> {
  return api.patch<Item>(`/items/${id}`, body);
}

export function activateItem(id: string): Promise<Item> {
  return api.post<Item>(`/items/${id}/activate`);
}

export function deactivateItem(id: string): Promise<Item> {
  return api.post<Item>(`/items/${id}/deactivate`);
}

export function listItemBarcodes(
  itemId: string,
  signal?: AbortSignal,
): Promise<Paginated<ItemBarcode> | ItemBarcode[]> {
  return api.get<Paginated<ItemBarcode> | ItemBarcode[]>(`/items/${itemId}/barcodes`, undefined, signal);
}

export function addItemBarcode(
  itemId: string,
  body: { barcode: string; barcodeType?: string | null; isPrimary?: boolean },
): Promise<ItemBarcode> {
  return api.post<ItemBarcode>(`/items/${itemId}/barcodes`, body);
}

/** Soft-archives the mapping (DELETE per contract §3.6). */
export function archiveItemBarcode(itemId: string, barcodeId: string): Promise<void> {
  return api.delete<void>(`/items/${itemId}/barcodes/${barcodeId}`);
}

export function listItemWarehouseSettings(
  itemId: string,
  signal?: AbortSignal,
): Promise<Paginated<ItemWarehouseSetting> | ItemWarehouseSetting[]> {
  return api.get<Paginated<ItemWarehouseSetting> | ItemWarehouseSetting[]>(
    `/items/${itemId}/warehouse-settings`,
    undefined,
    signal,
  );
}

export function upsertItemWarehouseSetting(
  itemId: string,
  warehouseId: string,
  body: {
    reorderLevel?: string | null;
    reorderQuantity?: string | null;
    minQuantity?: string | null;
    maxQuantity?: string | null;
  },
): Promise<ItemWarehouseSetting> {
  return api.put<ItemWarehouseSetting>(`/items/${itemId}/warehouse-settings/${warehouseId}`, body);
}

export function resolveBarcode(code: string, signal?: AbortSignal): Promise<ResolvedBarcode> {
  return api.get<ResolvedBarcode>('/items/resolve-barcode', { code }, signal);
}

/** Normalize endpoints that may return either a plain array or a paginated envelope. */
export function unwrapList<T>(payload: Paginated<T> | T[]): T[] {
  return Array.isArray(payload) ? payload : payload.data;
}

/* ------------------------------ Imports (§3.7) --------------------------- */

/** Import types available in Phase 2 (CSV only for now). */
export type ImportType = 'employees' | 'items' | 'lookups';

export function importTemplatePath(type: ImportType): string {
  return `/imports/templates/${type}`;
}

export function validateImport(type: ImportType, file: File): Promise<ImportValidationResult> {
  const form = new FormData();
  form.append('file', file, file.name);
  return api.postForm<ImportValidationResult>(`/imports/${type}/validate`, form);
}

export function commitImport(
  type: ImportType,
  body: { stagingId: string; mode: 'strict' | 'partial' },
): Promise<ImportCommitResult> {
  return api.post<ImportCommitResult>(`/imports/${type}/commit`, body);
}

export function getImport(id: string, signal?: AbortSignal): Promise<ImportCommitResult> {
  return api.get<ImportCommitResult>(`/imports/${id}`, undefined, signal);
}

/* ========================================================================== */
/* Phase 3 — Inventory, stock ledger, serialized assets (docs/api-outline §4) */
/* ========================================================================== */

/* ------------------- Stock transactions (contract §4.1) ------------------- */

export interface StockTransactionListParams extends ListParams {
  type?: StockTransactionType | string;
  status?: StockTransactionStatus | string;
  branchId?: string;
  warehouseId?: string;
  itemId?: string;
  number?: string;
  from?: string;
  to?: string;
}

export interface StockTransactionLineInput {
  itemId: string;
  uomId: string;
  quantity: string | number;
  lotId?: string;
  /** Create-a-new-lot input for LOT-tracked items without an existing lot. */
  lotInput?: { lotNumber?: string; expiryDate?: string | null; manufactureDate?: string | null };
  locationId?: string;
  /** Only sent when the caller holds inventory.view_cost. */
  unitCost?: string | number;
}

export interface StockTransactionCreateBody {
  type: StockTransactionType | string;
  branchId: string;
  warehouseId: string;
  lines: StockTransactionLineInput[];
  reasonCode?: string;
  employeeId?: string;
  departmentId?: string;
  workOrderId?: string;
  notes?: string;
}

export function listStockTransactions(
  params: StockTransactionListParams,
  signal?: AbortSignal,
): Promise<Paginated<StockTransaction>> {
  return api.get<Paginated<StockTransaction>>('/stock-transactions', params, signal);
}

export function getStockTransaction(id: string, signal?: AbortSignal): Promise<StockTransaction> {
  return api.get<StockTransaction>(`/stock-transactions/${id}`, undefined, signal);
}

export function createStockTransaction(body: StockTransactionCreateBody): Promise<StockTransaction> {
  return api.post<StockTransaction>('/stock-transactions', body);
}

/** Draft-only edit; requires the current `version`. */
export function updateStockTransaction(
  id: string,
  body: Partial<StockTransactionCreateBody> & { version: number },
): Promise<StockTransaction> {
  return api.patch<StockTransaction>(`/stock-transactions/${id}`, body);
}

export function submitStockTransaction(id: string): Promise<StockTransaction> {
  return api.post<StockTransaction>(`/stock-transactions/${id}/submit`);
}

export function approveStockTransaction(id: string): Promise<StockTransaction> {
  return api.post<StockTransaction>(`/stock-transactions/${id}/approve`);
}

export function rejectStockTransaction(id: string, comment: string): Promise<StockTransaction> {
  return api.post<StockTransaction>(`/stock-transactions/${id}/reject`, { comment });
}

/** Posting requires an Idempotency-Key (contract §1.5). */
export function postStockTransaction(id: string, idempotencyKey: string): Promise<StockTransaction> {
  return api.post<StockTransaction>(`/stock-transactions/${id}/post`, undefined, { idempotencyKey });
}

export function cancelStockTransaction(id: string, reason: string): Promise<StockTransaction> {
  return api.post<StockTransaction>(`/stock-transactions/${id}/cancel`, { reason });
}

/** Reversal requires a reason and an Idempotency-Key (contract §1.5). */
export function reverseStockTransaction(
  id: string,
  reason: string,
  idempotencyKey: string,
): Promise<StockTransaction> {
  return api.post<StockTransaction>(
    `/stock-transactions/${id}/reverse`,
    { reason },
    { idempotencyKey },
  );
}

/* ------------- Balances, ledger, lots, low stock (contract §4.2) ---------- */

export interface StockBalanceListParams extends ListParams {
  branchId?: string;
  warehouseId?: string;
  locationId?: string;
  itemId?: string;
  lotId?: string;
}

export function listStockBalances(
  params: StockBalanceListParams,
  signal?: AbortSignal,
): Promise<Paginated<StockBalance>> {
  return api.get<Paginated<StockBalance>>('/stock-balances', params, signal);
}

export interface StockLedgerListParams extends ListParams {
  itemId?: string;
  warehouseId?: string;
  locationId?: string;
  lotId?: string;
  type?: StockTransactionType | string;
  from?: string;
  to?: string;
}

export function listStockLedger(
  params: StockLedgerListParams,
  signal?: AbortSignal,
): Promise<Paginated<StockLedgerEntry>> {
  return api.get<Paginated<StockLedgerEntry>>('/stock-ledger', params, signal);
}

/** Per-item balance rollup across accessible warehouses. */
export function getItemStock(
  itemId: string,
  signal?: AbortSignal,
): Promise<Paginated<StockBalance> | StockBalance[]> {
  return api.get<Paginated<StockBalance> | StockBalance[]>(`/items/${itemId}/stock`, undefined, signal);
}

export interface LotListParams extends ListParams {
  itemId?: string;
  warehouseId?: string;
  expiresBefore?: string;
  status?: string;
}

export function listLots(params: LotListParams, signal?: AbortSignal): Promise<Paginated<Lot>> {
  return api.get<Paginated<Lot>>('/lots', params, signal);
}

export function getLot(id: string, signal?: AbortSignal): Promise<Lot> {
  return api.get<Lot>(`/lots/${id}`, undefined, signal);
}

export interface LowStockListParams extends ListParams {
  branchId?: string;
  warehouseId?: string;
}

export function listLowStock(
  params: LowStockListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<LowStockRow> | LowStockRow[]> {
  return api.get<Paginated<LowStockRow> | LowStockRow[]>('/stock-alerts/low-stock', params, signal);
}

/** Total row count of a maybe-paginated list payload. */
export function listTotal<T>(payload: Paginated<T> | T[]): number {
  return Array.isArray(payload) ? payload.length : payload.meta.total;
}

/* ------------------- Serialized assets (contract §4.3) -------------------- */

export interface AssetListParams extends ListParams {
  q?: string;
  branchId?: string;
  warehouseId?: string;
  status?: string;
  conditionId?: string;
  itemId?: string;
  categoryId?: string;
  custodianEmployeeId?: string;
  departmentId?: string;
  /** Warranty ends within N days (server filters warrantyEndDate ≤ now+N). */
  warrantyExpiringDays?: number;
}

export interface AssetRegisterBody {
  itemId: string;
  branchId: string;
  warehouseId?: string;
  storageLocationId?: string;
  /** Bulk registration: create N draft assets in one call (max 100). */
  quantity?: number;
  serialNumber?: string;
  serialNumbers?: string[];
  conditionId?: string;
  criticalityId?: string;
  departmentId?: string;
  acquisitionDate?: string;
  /** Only sent when the caller holds asset.view_cost. */
  acquisitionCost?: string;
  supplierId?: string;
  warrantyStartDate?: string;
  warrantyEndDate?: string;
  nextMaintenanceAt?: string;
  notes?: string;
  initialStatus?: 'DRAFT' | 'AVAILABLE';
}

export function listAssets(params: AssetListParams, signal?: AbortSignal): Promise<Paginated<Asset>> {
  return api.get<Paginated<Asset>>('/assets', params, signal);
}

export function getAsset(id: string, signal?: AbortSignal): Promise<Asset> {
  return api.get<Asset>(`/assets/${id}`, undefined, signal);
}

/** Register one or more Draft assets; the server may return one or many. */
export function registerAsset(body: AssetRegisterBody): Promise<Asset | Asset[]> {
  return api.post<Asset | Asset[]>('/assets', body);
}

export function updateAsset(
  id: string,
  body: Record<string, unknown> & { version: number },
): Promise<Asset> {
  return api.patch<Asset>(`/assets/${id}`, body);
}

export function activateAsset(id: string): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/activate`);
}

export interface AssetAssignBody {
  employeeId?: string;
  departmentId?: string;
  projectRef?: string;
  locationId?: string;
  expectedReturnDate?: string;
  /** Condition lookup id (asset-conditions). */
  conditionId: string;
  notes?: string;
}

/** Assign requires an Idempotency-Key (contract §1.5). */
export function assignAsset(id: string, body: AssetAssignBody, idempotencyKey: string): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/assign`, body, { idempotencyKey });
}

export function acknowledgeAsset(id: string, notes?: string): Promise<unknown> {
  return api.post<unknown>(`/assets/${id}/acknowledge`, notes ? { notes } : {});
}

export interface AssetReturnBody {
  conditionId: string;
  /** Damaged return routes the asset to Damaged instead of Available. */
  damaged?: boolean;
  warehouseId?: string;
  locationId?: string;
  notes?: string;
}

/** Return requires an Idempotency-Key (contract §1.5). */
export function returnAsset(id: string, body: AssetReturnBody, idempotencyKey: string): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/return`, body, { idempotencyKey });
}

export interface AssetTransferBody {
  /** Employee-to-employee reassignment when set. */
  employeeId?: string;
  branchId?: string;
  warehouseId?: string;
  locationId?: string;
  conditionId?: string;
  expectedReturnDate?: string;
  notes?: string;
}

/** Reassignment or location/warehouse/branch move. */
export function transferAssetAction(
  id: string,
  body: AssetTransferBody,
  idempotencyKey: string,
): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/transfer`, body, { idempotencyKey });
}

export function reserveAsset(id: string): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/reserve`);
}

export function releaseAsset(id: string): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/release`);
}

export function sendAssetToInspection(id: string, notes?: string): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/send-to-inspection`, notes ? { notes } : {});
}

export interface AssetInspectBody {
  outcome: 'PASS' | 'FAIL';
  conditionId: string;
  /** Findings — required when the inspection fails. */
  notes?: string;
  maintenanceRequired?: boolean;
}

export function inspectAsset(id: string, body: AssetInspectBody): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/inspect`, body);
}

export function sendAssetToMaintenance(id: string, notes?: string): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/send-to-maintenance`, notes ? { notes } : {});
}

export function reportAssetDamage(
  id: string,
  body: { description: string; conditionId?: string },
): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/report-damage`, body);
}

export function reportAssetLoss(id: string, body: { description: string }): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/report-loss`, body);
}

export function recoverAsset(id: string, body: { reason: string }): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/recover`, body);
}

export function retireAsset(id: string, body: { reason: string }): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/retire`, body);
}

/** Disposal requires an Idempotency-Key (contract §1.5). */
export function disposeAsset(
  id: string,
  body: { disposalMethodId: string; reason: string },
  idempotencyKey: string,
): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/dispose`, body, { idempotencyKey });
}

/** Disposal reversal requires an Idempotency-Key (contract §1.5). */
export function reverseAssetDisposal(
  id: string,
  body: { reason: string },
  idempotencyKey: string,
): Promise<Asset> {
  return api.post<Asset>(`/assets/${id}/reverse-disposal`, body, { idempotencyKey });
}

export function listAssetHistory(
  id: string,
  signal?: AbortSignal,
): Promise<Paginated<AssetHistoryEntry> | AssetHistoryEntry[]> {
  return api.get<Paginated<AssetHistoryEntry> | AssetHistoryEntry[]>(
    `/assets/${id}/history`,
    undefined,
    signal,
  );
}

export function listAssetAssignments(
  id: string,
  signal?: AbortSignal,
): Promise<Paginated<AssetAssignment> | AssetAssignment[]> {
  return api.get<Paginated<AssetAssignment> | AssetAssignment[]>(
    `/assets/${id}/assignments`,
    undefined,
    signal,
  );
}

/** Fetch the rendered label (`svg` default, or `png`; sizes `2x1` / `3x2`). */
export function fetchAssetLabel(
  id: string,
  params: { format?: 'svg' | 'png'; size?: '2x1' | '3x2' } = {},
  signal?: AbortSignal,
): Promise<{ blob: Blob; contentType: string }> {
  return fetchBinary(`/assets/${id}/label`, params, signal);
}

/**
 * POST /assets/labels/batch — one printable HTML sheet of labels for up to
 * 100 assets (requires asset.print).
 */
export function fetchAssetLabelSheet(
  assetIds: string[],
  size: '2x1' | '3x2' = '2x1',
): Promise<{ blob: Blob; contentType: string }> {
  return postBinary('/assets/labels/batch', { assetIds, size });
}

/* --------------- Employee custody & acknowledgments (§3.1 P3) ------------- */

/** GET /employees/:id/assets — open custody assignments with nested asset. */
export function listEmployeeCustody(
  id: string,
  signal?: AbortSignal,
): Promise<Paginated<CustodyAssignment> | CustodyAssignment[]> {
  return api.get<Paginated<CustodyAssignment> | CustodyAssignment[]>(
    `/employees/${id}/assets`,
    undefined,
    signal,
  );
}

export function listEmployeeAcknowledgments(
  id: string,
  signal?: AbortSignal,
): Promise<EmployeeAcknowledgmentsView> {
  return api.get<EmployeeAcknowledgmentsView>(`/employees/${id}/acknowledgments`, undefined, signal);
}

/* -------------------------- Scanning (contract §4.4) ---------------------- */

export function resolveScanToken(token: string, signal?: AbortSignal): Promise<ScanResolution> {
  return api.get<ScanResolution>(`/scan/${encodeURIComponent(token)}`, undefined, signal);
}

export function resolveScanCode(code: string): Promise<ScanResolution> {
  return api.post<ScanResolution>('/scan/resolve', { code });
}

/* -------------------------- Transfers (contract §4.5) --------------------- */

export interface TransferListParams extends ListParams {
  status?: TransferStatus | string;
  sourceBranchId?: string;
  destinationBranchId?: string;
  kind?: string;
  from?: string;
  to?: string;
}

export interface TransferEndpointInput {
  branchId?: string;
  warehouseId?: string;
  locationId?: string;
}

/** Transfer documents move stock lines; asset moves use /assets/:id/transfer. */
export interface TransferLineInput {
  itemId: string;
  uomId: string;
  quantity: string | number;
  lotId?: string;
  notes?: string;
}

export interface TransferCreateBody {
  /** LOCATION | INTRA_BRANCH | INTER_BRANCH. */
  kind: string;
  transferDate?: string;
  source: TransferEndpointInput & { branchId: string; warehouseId: string };
  destination: TransferEndpointInput;
  lines: TransferLineInput[];
  reasonId?: string;
  notes?: string;
}

export function listTransfers(
  params: TransferListParams,
  signal?: AbortSignal,
): Promise<Paginated<Transfer>> {
  return api.get<Paginated<Transfer>>('/transfers', params, signal);
}

export function getTransfer(id: string, signal?: AbortSignal): Promise<Transfer> {
  return api.get<Transfer>(`/transfers/${id}`, undefined, signal);
}

export function createTransfer(body: TransferCreateBody): Promise<Transfer> {
  return api.post<Transfer>('/transfers', body);
}

export function updateTransfer(
  id: string,
  body: Partial<TransferCreateBody> & { version: number },
): Promise<Transfer> {
  return api.patch<Transfer>(`/transfers/${id}`, body);
}

export function submitTransfer(id: string): Promise<Transfer> {
  return api.post<Transfer>(`/transfers/${id}/submit`);
}

export function approveTransfer(id: string): Promise<Transfer> {
  return api.post<Transfer>(`/transfers/${id}/approve`);
}

export function rejectTransfer(id: string, comment: string): Promise<Transfer> {
  return api.post<Transfer>(`/transfers/${id}/reject`, { comment });
}

/** Dispatch requires an Idempotency-Key (contract §1.5). */
export function dispatchTransfer(id: string, idempotencyKey: string): Promise<Transfer> {
  return api.post<Transfer>(`/transfers/${id}/dispatch`, undefined, { idempotencyKey });
}

export interface TransferReceiveLineInput {
  lineId: string;
  received: string | number;
  damaged: string | number;
  short: string | number;
  rejected: string | number;
  notes?: string;
}

/** Receive requires an Idempotency-Key (contract §1.5). */
export function receiveTransfer(
  id: string,
  body: { lines: TransferReceiveLineInput[]; notes?: string },
  idempotencyKey: string,
): Promise<Transfer> {
  return api.post<Transfer>(`/transfers/${id}/receive`, body, { idempotencyKey });
}

export function cancelTransfer(id: string, reason: string): Promise<Transfer> {
  return api.post<Transfer>(`/transfers/${id}/cancel`, { reason });
}

/* ========================================================================== */
/* Phase 4 — Procurement (docs/api-outline.md §5)                             */
/* ========================================================================== */

/* ------------------------- Suppliers (contract §5.1) ---------------------- */

export interface SupplierListParams extends ListParams {
  q?: string;
  categoryId?: string;
  isActive?: boolean;
}

export interface SupplierWriteBody {
  code?: string;
  legalName?: string;
  tradeName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  taxId?: string | null;
  paymentTerms?: string | null;
  categoryId?: string | null;
  notes?: string | null;
}

export function listSuppliers(
  params: SupplierListParams,
  signal?: AbortSignal,
): Promise<Paginated<Supplier>> {
  return api.get<Paginated<Supplier>>('/suppliers', params, signal);
}

export function getSupplier(id: string, signal?: AbortSignal): Promise<Supplier> {
  return api.get<Supplier>(`/suppliers/${id}`, undefined, signal);
}

export function createSupplier(body: SupplierWriteBody): Promise<Supplier> {
  return api.post<Supplier>('/suppliers', body);
}

/** Supplier codes are permanent — never send `code` on PATCH. */
export function updateSupplier(id: string, body: Omit<SupplierWriteBody, 'code'>): Promise<Supplier> {
  return api.patch<Supplier>(`/suppliers/${id}`, body);
}

export function activateSupplier(id: string): Promise<Supplier> {
  return api.post<Supplier>(`/suppliers/${id}/activate`);
}

export function deactivateSupplier(id: string): Promise<Supplier> {
  return api.post<Supplier>(`/suppliers/${id}/deactivate`);
}

export function archiveSupplier(id: string): Promise<Supplier> {
  return api.post<Supplier>(`/suppliers/${id}/archive`);
}

export interface SupplierContactWriteBody {
  name?: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export function listSupplierContacts(
  supplierId: string,
  signal?: AbortSignal,
): Promise<Paginated<SupplierContact> | SupplierContact[]> {
  return api.get<Paginated<SupplierContact> | SupplierContact[]>(
    `/suppliers/${supplierId}/contacts`,
    undefined,
    signal,
  );
}

export function createSupplierContact(
  supplierId: string,
  body: SupplierContactWriteBody,
): Promise<SupplierContact> {
  return api.post<SupplierContact>(`/suppliers/${supplierId}/contacts`, body);
}

export function updateSupplierContact(
  supplierId: string,
  contactId: string,
  body: SupplierContactWriteBody,
): Promise<SupplierContact> {
  return api.patch<SupplierContact>(`/suppliers/${supplierId}/contacts/${contactId}`, body);
}

export function deleteSupplierContact(supplierId: string, contactId: string): Promise<void> {
  return api.delete<void>(`/suppliers/${supplierId}/contacts/${contactId}`);
}

/** Purchase & delivery history rollup (requires procurement.po.view). */
export function getSupplierHistory(
  supplierId: string,
  signal?: AbortSignal,
): Promise<SupplierHistoryRollup> {
  return api.get<SupplierHistoryRollup>(`/suppliers/${supplierId}/history`, undefined, signal);
}

/* ---------------------- Purchase orders (contract §5.2) ------------------- */

export interface PurchaseOrderListParams extends ListParams {
  status?: PurchaseOrderStatus | string;
  supplierId?: string;
  branchId?: string;
  warehouseId?: string;
  number?: string;
  from?: string;
  to?: string;
}

export interface PurchaseOrderLineInput {
  itemId: string;
  uomId: string;
  quantity: string | number;
  /** Money fields — only sent when the caller holds the cost permission. */
  unitPrice?: string | number;
  discount?: string | number;
  tax?: string | number;
  notes?: string;
}

export interface PurchaseOrderCreateBody {
  supplierId: string;
  branchId: string;
  destinationWarehouseId: string;
  orderDate: string;
  expectedDate?: string;
  currency?: string;
  lines: PurchaseOrderLineInput[];
  terms?: string;
  notes?: string;
}

export function listPurchaseOrders(
  params: PurchaseOrderListParams,
  signal?: AbortSignal,
): Promise<Paginated<PurchaseOrder>> {
  return api.get<Paginated<PurchaseOrder>>('/purchase-orders', params, signal);
}

export function getPurchaseOrder(id: string, signal?: AbortSignal): Promise<PurchaseOrder> {
  return api.get<PurchaseOrder>(`/purchase-orders/${id}`, undefined, signal);
}

export function createPurchaseOrder(body: PurchaseOrderCreateBody): Promise<PurchaseOrder> {
  return api.post<PurchaseOrder>('/purchase-orders', body);
}

/** Draft-only edit; requires the current `version` (409 VERSION_CONFLICT when stale). */
export function updatePurchaseOrder(
  id: string,
  body: Partial<PurchaseOrderCreateBody> & { version?: number },
): Promise<PurchaseOrder> {
  return api.patch<PurchaseOrder>(`/purchase-orders/${id}`, body);
}

export function submitPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return api.post<PurchaseOrder>(`/purchase-orders/${id}/submit`);
}

export function approvePurchaseOrder(id: string): Promise<PurchaseOrder> {
  return api.post<PurchaseOrder>(`/purchase-orders/${id}/approve`);
}

export function rejectPurchaseOrder(id: string, comment: string): Promise<PurchaseOrder> {
  return api.post<PurchaseOrder>(`/purchase-orders/${id}/reject`, { comment });
}

export function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrder> {
  return api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason });
}

/** Close (close-short needs a reason; a fully-received close may omit it). */
export function closePurchaseOrder(id: string, reason?: string): Promise<PurchaseOrder> {
  return api.post<PurchaseOrder>(`/purchase-orders/${id}/close`, reason ? { reason } : {});
}

export function listPurchaseOrderReceipts(
  id: string,
  signal?: AbortSignal,
): Promise<Paginated<GoodsReceipt> | GoodsReceipt[]> {
  return api.get<Paginated<GoodsReceipt> | GoodsReceipt[]>(
    `/purchase-orders/${id}/receipts`,
    undefined,
    signal,
  );
}

/* ----------------------- Goods receipts (contract §5.3) ------------------- */

export interface GoodsReceiptListParams extends ListParams {
  status?: string;
  purchaseOrderId?: string;
  supplierId?: string;
  branchId?: string;
  from?: string;
  to?: string;
}

export interface GoodsReceiptLotInput {
  lotNo?: string;
  mfgDate?: string;
  expiryDate?: string;
  qty: string | number;
}

export interface GoodsReceiptLineInput {
  poLineId: string;
  quantity: string | number;
  uomId: string;
  /** SERIAL items: one serial per received unit. */
  serials?: string[];
  /** LOT items: lot allocations summing to the received quantity. */
  lots?: GoodsReceiptLotInput[];
  locationId?: string;
  notes?: string;
}

export interface GoodsReceiptCreateBody {
  purchaseOrderId: string;
  deliveryRefNo?: string;
  invoiceRefNo?: string;
  receivedDate: string;
  lines: GoodsReceiptLineInput[];
  notes?: string;
}

export function listGoodsReceipts(
  params: GoodsReceiptListParams,
  signal?: AbortSignal,
): Promise<Paginated<GoodsReceipt>> {
  return api.get<Paginated<GoodsReceipt>>('/goods-receipts', params, signal);
}

export function getGoodsReceipt(id: string, signal?: AbortSignal): Promise<GoodsReceipt> {
  return api.get<GoodsReceipt>(`/goods-receipts/${id}`, undefined, signal);
}

export function createGoodsReceipt(body: GoodsReceiptCreateBody): Promise<GoodsReceipt> {
  return api.post<GoodsReceipt>('/goods-receipts', body);
}

/** Draft-only edit; requires the current `version`. */
export function updateGoodsReceipt(
  id: string,
  body: Partial<GoodsReceiptCreateBody> & { version?: number },
): Promise<GoodsReceipt> {
  return api.patch<GoodsReceipt>(`/goods-receipts/${id}`, body);
}

/** Posting requires an Idempotency-Key (contract §1.5). */
export function postGoodsReceipt(id: string, idempotencyKey: string): Promise<GoodsReceipt> {
  return api.post<GoodsReceipt>(`/goods-receipts/${id}/post`, undefined, { idempotencyKey });
}

export function cancelGoodsReceipt(id: string, reason: string): Promise<GoodsReceipt> {
  return api.post<GoodsReceipt>(`/goods-receipts/${id}/cancel`, { reason });
}

/** Reversal requires a reason and an Idempotency-Key (contract §1.5). */
export function reverseGoodsReceipt(
  id: string,
  reason: string,
  idempotencyKey: string,
): Promise<GoodsReceipt> {
  return api.post<GoodsReceipt>(`/goods-receipts/${id}/reverse`, { reason }, { idempotencyKey });
}

/* ------------------- Purchase history (contract §5.4) --------------------- */

export interface PurchaseHistoryParams extends ListParams {
  supplierId?: string;
  itemId?: string;
  branchId?: string;
  warehouseId?: string;
  purchaseOrderId?: string;
  receiptId?: string;
  status?: string;
  from?: string;
  to?: string;
}

export function listPurchaseHistory(
  params: PurchaseHistoryParams,
  signal?: AbortSignal,
): Promise<Paginated<PurchaseHistoryRow>> {
  return api.get<Paginated<PurchaseHistoryRow>>('/purchase-history', params, signal);
}

/* ========================================================================== */
/* Phase 5 — Maintenance (docs/api-outline.md §6)                             */
/* ========================================================================== */

/* ------------------- Maintenance plans (contract §6.1) -------------------- */

export interface MaintenancePlanListParams extends ListParams {
  q?: string;
  isActive?: boolean;
  /** Plans covering this asset. */
  assetId?: string;
  /** nextDueAt on or before (inclusive). */
  dueBefore?: string;
}

/** Checklist task — order comes from array position (no sequence field). */
export interface MaintenancePlanTaskInput {
  name: string;
  description?: string;
  isRequired?: boolean;
}

export interface MaintenancePlanWriteBody {
  /** Create only — business codes are immutable (auto-generated when omitted). */
  code?: string;
  name?: string;
  description?: string | null;
  maintenanceTypeId?: string;
  /** Frequency — exactly one of intervalDays / meterInterval / scheduleCron. */
  intervalDays?: number | null;
  meterInterval?: string | number | null;
  meterType?: string | null;
  scheduleCron?: string | null;
  assignedTeam?: string | null;
  vendorId?: string | null;
  estimatedDurationHours?: string | number | null;
  /** Only sent when the caller holds the maintenance cost permission. */
  estimatedCost?: string | number | null;
  reminderLeadDays?: number | null;
  /** Explicit first due date — required for cron-schedule plans. */
  nextDueAt?: string | null;
  /** Create only — covered assets (afterwards replaced via PUT :id/assets). */
  assetIds?: string[];
  tasks?: MaintenancePlanTaskInput[];
}

export function listMaintenancePlans(
  params: MaintenancePlanListParams,
  signal?: AbortSignal,
): Promise<Paginated<MaintenancePlan>> {
  return api.get<Paginated<MaintenancePlan>>('/maintenance-plans', params, signal);
}

export function getMaintenancePlan(id: string, signal?: AbortSignal): Promise<MaintenancePlan> {
  return api.get<MaintenancePlan>(`/maintenance-plans/${id}`, undefined, signal);
}

export function createMaintenancePlan(body: MaintenancePlanWriteBody): Promise<MaintenancePlan> {
  return api.post<MaintenancePlan>('/maintenance-plans', body);
}

/** PATCH requires the current `version` (409 VERSION_CONFLICT when stale). */
export function updateMaintenancePlan(
  id: string,
  body: MaintenancePlanWriteBody & { version?: number },
): Promise<MaintenancePlan> {
  return api.patch<MaintenancePlan>(`/maintenance-plans/${id}`, body);
}

export function activateMaintenancePlan(id: string): Promise<MaintenancePlan> {
  return api.post<MaintenancePlan>(`/maintenance-plans/${id}/activate`);
}

export function deactivateMaintenancePlan(id: string): Promise<MaintenancePlan> {
  return api.post<MaintenancePlan>(`/maintenance-plans/${id}/deactivate`);
}

/** Replaces the covered-asset set (contract §6.1 PUT :id/assets). */
export function setMaintenancePlanAssets(
  id: string,
  assetIds: string[],
): Promise<MaintenancePlan> {
  return api.put<MaintenancePlan>(`/maintenance-plans/${id}/assets`, { assetIds });
}

/* --------------------- Work orders (contract §6.2) ------------------------- */

export interface WorkOrderListParams extends ListParams {
  status?: string;
  /** MAINTENANCE_TYPE lookup id. */
  typeId?: string;
  /** MAINTENANCE_PRIORITY lookup id. */
  priorityId?: string;
  assetId?: string;
  branchId?: string;
  assignedToMe?: boolean;
  /** Open WOs whose planned window ends on or before this date. */
  dueBefore?: string;
  from?: string;
  to?: string;
  /** WO number contains (case-insensitive). */
  number?: string;
}

/** Creation requires the Draft→Open guard fields, so new WOs land on OPEN. */
export interface WorkOrderCreateBody {
  assetId: string;
  /** MAINTENANCE_TYPE lookup id. */
  typeId: string;
  /** MAINTENANCE_PRIORITY lookup id. */
  priorityId?: string;
  problem: string;
  reportedById?: string;
  planId?: string;
}

/** Open-editable fields (PATCH; requires the current `version`). */
export interface WorkOrderUpdateBody {
  typeId?: string;
  priorityId?: string | null;
  problem?: string;
  diagnosis?: string | null;
  actionTaken?: string | null;
  resolution?: string | null;
}

export function listWorkOrders(
  params: WorkOrderListParams,
  signal?: AbortSignal,
): Promise<Paginated<WorkOrder>> {
  return api.get<Paginated<WorkOrder>>('/maintenance-work-orders', params, signal);
}

export function getWorkOrder(id: string, signal?: AbortSignal): Promise<WorkOrder> {
  return api.get<WorkOrder>(`/maintenance-work-orders/${id}`, undefined, signal);
}

export function createWorkOrder(body: WorkOrderCreateBody): Promise<WorkOrder> {
  return api.post<WorkOrder>('/maintenance-work-orders', body);
}

/** PATCH requires the current `version` (409 VERSION_CONFLICT when stale). */
export function updateWorkOrder(
  id: string,
  body: WorkOrderUpdateBody & { version?: number },
): Promise<WorkOrder> {
  return api.patch<WorkOrder>(`/maintenance-work-orders/${id}`, body);
}

export interface WorkOrderAssignBody {
  /** Technician by user account (server resolves the linked employee). */
  technicianUserId?: string;
  /** Technician directly by employee record. */
  technicianEmployeeId?: string;
  team?: string;
  vendorId?: string;
}

export function assignWorkOrder(id: string, body: WorkOrderAssignBody): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/maintenance-work-orders/${id}/assign`, body);
}

export function scheduleWorkOrder(
  id: string,
  body: { plannedStart: string; plannedEnd: string },
): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/maintenance-work-orders/${id}/schedule`, body);
}

/** → In Progress; the asset moves to Under Maintenance. */
export function startWorkOrder(id: string): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/maintenance-work-orders/${id}/start`);
}

/** Contract §6.2 hold reasons (drive On Hold / Awaiting Parts / Awaiting Vendor). */
export type WorkOrderHoldReason = 'On Hold' | 'Awaiting Parts' | 'Awaiting Vendor';

export function holdWorkOrder(id: string, reason: WorkOrderHoldReason): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/maintenance-work-orders/${id}/hold`, { reason });
}

export function resumeWorkOrder(id: string): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/maintenance-work-orders/${id}/resume`);
}

export interface WorkOrderCompleteBody {
  resolution: string;
  actionTaken: string;
  diagnosis?: string;
  /** ASSET_CONDITION lookup id recorded as the final condition. */
  finalConditionId: string;
  /** Explicit outcome — AVAILABLE | ASSIGNED | DAMAGED | RETIRED. */
  assetNextStatus: string;
  /** Mandatory when the outcome is DAMAGED or RETIRED. */
  reason?: string;
  /** Money fields — only sent when the caller holds the cost permission. */
  laborCost?: string | number;
  externalCost?: string | number;
  /** Omitted → the server derives it from the actual start→completion span. */
  downtimeMinutes?: number;
  nextMaintenanceDate?: string;
}

export function completeWorkOrder(id: string, body: WorkOrderCompleteBody): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/maintenance-work-orders/${id}/complete`, body);
}

/** Supervisor sign-off (verifier must differ from the completing technician). */
export function verifyWorkOrder(id: string): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/maintenance-work-orders/${id}/verify`);
}

export function cancelWorkOrder(id: string, reason: string): Promise<WorkOrder> {
  return api.post<WorkOrder>(`/maintenance-work-orders/${id}/cancel`, { reason });
}

/** Checklist task — order comes from array position (no sequence field). */
export interface WorkOrderTaskInput {
  name: string;
  isRequired?: boolean;
  notes?: string;
}

/** Replace the checklist (PUT :id/tasks). */
export function setWorkOrderTasks(id: string, tasks: WorkOrderTaskInput[]): Promise<WorkOrder> {
  return api.put<WorkOrder>(`/maintenance-work-orders/${id}/tasks`, { tasks });
}

export function completeWorkOrderTask(
  id: string,
  taskId: string,
  notes?: string,
): Promise<unknown> {
  return api.post<unknown>(
    `/maintenance-work-orders/${id}/tasks/${taskId}/complete`,
    notes ? { notes } : {},
  );
}

/** Parts consumed by the WO (posted maintenance-issue stock transactions). */
export function listWorkOrderParts(
  id: string,
  signal?: AbortSignal,
): Promise<Paginated<WorkOrderPart> | WorkOrderPart[]> {
  return api.get<Paginated<WorkOrderPart> | WorkOrderPart[]>(
    `/maintenance-work-orders/${id}/parts-issues`,
    undefined,
    signal,
  );
}

export interface WorkOrderPartsIssueLineInput {
  itemId: string;
  uomId: string;
  quantity: string | number;
  lotId?: string;
  sourceLocationId?: string;
  /** Unit-cost override (defaults to the item's last purchase cost). */
  unitCost?: string | number;
  notes?: string;
}

export interface WorkOrderPartsIssueBody {
  warehouseId: string;
  lines: WorkOrderPartsIssueLineInput[];
  notes?: string;
}

/** Creates a linked MAINTENANCE_ISSUE stock draft (posts via inventory §4.1). */
export function createWorkOrderPartsIssue(
  id: string,
  body: WorkOrderPartsIssueBody,
): Promise<StockTransaction> {
  return api.post<StockTransaction>(`/maintenance-work-orders/${id}/parts-issues`, body);
}

/* ------------------ Asset meter readings (contract §6.2) ------------------- */

export function listAssetMeterReadings(
  assetId: string,
  params: ListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<AssetMeterReading> | AssetMeterReading[]> {
  return api.get<Paginated<AssetMeterReading> | AssetMeterReading[]>(
    `/assets/${assetId}/meter-readings`,
    params,
    signal,
  );
}

export function recordAssetMeterReading(
  assetId: string,
  body: { readingValue: string | number; meterType?: string; readingAt?: string; notes?: string },
): Promise<AssetMeterReading> {
  return api.post<AssetMeterReading>(`/assets/${assetId}/meter-readings`, body);
}

/* ========================================================================== */
/* Phase 3.5 — Attachments & global search (docs/api-outline.md §4.6–4.7)     */
/* ========================================================================== */

/* --------------------------- Attachments (§4.6) --------------------------- */

/**
 * Parent resource discriminators — mirror the API's ATTACHMENT_PARENTS
 * registry (apps/api/src/attachments/attachment-parents.ts), which reuses the
 * audit-log resource_type vocabulary. Single source of truth for every panel
 * mount.
 */
export const ATTACHMENT_RESOURCE_TYPES = {
  asset: 'asset',
  item: 'item',
  employee: 'employee',
  supplier: 'supplier',
  purchaseOrder: 'purchase_order',
  goodsReceipt: 'goods_receipt',
  workOrder: 'maintenance_work_order',
  transfer: 'transfer',
  assetAssignment: 'asset_assignment',
  stockTransaction: 'stock_transaction',
} as const;

export type AttachmentResourceType =
  (typeof ATTACHMENT_RESOURCE_TYPES)[keyof typeof ATTACHMENT_RESOURCE_TYPES];

export function listAttachments(
  resourceType: AttachmentResourceType,
  resourceId: string,
  signal?: AbortSignal,
): Promise<Paginated<Attachment> | Attachment[]> {
  return api.get<Paginated<Attachment> | Attachment[]>(
    '/attachments',
    { resourceType, resourceId },
    signal,
  );
}

/**
 * Multipart upload (UploadAttachmentDto): `{resourceType, resourceId,
 * documentTypeId?}` + the `file` part. `documentTypeId` is a DOCUMENT_TYPE
 * lookup id classifying the file.
 */
export function uploadAttachment(body: {
  resourceType: AttachmentResourceType;
  resourceId: string;
  file: File;
  documentTypeId?: string;
}): Promise<Attachment> {
  const form = new FormData();
  form.append('resourceType', body.resourceType);
  form.append('resourceId', body.resourceId);
  if (body.documentTypeId) form.append('documentTypeId', body.documentTypeId);
  form.append('file', body.file, body.file.name);
  return api.postForm<Attachment>('/attachments', form);
}

/** Download path for use with the authenticated downloadFile helper. */
export function attachmentDownloadPath(id: string): string {
  return `/attachments/${id}/download`;
}

/** Archives the attachment (DELETE per contract §4.6 — never destroys bytes). */
export function deleteAttachment(id: string): Promise<void> {
  return api.delete<void>(`/attachments/${id}`);
}

/* -------------------------- Global search (§4.7) -------------------------- */

/**
 * GET /search?q= — results are already filtered by the caller's permissions
 * and branch scope server-side; the payload is normalized into ordered
 * entity groups for the topbar dropdown.
 */
export async function globalSearch(q: string, signal?: AbortSignal): Promise<GlobalSearchGroup[]> {
  const payload = await api.get<unknown>('/search', { q }, signal);
  return normalizeSearchResults(payload);
}

/* ========================================================================== */
/* Phase 6 — Counts, approvals, notifications (docs/api-outline.md §7)        */
/* ========================================================================== */

/* -------------------- Count sessions (contract §7.1) ----------------------- */

export interface CountSessionListParams extends ListParams {
  status?: string;
  /** full | cycle (server may also accept FULL | CYCLE). */
  type?: string;
  branchId?: string;
  warehouseId?: string;
  number?: string;
  from?: string;
  to?: string;
}

/** Contract §7.1 scope object — branch required, the rest narrow it. */
export interface CountScopeInput {
  branchId: string;
  warehouseId?: string;
  locationId?: string;
  categoryId?: string;
  itemIds?: string[];
}

export interface CountSessionCreateBody {
  scope: CountScopeInput;
  blind: boolean;
  type: 'full' | 'cycle';
  notes?: string;
}

export function listCountSessions(
  params: CountSessionListParams,
  signal?: AbortSignal,
): Promise<Paginated<CountSession>> {
  return api.get<Paginated<CountSession>>('/count-sessions', params, signal);
}

export function getCountSession(id: string, signal?: AbortSignal): Promise<CountSession> {
  return api.get<CountSession>(`/count-sessions/${id}`, undefined, signal);
}

export function createCountSession(body: CountSessionCreateBody): Promise<CountSession> {
  return api.post<CountSession>('/count-sessions', body);
}

/** Draft-only edit; requires the current `version` (409 VERSION_CONFLICT when stale). */
export function updateCountSession(
  id: string,
  body: Partial<CountSessionCreateBody> & { version: number },
): Promise<CountSession> {
  return api.patch<CountSession>(`/count-sessions/${id}`, body);
}

/** Freezes/snapshots expected balances and generates the count lines. */
export function startCountSession(id: string): Promise<CountSession> {
  return api.post<CountSession>(`/count-sessions/${id}/start`);
}

/**
 * Record a count on one line (RecordCountDto): quantity lines take
 * `{countedQty}`; asset lines take `{found, conditionId?, locationConfirmed?}`
 * — conditionId is the ASSET_CONDITION lookup value id.
 */
export interface CountLineRecordBody {
  countedQty?: string | number;
  found?: boolean;
  conditionId?: string;
  locationConfirmed?: boolean;
  notes?: string;
}

export function recordCountLine(
  id: string,
  lineId: string,
  body: CountLineRecordBody,
): Promise<CountLine | CountSession> {
  return api.post<CountLine | CountSession>(`/count-sessions/${id}/lines/${lineId}/count`, body);
}

/**
 * Rapid-scan entry (ScanCountDto) — the server resolves the code (SKU,
 * barcode, lot, asset tag, or serial) and increments/creates the line.
 */
export function scanCountSession(
  id: string,
  body: { code: string; qty?: string | number; warehouseId?: string; locationId?: string },
): Promise<CountLine | CountSession> {
  return api.post<CountLine | CountSession>(`/count-sessions/${id}/scans`, body);
}

/** Reopen the selected lines for a recount. */
export function recountCountSession(id: string, lineIds: string[]): Promise<CountSession> {
  return api.post<CountSession>(`/count-sessions/${id}/recount`, { lineIds });
}

/** Variance report — payload shape varies; normalize via normalizeVarianceRows. */
export function getCountVariance(id: string, signal?: AbortSignal): Promise<unknown> {
  return api.get<unknown>(`/count-sessions/${id}/variance`, undefined, signal);
}

/** Close counting and lock lines (count.approve). */
export function completeCountSession(id: string): Promise<CountSession> {
  return api.post<CountSession>(`/count-sessions/${id}/complete`);
}

/**
 * Generate draft adjustment transactions from approved variances.
 * Requires an Idempotency-Key (contract §1.5).
 */
export function createCountAdjustments(
  id: string,
  idempotencyKey: string,
): Promise<CountSession | StockTransaction[]> {
  return api.post<CountSession | StockTransaction[]>(
    `/count-sessions/${id}/create-adjustments`,
    undefined,
    { idempotencyKey },
  );
}

export function cancelCountSession(id: string, reason: string): Promise<CountSession> {
  return api.post<CountSession>(`/count-sessions/${id}/cancel`, { reason });
}

/* ------------------- Approvals framework (contract §7.2) ------------------- */

export interface ApprovalWorkflowListParams extends ListParams {
  documentType?: string;
  branchId?: string;
  isActive?: boolean;
}

/** One workflow step — exactly the field matching approverType is set. */
export interface ApprovalStepInput {
  /** 1-based order; defaults to the array position when omitted. */
  sequence?: number;
  name?: string;
  approverType: 'ROLE' | 'POSITION' | 'DEPT_HEAD' | 'USER';
  approverRoleId?: string;
  approverPositionId?: string;
  approverUserId?: string;
}

/**
 * PATCH-able workflow fields (UpdateApprovalWorkflowDto). `code` and
 * `documentType` are create-only; sending them on PATCH is rejected by
 * forbidNonWhitelisted. There is no version field — step replacement is
 * refused (409 IN_USE) while requests are pending instead.
 */
export interface ApprovalWorkflowUpdateBody {
  name?: string;
  description?: string | null;
  /** Sub-type scope (e.g. stock transaction types); empty/omitted = all. */
  documentSubtypes?: string[];
  /** Branch scope — null clears it (all branches). */
  branchId?: string | null;
  /** Amount thresholds as decimal strings — the workflow applies within [min, max]. */
  minAmount?: string | null;
  maxAmount?: string | null;
  /** Quantity thresholds against the document's total base quantity. */
  minQuantity?: string | null;
  maxQuantity?: string | null;
  /** Replaces the step list wholesale (1–10 steps). */
  steps?: ApprovalStepInput[];
}

/** CreateApprovalWorkflowDto — code + documentType + steps are required. */
export interface ApprovalWorkflowCreateBody extends ApprovalWorkflowUpdateBody {
  /** Business code (letters/digits/hyphens/underscores), immutable afterwards. */
  code: string;
  name: string;
  /** STOCK_TRANSACTION | PURCHASE_ORDER | TRANSFER | SUPPLIER_RETURN. */
  documentType: string;
  steps: ApprovalStepInput[];
}

export function listApprovalWorkflows(
  params: ApprovalWorkflowListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<ApprovalWorkflow>> {
  return api.get<Paginated<ApprovalWorkflow>>('/approval-workflows', params, signal);
}

export function getApprovalWorkflow(id: string, signal?: AbortSignal): Promise<ApprovalWorkflow> {
  return api.get<ApprovalWorkflow>(`/approval-workflows/${id}`, undefined, signal);
}

export function createApprovalWorkflow(body: ApprovalWorkflowCreateBody): Promise<ApprovalWorkflow> {
  return api.post<ApprovalWorkflow>('/approval-workflows', body);
}

export function updateApprovalWorkflow(
  id: string,
  body: ApprovalWorkflowUpdateBody,
): Promise<ApprovalWorkflow> {
  return api.patch<ApprovalWorkflow>(`/approval-workflows/${id}`, body);
}

export function activateApprovalWorkflow(id: string): Promise<ApprovalWorkflow> {
  return api.post<ApprovalWorkflow>(`/approval-workflows/${id}/activate`);
}

export function deactivateApprovalWorkflow(id: string): Promise<ApprovalWorkflow> {
  return api.post<ApprovalWorkflow>(`/approval-workflows/${id}/deactivate`);
}

export interface ApprovalRequestListParams extends ListParams {
  status?: string;
  documentType?: string;
  branchId?: string;
  assignedToMe?: boolean;
}

export function listApprovalRequests(
  params: ApprovalRequestListParams,
  signal?: AbortSignal,
): Promise<Paginated<ApprovalRequest>> {
  return api.get<Paginated<ApprovalRequest>>('/approval-requests', params, signal);
}

export function getApprovalRequest(id: string, signal?: AbortSignal): Promise<ApprovalRequest> {
  return api.get<ApprovalRequest>(`/approval-requests/${id}`, undefined, signal);
}

/** Advances the current step or finalizes the request. */
export function approveApprovalRequest(id: string, comment?: string): Promise<ApprovalRequest> {
  return api.post<ApprovalRequest>(
    `/approval-requests/${id}/approve`,
    comment ? { comment } : {},
  );
}

/** Rejection comment is REQUIRED (contract §7.2). */
export function rejectApprovalRequest(id: string, comment: string): Promise<ApprovalRequest> {
  return api.post<ApprovalRequest>(`/approval-requests/${id}/reject`, { comment });
}

/** Return for revision — the document goes back to Draft. */
export function returnApprovalRequest(id: string, comment: string): Promise<ApprovalRequest> {
  return api.post<ApprovalRequest>(`/approval-requests/${id}/return`, { comment });
}

export function listApprovalDelegations(
  params: ListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<ApprovalDelegation> | ApprovalDelegation[]> {
  return api.get<Paginated<ApprovalDelegation> | ApprovalDelegation[]>(
    '/approval-delegations',
    params,
    signal,
  );
}

export function createApprovalDelegation(body: {
  delegateUserId: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
}): Promise<ApprovalDelegation> {
  return api.post<ApprovalDelegation>('/approval-delegations', body);
}

/** Revokes the delegation (DELETE per contract §7.2). */
export function deleteApprovalDelegation(id: string): Promise<void> {
  return api.delete<void>(`/approval-delegations/${id}`);
}

/* ---------------------- Notifications (contract §7.3) ---------------------- */

export interface NotificationListParams extends ListParams {
  /** true = read only, false = unread only. */
  read?: boolean;
  type?: string;
}

export function listNotifications(
  params: NotificationListParams = {},
  signal?: AbortSignal,
): Promise<Paginated<AppNotification>> {
  return api.get<Paginated<AppNotification>>('/notifications', params, signal);
}

export async function getUnreadNotificationCount(signal?: AbortSignal): Promise<number> {
  const payload = await api.get<unknown>('/notifications/unread-count', undefined, signal);
  return normalizeUnreadCount(payload);
}

export function markNotificationRead(id: string): Promise<AppNotification | void> {
  return api.post<AppNotification | void>(`/notifications/${id}/read`);
}

export function markAllNotificationsRead(): Promise<void> {
  return api.post<void>('/notifications/read-all');
}
