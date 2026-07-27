/**
 * Typed functions for the Phase 1 API surface (docs/api-outline.md §2).
 * All paths are relative to the /api/v1 base handled by src/lib/api.ts.
 */
import type { Paginated, SessionUser } from '@gemerp/shared';
import { api, type QueryParams } from './api';
import type {
  AuditLogEntry,
  Branch,
  Me,
  PermissionCatalogGroup,
  Role,
  SessionInfo,
  StorageLocation,
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
