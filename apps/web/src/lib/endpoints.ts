/**
 * Typed functions for the Phase 1 + Phase 2 API surface
 * (docs/api-outline.md §2–3). All paths are relative to the /api/v1 base
 * handled by src/lib/api.ts.
 */
import type {
  EmployeeStatus,
  ItemBusinessCategory,
  Paginated,
  SessionUser,
  TrackingMethod,
} from '@gemerp/shared';
import { api, type QueryParams } from './api';
import type {
  AuditLogEntry,
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
  Manufacturer,
  Me,
  OutstandingAsset,
  PermissionCatalogGroup,
  Position,
  ResolvedBarcode,
  Role,
  SessionInfo,
  StorageLocation,
  Uom,
  UomConversion,
  UserRecord,
  Warehouse,
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
}): Promise<UomConversion> {
  return api.post<UomConversion>('/uom-conversions', body);
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
