# GEM ERP — REST API Contract (`/api/v1`)

**Product:** GEM ERP — Asset & Inventory Management for GemCor (single company, multi-branch).
**Server:** `@gemerp/api` (NestJS 11, port 3001). Global prefix `api/v1`. Swagger UI at `/api/docs`.
**Status legend:** `✅ Phase 1 — implemented` = live now. `P2`–`P7` = planned phase per spec §32. Phase 8 adds no new endpoints (hardening only).

This document is the contract that both `apps/api` and `apps/web` follow. Endpoint paths, action semantics, error codes, and the conventions below are binding. The permission string catalog is owned by `@gemerp/shared` (`PERMISSIONS`, `ALL_PERMISSIONS`); this document mirrors it.

---

## 1. Global conventions

### 1.1 Base URL, versioning, formats

- All endpoints live under `/api/v1`. Paths in this document omit the prefix.
- JSON request/response bodies, `Content-Type: application/json` (multipart only for file upload).
- Timestamps: ISO-8601 UTC with `Z` suffix (`2026-07-23T06:00:00.000Z`). Storage is UTC; the org display timezone is Asia/Manila (client-side concern).
- IDs: UUIDs. Business document numbers (PO number, asset tag, …) are separate human-readable values generated from `sequence_counters` — never derived from the PK.
- Money: decimal values serialized as strings (`"1250.00"`), currency PHP unless a document states otherwise.
- Success codes: `200` reads/actions, `201` resource creation, `204` no-content (logout, session revoke).

### 1.2 Authentication & CSRF

- Cookie sessions: `gemerp_session`, HTTP-only, `SameSite=Lax`, `Secure` in production. Opaque 256-bit random token, stored SHA-256-hashed in `user_sessions`, 12-hour sliding expiry.
- Passwords hashed with argon2id. 5 consecutive failed logins lock the account for 15 minutes. All auth events are audit-logged.
- Every endpoint except `POST /auth/login`, `GET /health`, and `GET /health/ready` requires an authenticated session.
- CSRF: `SameSite=Lax` cookie plus server-side `Origin`/`Referer` validation on all state-changing (non-GET) requests. Cross-origin state changes are rejected with `403 FORBIDDEN`.
- Missing/expired session → `401 UNAUTHENTICATED`.

### 1.3 Error envelope (all API errors)

Every error response, without exception:

```json
{
  "error": {
    "code": "MACHINE_CODE",
    "message": "Human friendly explanation.",
    "details": [ { "field": "email", "message": "must be a valid email" } ]
  }
}
```

- `code` is a stable machine-readable string; `message` is safe to display. `details` is optional.
- Validation failures use `code: "VALIDATION_ERROR"` with one `details` entry per invalid field.
- Stack traces, SQL, and internal errors are never leaked; unexpected failures return `500 INTERNAL_ERROR` with a generic message and a server-side correlation ID in logs.

Common codes:

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | DTO/schema validation failed (per-field `details`) |
| 401 | `UNAUTHENTICATED` | No/expired session |
| 401 | `INVALID_CREDENTIALS` | Login failed (never reveals which factor) |
| 403 | `FORBIDDEN` | Missing permission or branch access (both checked server-side) |
| 404 | `NOT_FOUND` | Resource absent **or** outside caller's branch scope (no existence leak) |
| 409 | `VERSION_CONFLICT` | Optimistic-concurrency `version` mismatch (§1.6) |
| 409 | `INVALID_STATE_TRANSITION` | Action not allowed from the record's current status |
| 409 | `DUPLICATE_CODE` | Unique business code/barcode/email already in use |
| 409 | `INSUFFICIENT_STOCK` | Posting would drive stock negative (checked in DB transaction) |
| 409 | `IDEMPOTENCY_CONFLICT` | `Idempotency-Key` reused with a different payload (§1.5) |
| 409 | `SELF_APPROVAL_FORBIDDEN` | Requester attempted to approve own controlled transaction |
| 423 | `ACCOUNT_LOCKED` | Account locked by failed-login throttling (retry after lockout) |
| 429 | `RATE_LIMITED` | Login/sensitive-endpoint rate limit hit |
| 500 | `INTERNAL_ERROR` | Unexpected server failure |

### 1.4 Pagination, filtering, sorting

All list endpoints:

- Query params: `page` (1-based, default 1), `pageSize` (default 25, max 100), `sort`, plus resource-specific filters.
- `sort` format: `field:asc` or `field:desc` (e.g. `sort=createdAt:desc`); each resource documents its sortable fields and default.
- Free-text search uses `q` where supported.
- Date-range filters use `from` / `to` (ISO-8601, inclusive).

Response shape:

```json
{
  "data": [ ... ],
  "meta": { "page": 1, "pageSize": 25, "total": 132, "totalPages": 6 }
}
```

Single-resource responses return the object directly (no wrapper). Types `Paginated<T>`, `PaginationMeta`, `ApiError` come from `@gemerp/shared`.

### 1.5 Idempotency (posting-sensitive operations)

Operations that create stock movement, custody changes, or irreversible lifecycle events accept the header:

```
Idempotency-Key: <client-generated UUID>
```

- **Required** on: `POST` of `/stock-transactions/:id/post`, `/stock-transactions/:id/reverse`, `/goods-receipts/:id/post`, `/goods-receipts/:id/reverse`, `/supplier-returns/:id/post`, `/transfers/:id/dispatch`, `/transfers/:id/receive`, `/assets/:id/assign`, `/assets/:id/return`, `/assets/:id/dispose`, `/assets/:id/reverse-disposal`, `/count-sessions/:id/create-adjustments`.
- Semantics: keys are stored server-side for 24 hours, scoped to user + endpoint. Replaying the same key with an identical payload returns the **original** response (no duplicate movement). Same key with a different payload → `409 IDEMPOTENCY_CONFLICT`.

### 1.6 Optimistic concurrency (mutable drafts)

Mutable business documents and catalog records carry an integer `version` (starts at 1, increments on every successful mutation). This applies to: stock transactions, purchase orders, goods receipts, supplier returns, transfers, count sessions, maintenance plans, work orders, items, employees, and assets (draft-editable fields).

- `PATCH` requests on these resources **must** include the current `version` in the body; mismatch → `409 VERSION_CONFLICT` (client refetches and retries).
- Phase 1 admin resources (users, roles, branches, warehouses, storage locations) do **not** use version fields; changes are last-write-wins and fully audit-logged.

### 1.7 Branch scoping (enforced server-side, always)

- Authorization = permission check **AND** branch-scope check. Frontend filtering is never relied on.
- Users hold explicit branch access (`user_branch_access`); `SessionUser.branchIds` reflects it. Super Admin (`isSuperAdmin`) bypasses branch filtering but never audit logging.
- Branch-owned resources (warehouses, storage locations, employees, stock, assets, transactions, transfers, POs, receipts, work orders, counts, reports): list endpoints implicitly filter to accessible branches; requesting `branchId` outside the caller's scope → `403 FORBIDDEN`; direct fetch of an out-of-scope record → `404 NOT_FOUND`.
- Global (non-branch) resources: users, roles, permissions, branches (the list itself), items, suppliers, lookups, UOMs, settings — gated by permission only.
- Cross-branch documents (inter-branch transfers): visible with access to source **or** destination branch; `dispatch` requires source-branch access, `receive` requires destination-branch access.
- Attachments and audit entries inherit the branch scope of their parent resource.

### 1.8 Business-transition rule

State changes are **explicit action endpoints** (`submit`, `approve`, `reject`, `post`, `cancel`, `reverse`, `dispatch`, `receive`, `assign`, `return`, `retire`, `dispose`, …). Generic `PATCH` only edits *draft-editable fields* and never changes status. Posted/approved documents are immutable; corrections go through reversal or correction flows. Invalid transitions → `409 INVALID_STATE_TRANSITION`.

### 1.9 Document numbering (from `sequence_counters`)

| Document | Pattern | Example |
|---|---|---|
| Asset tag | `AST-{BRANCH}-{CAT}-{YYYY}-{SEQ6}` | `AST-SUB-LAP-2026-000123` |
| Item SKU | `SKU-{CAT}-{SEQ}` | `SKU-PPR-00017` |
| Lot | `LOT-{SKU}-{YYYYMMDD}-{SEQ}` | `LOT-PPR-00017-20260301-01` |
| Bin/location | `BIN-{BRANCH}-{WH}-{LOC}` | `BIN-SUB-WH1-A01` |
| Stock transaction | `STK-{YYYY}-{SEQ6}` | `STK-2026-000482` |
| Purchase order | `PO-{YYYY}-{SEQ5}` | `PO-2026-00042` |
| Goods receipt | `GR-{YYYY}-{SEQ5}` | `GR-2026-00108` |
| Supplier return | `SRN-{YYYY}-{SEQ5}` | `SRN-2026-00003` |
| Transfer | `TRF-{YYYY}-{SEQ5}` | `TRF-2026-00021` |
| Work order | `WO-{YYYY}-{SEQ5}` | `WO-2026-00077` |
| Count session | `CNT-{YYYY}-{SEQ5}` | `CNT-2026-00004` |

---

## 2. Phase 1 — Foundation (✅ implemented)

Everything in this section is live. This is the exact Phase 1 surface — nothing more, nothing less.

### 2.1 Auth & sessions

No permission strings — login is public; the rest require only an authenticated session. All auth events (login, logout, failure, lockout, password change, session revoke) are audit-logged.

| Status | Method | Path | Purpose | Permission | Request → Response |
|---|---|---|---|---|---|
| ✅ Phase 1 — implemented | POST | `/auth/login` | Authenticate, set session cookie | public | `{email, password}` → `200` `SessionUser` + `Set-Cookie: gemerp_session`. Errors: `401 INVALID_CREDENTIALS`, `423 ACCOUNT_LOCKED`, `429 RATE_LIMITED` |
| ✅ Phase 1 — implemented | POST | `/auth/logout` | Destroy current session | session | none → `204`, cookie cleared |
| ✅ Phase 1 — implemented | GET | `/auth/me` | Current user + effective access | session | → `200` `SessionUser` `{id, email, displayName, isSuperAdmin, roles[], permissions[], branchIds[]}` |
| ✅ Phase 1 — implemented | POST | `/auth/change-password` | Change own password | session | `{currentPassword, newPassword}` → `200`; other sessions of the user are revoked |
| ✅ Phase 1 — implemented | GET | `/auth/sessions` | List own active sessions | session | → `200` `[{id, createdAt, lastSeenAt, expiresAt, ip, userAgent, current}]` |
| ✅ Phase 1 — implemented | DELETE | `/auth/sessions/:id` | Revoke one of own sessions | session | → `204` |

### 2.2 Users

Global resources (not branch-scoped); a user's *data* visibility is driven by their branch access, managed here. Users referenced by business records are never hard-deleted — deactivate instead.

| Status | Method | Path | Purpose | Permission | Request → Response |
|---|---|---|---|---|---|
| ✅ Phase 1 — implemented | GET | `/users` | List users (filters: `q`, `roleId`, `branchId`, `isActive`) | `user.view` | → `200` paginated users (no password data, ever) |
| ✅ Phase 1 — implemented | POST | `/users` | Create user | `user.create` | `{email, displayName, password, roleIds?, branchIds?}` → `201` user |
| ✅ Phase 1 — implemented | GET | `/users/:id` | User detail incl. roles + branch access | `user.view` | → `200` user |
| ✅ Phase 1 — implemented | PATCH | `/users/:id` | Edit profile fields (email, displayName) | `user.update` | partial body → `200` user |
| ✅ Phase 1 — implemented | POST | `/users/:id/activate` | Re-enable login | `user.activate` | → `200` user |
| ✅ Phase 1 — implemented | POST | `/users/:id/deactivate` | Disable login, revoke all sessions | `user.deactivate` | → `200` user |
| ✅ Phase 1 — implemented | PUT | `/users/:id/roles` | Replace role assignment | `user.assign_roles` | `{roleIds: []}` → `200` user; audit-logged with old/new |
| ✅ Phase 1 — implemented | PUT | `/users/:id/branch-access` | Replace branch access | `user.assign_branches` | `{branchIds: []}` → `200` user; audit-logged with old/new |
| ✅ Phase 1 — implemented | POST | `/users/:id/reset-password` | Admin password reset (forces change at next login) | `user.reset_password` | `{newPassword}` → `200`; all target-user sessions revoked |

### 2.3 Roles & permissions

Roles are global. The 7 system roles (from `ROLE_DEFINITIONS` in `@gemerp/shared`: `SUPER_ADMIN`, Branch Admin, Warehouse Custodian, Asset Custodian, Maintenance Personnel, Auditor/Viewer, Employee/Requester) have `isSystem: true` — their code cannot change and `SUPER_ADMIN` cannot be edited or stripped of permissions.

| Status | Method | Path | Purpose | Permission | Request → Response |
|---|---|---|---|---|---|
| ✅ Phase 1 — implemented | GET | `/roles` | List roles with permission counts | `role.view` | → `200` paginated roles |
| ✅ Phase 1 — implemented | POST | `/roles` | Create custom role | `role.create` | `{code, name, description, permissions?: []}` → `201` role |
| ✅ Phase 1 — implemented | GET | `/roles/:id` | Role detail incl. permission list | `role.view` | → `200` role |
| ✅ Phase 1 — implemented | PATCH | `/roles/:id` | Edit name/description | `role.update` | partial body → `200` role (system role codes immutable) |
| ✅ Phase 1 — implemented | PUT | `/roles/:id/permissions` | Replace role's permission set | `role.manage_permissions` | `{permissions: []}` (validated against catalog) → `200` role; audit-logged with old/new |
| ✅ Phase 1 — implemented | GET | `/permissions` | Full permission catalog, grouped by resource | `role.view` | → `200` `[{resource, permissions: [{key, description}]}]` (mirrors `ALL_PERMISSIONS`) |

### 2.4 Organization structure

Branch list is global-readable (needed for pickers) but mutation is permission-gated. Warehouses and storage locations are branch-scoped: nested list/create routes require access to the owning branch; out-of-scope direct fetches → `404`.

| Status | Method | Path | Purpose | Permission | Request → Response |
|---|---|---|---|---|---|
| ✅ Phase 1 — implemented | GET | `/branches` | List branches (filter: `isActive`) | `branch.view` | → `200` paginated branches |
| ✅ Phase 1 — implemented | POST | `/branches` | Create branch | `branch.create` | `{code, name, address?, timezone?}` → `201` branch (`409 DUPLICATE_CODE`) |
| ✅ Phase 1 — implemented | GET | `/branches/:id` | Branch detail | `branch.view` | → `200` branch |
| ✅ Phase 1 — implemented | PATCH | `/branches/:id` | Edit branch fields | `branch.update` | partial body → `200` branch |
| ✅ Phase 1 — implemented | POST | `/branches/:id/activate` | Reactivate branch | `branch.activate` | → `200` branch |
| ✅ Phase 1 — implemented | POST | `/branches/:id/deactivate` | Deactivate (history preserved) | `branch.deactivate` | → `200` branch |
| ✅ Phase 1 — implemented | GET | `/branches/:branchId/warehouses` | List warehouses of a branch | `warehouse.view` + branch access | → `200` paginated warehouses |
| ✅ Phase 1 — implemented | POST | `/branches/:branchId/warehouses` | Create warehouse in branch | `warehouse.create` + branch access | `{code, name, isDefaultReceiving?, isDefaultIssuance?}` → `201` warehouse |
| ✅ Phase 1 — implemented | GET | `/warehouses/:id` | Warehouse detail | `warehouse.view` + branch access | → `200` warehouse |
| ✅ Phase 1 — implemented | PATCH | `/warehouses/:id` | Edit warehouse (incl. active flag, defaults) | `warehouse.update` + branch access | partial body → `200` warehouse |
| ✅ Phase 1 — implemented | GET | `/warehouses/:warehouseId/storage-locations` | List locations (zone/aisle/rack/shelf/bin tree) | `warehouse.view` + branch access | → `200` paginated locations |
| ✅ Phase 1 — implemented | POST | `/warehouses/:warehouseId/storage-locations` | Create storage location | `warehouse.update` + branch access | `{code, name, parentId?, kind?}` → `201` location |
| ✅ Phase 1 — implemented | GET | `/storage-locations/:id` | Location detail | `warehouse.view` + branch access | → `200` location |
| ✅ Phase 1 — implemented | PATCH | `/storage-locations/:id` | Edit location (incl. active flag) | `warehouse.update` + branch access | partial body → `200` location |

### 2.5 Audit log

Append-only; no mutation endpoints exist. Non-super-admin results are limited to the caller's accessible branches (plus branch-less system events if the caller holds `audit.view`).

| Status | Method | Path | Purpose | Permission | Request → Response |
|---|---|---|---|---|---|
| ✅ Phase 1 — implemented | GET | `/audit-logs` | Search audit trail. Filters: `actor`, `action`, `resourceType`, `resourceId`, `branchId`, `from`, `to` | `audit.view` (+ branch scope) | → `200` paginated `[{id, actorUserId, actorDisplayName, action, resourceType, resourceId, branchId, timestamp, ip, userAgent, correlationId, oldValues, newValues, reason}]`; secrets always redacted |

### 2.6 Health

Public, unversioned concerns but served under the prefix for simplicity.

| Status | Method | Path | Purpose | Permission | Request → Response |
|---|---|---|---|---|---|
| ✅ Phase 1 — implemented | GET | `/health` | Liveness | public | → `200` `{status: "ok"}` |
| ✅ Phase 1 — implemented | GET | `/health/ready` | Readiness: Postgres check is fatal; Redis and MinIO are reported but non-fatal in dev | public | → `200/503` `{status, checks: {postgres, redis, minio}}` |

---

## 3. Phase 2 — Employees, lookups, and catalog

### 3.1 Employees (`P2`)

Branch-scoped. Employees are custody records, not necessarily users; optional `userId` link. No payroll/attendance/leave — ever.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P2 | GET | `/employees` | List (filters: `q`, `branchId`, `departmentId`, `positionId`, `status`) | `employee.view` |
| P2 | POST | `/employees` | Create employee record | `employee.create` |
| P2 | GET | `/employees/:id` | Detail (restricted notes only with `employee.update`) | `employee.view` |
| P2 | PATCH | `/employees/:id` | Edit fields (requires `version`) | `employee.update` |
| P2 | POST | `/employees/:id/activate` | Set employment status active | `employee.update` |
| P2 | POST | `/employees/:id/deactivate` | Set inactive/suspended (`{status, reason}`) | `employee.update` |
| P2 | POST | `/employees/:id/separate` | Separation workflow: `{separationDate}`; response includes outstanding assigned assets; blocks archival while custody is outstanding — assets are never auto-returned | `employee.archive` |
| P2 | POST | `/employees/:id/archive` | Archive (soft) after separation is clean | `employee.archive` |
| P3 | GET | `/employees/:id/assets` | Currently assigned assets | `employee.view` + `asset.view` |
| P3 | GET | `/employees/:id/issuances` | Consumable issuance history | `employee.view` + `inventory.view` |
| P3 | GET | `/employees/:id/acknowledgments` | Outstanding acknowledgments & overdue returns | `employee.view` + `asset.view` |

### 3.2 Departments & positions (`P2`)

Global reference data used for employee tagging and cost-center reporting.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P2 | GET / POST | `/departments` ; `/departments/:id` GET / PATCH | CRUD (PATCH toggles `isActive`; delete-protected once referenced) | read `lookup.view`, write `lookup.manage` |
| P2 | GET / POST | `/positions` ; `/positions/:id` GET / PATCH | Same contract as departments | read `lookup.view`, write `lookup.manage` |

### 3.3 Lookup configuration (`P2`)

One generic module for business-managed values (spec §10): `asset-conditions`, `transaction-reasons`, `adjustment-reasons`, `disposal-methods`, `maintenance-types`, `maintenance-priorities`, `work-order-statuses`, `supplier-categories`, `document-types`, `notification-types`, `asset-types`. Enums are reserved for true system invariants only.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P2 | GET | `/lookups/:type` | List values (code, name, description, sortOrder, isActive, optional branchId) | `lookup.view` |
| P2 | POST | `/lookups/:type` | Create value | `lookup.manage` |
| P2 | PATCH | `/lookups/:type/:id` | Edit / activate / deactivate; deletion is refused (`409`) once referenced | `lookup.manage` |

### 3.4 Units of measure & conversions (`P2`)

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P2 | GET / POST | `/uoms` ; `/uoms/:id` GET / PATCH | UOM catalog (code, name, precision) | read `lookup.view`, write `lookup.manage` |
| P2 | GET / POST | `/uom-conversions` ; `/uom-conversions/:id` PATCH | Global conversions (`1 BOX = 10 PACK`); item-specific overrides live on the item | read `lookup.view`, write `lookup.manage` |

### 3.5 Brands, manufacturers, item categories (`P2`)

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P2 | GET / POST | `/brands`, `/manufacturers` (+ `/:id` GET / PATCH) | Reference catalogs | read `lookup.view`, write `lookup.manage` |
| P2 | GET / POST | `/item-categories` (+ `/:id` GET / PATCH) | Categories (carry `code` used in tag/SKU patterns) | read `lookup.view`, write `lookup.manage` |
| P2 | GET / POST | `/item-categories/:categoryId/subcategories`; `/item-subcategories/:id` GET / PATCH | Subcategories | read `lookup.view`, write `lookup.manage` |

### 3.6 Item master (`P2`)

Items are global; per-warehouse stocking rules are scoped through the warehouse's branch. Cost fields (`standardCost`, `lastPurchaseCost`) appear only with `item.view_cost`.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P2 | GET | `/items` | List (filters: `q`, `businessCategory`, `trackingMethod`, `categoryId`, `brandId`, `isActive`, `barcode`) | `item.view` |
| P2 | POST | `/items` | Create item — `businessCategory` ∈ `SERIALIZED_ASSET \| CONSUMABLE \| BULK_NON_CONSUMABLE`, `trackingMethod` ∈ `SERIAL \| QUANTITY \| LOT` (defaults per spec §4); SKU generated if omitted | `item.create` |
| P2 | GET | `/items/:id` | Detail incl. UOMs, conversions, barcodes, warehouse settings | `item.view` |
| P2 | PATCH | `/items/:id` | Edit (requires `version`); `trackingMethod` immutable once stock or assets exist (`409 INVALID_STATE_TRANSITION`) | `item.update` |
| P2 | POST | `/items/:id/activate` / `/items/:id/deactivate` | Toggle availability for new transactions | `item.update` |
| P2 | GET / POST | `/items/:id/barcodes` | List / add alternate barcodes (supplier, UPC, EAN, packaging); duplicate active mapping → `409 DUPLICATE_CODE` | read `item.view`, write `item.update` |
| P2 | DELETE | `/items/:id/barcodes/:barcodeId` | Archive a barcode mapping (soft) | `item.update` |
| P2 | GET | `/items/:id/warehouse-settings` | Reorder level, reorder qty, min/max per warehouse | `item.view` (accessible branches only) |
| P2 | PUT | `/items/:id/warehouse-settings/:warehouseId` | Upsert per-warehouse stocking rules | `item.update` + branch access |
| P2 | GET | `/items/resolve-barcode?code=` | Resolve any barcode (SKU, alternate, lot, bin) to its record — scanner workflows | `item.view` |

### 3.7 Imports (`P2`/`P3`)

Generic staged import per spec §24 — validate first, commit explicitly, never partially import invalid rows unless `mode: "partial"` is chosen. Types: `employees`, `items`, `suppliers`, `lookups` (P2); `opening-balances`, `assets` (P3). Results and errors are downloadable; every import is audit-logged.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P2 | GET | `/imports/templates/:type` | Download CSV/XLSX template | `<resource>.import` |
| P2 | POST | `/imports/:type/validate` | Upload (multipart) + parse + row-level errors/warnings + change preview; **no writes** | `<resource>.import` |
| P2 | POST | `/imports/:type/commit` | Commit a validated staging id: `{stagingId, mode: "strict"\|"partial"}`; transactional/chunked | `<resource>.import` |
| P2 | GET | `/imports/:id` | Import status + result file link | `<resource>.import` |

---

## 4. Phase 3 — Inventory, stock ledger, and serialized assets

### 4.1 Stock transactions (`P3`)

One document model for all ledger-affecting movement (spec §13 types: opening balance, purchase/non-purchase receipt, issues, returns, location transfer, adjustments, maintenance-parts issue, disposal/write-off, reversal). Statuses: `Draft → Pending Approval → Approved → Posted`, plus `Rejected`, `Canceled`, `Reversed`. **Only posted transactions touch stock**, and posting validates availability inside the DB transaction. Balances are projections — never directly editable.

Create/edit permission depends on `type`: receipts → `inventory.receive`, issues → `inventory.issue`, returns → `inventory.return`, location transfers → `inventory.transfer`, adjustments & write-offs → `inventory.adjust`. Branch-scoped by the transaction's branch/warehouse. Cost fields require `inventory.view_cost`.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P3 | GET | `/stock-transactions` | List (filters: `type`, `status`, `branchId`, `warehouseId`, `itemId`, `number`, `from`, `to`) | `inventory.view` |
| P3 | POST | `/stock-transactions` | Create draft: `{type, branchId, warehouseId, lines: [{itemId, uomId, quantity, lotId?/lotInput?, locationId?, unitCost?}], reasonCode?, employeeId?, departmentId?, workOrderId?, notes}`. Stores entered UOM/qty and normalized base qty | per-type (above) |
| P3 | GET | `/stock-transactions/:id` | Detail with lines, ledger links, approval trail | `inventory.view` |
| P3 | PATCH | `/stock-transactions/:id` | Edit **draft only** (requires `version`) | per-type |
| P3 | POST | `/stock-transactions/:id/submit` | Draft → Pending Approval (skips straight to Approved if no workflow matches) | per-type |
| P3 | POST | `/stock-transactions/:id/approve` / `.../reject` | Approval decision (`reject` requires `{comment}`); self-approval refused (`409 SELF_APPROVAL_FORBIDDEN`) | `inventory.approve` |
| P3 | POST | `/stock-transactions/:id/post` | Post approved txn → immutable ledger entries + balance projection update. **`Idempotency-Key` required.** Errors: `INSUFFICIENT_STOCK`, `INVALID_STATE_TRANSITION`, expired-lot/FEFO violations | `inventory.post` |
| P3 | POST | `/stock-transactions/:id/cancel` | Cancel Draft/Pending (`{reason}`) | `inventory.cancel` |
| P3 | POST | `/stock-transactions/:id/reverse` | Create + post a linked reversal of a Posted txn (`{reason}` required). **`Idempotency-Key` required.** Original marked `Reversed`, never edited | `inventory.reverse` |

### 4.2 Balances, ledger, lots, low stock (`P3`)

Read-only projections; all branch-scoped, costs gated by `inventory.view_cost`.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P3 | GET | `/stock-balances` | On-hand / available / reserved / in-transfer / quarantined by `branchId`, `warehouseId`, `locationId`, `itemId`, `lotId` | `inventory.view` |
| P3 | GET | `/stock-ledger` | Immutable ledger entries (filters: item, warehouse, txn type, `from`/`to`) | `inventory.view` |
| P3 | GET | `/items/:id/stock` | Per-item balance rollup across accessible warehouses | `inventory.view` |
| P3 | GET | `/lots` | Lot list (filters: `itemId`, `warehouseId`, `expiresBefore`, `status`); FEFO ordering supported | `inventory.view` |
| P3 | GET | `/lots/:id` | Lot detail + movement history | `inventory.view` |
| P3 | GET | `/stock-alerts/low-stock` | Items at/below per-warehouse reorder level (drives alerts) | `inventory.view` |

### 4.3 Serialized assets (`P3`)

Branch-scoped by current branch. Lifecycle: `Draft, Available, Reserved, Assigned, In Transfer, Under Inspection, Under Maintenance, Damaged, Lost, Retired, Disposed` — transitions only via the action endpoints below; invalid moves → `409 INVALID_STATE_TRANSITION` (disposed assets can't be assigned; assets under maintenance can't transfer; lost assets need the recovery workflow; posted disposals require authorized reversal). `acquisitionCost` requires `asset.view_cost`.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P3 | GET | `/assets` | List (filters: `q` on tag/serial, `branchId`, `warehouseId`, `status`, `condition`, `itemId`, `custodianEmployeeId`, `departmentId`) | `asset.view` |
| P3 | POST | `/assets` | Register existing asset as Draft (tag, barcode, QR token generated); PO-sourced assets are created by goods-receipt posting instead | `asset.create` |
| P3 | GET | `/assets/:id` | Full detail: item, custody, location, warranty, condition, next maintenance, attachments | `asset.view` |
| P3 | PATCH | `/assets/:id` | Edit non-lifecycle fields (requires `version`); Draft is fully editable | `asset.update` |
| P3 | POST | `/assets/:id/activate` | Draft → Available | `asset.create` |
| P3 | POST | `/assets/:id/assign` | Assign to employee/department/project/location: `{employeeId?/departmentId?/projectRef?/locationId?, expectedReturnDate?, condition, notes?}` → Assigned + custody history + acknowledgment request. **`Idempotency-Key` required** | `asset.assign` |
| P3 | POST | `/assets/:id/acknowledge` | Authenticated custodian confirms receipt (or return) | session user linked to custodian employee |
| P3 | POST | `/assets/:id/return` | Return from custody: `{condition, notes?, photos?}` → Available (or Damaged). **`Idempotency-Key` required** | `asset.assign` |
| P3 | POST | `/assets/:id/reserve` / `.../release` | Reserve for planned issue / release reservation | `asset.assign` |
| P3 | POST | `/assets/:id/inspect` | Record inspection: `{condition, notes}`; failed inspection may flag maintenance | `asset.update` |
| P3 | POST | `/assets/:id/report-damage` | Damage declaration `{description, photos?}` → Damaged (approval-gated when configured); employees may report on own assigned assets | `asset.report_incident` |
| P3 | POST | `/assets/:id/report-loss` | Loss declaration `{description}` → Lost (approval-gated) | `asset.report_incident` |
| P3 | POST | `/assets/:id/recover` | Authorized recovery workflow: Lost → Under Inspection (approval-gated, `{reason}`) | `asset.update` |
| P3 | POST | `/assets/:id/retire` | Retire `{reason}` (approval-gated) → Retired | `asset.retire` |
| P3 | POST | `/assets/:id/dispose` | Dispose `{disposalMethodId, reason}` (approval-gated) → Disposed. **`Idempotency-Key` required** | `asset.dispose` |
| P3 | POST | `/assets/:id/reverse-disposal` | Authorized reversal of a posted disposal (`{reason}`). **`Idempotency-Key` required** | `asset.dispose` |
| P3 | GET | `/assets/:id/history` | Unified status/condition/location timeline | `asset.view` |
| P3 | GET | `/assets/:id/assignments` | Custody history + acknowledgments | `asset.view` |
| P3 | GET | `/assets/:id/label?format=pdf\|zpl&size=` | Label render (tag + Code 128 + QR) | `asset.print_label` |
| P3 | POST | `/assets/labels/batch` | Batch label sheet `{assetIds[], format, size}` | `asset.print_label` |

### 4.4 Scanning (`P3`)

QR codes contain opaque scan tokens — never record data. Resolution always re-checks auth + permission + branch scope on the resolved record.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P3 | GET | `/scan/:token` | Resolve scan token → `{kind: "asset"\|"item"\|"lot"\|"location", summary, id}` | view permission of resolved kind |
| P3 | POST | `/scan/resolve` | Resolve raw scanner/keyboard input `{code}` (asset tag, SKU, alternate, lot, bin); duplicate-scan protection handled client-side via returned ids | view permission of resolved kind |

### 4.5 Transfers (`P3`)

One transfer document for bin-to-bin, warehouse-to-warehouse, and inter-branch moves of stock lines and/or serialized assets. Intra-branch transfers may be approved+dispatched+received in one sitting; **inter-branch** transfers follow the full controlled flow (spec §16): draft → submit → approve → dispatch (stock/assets become `In Transfer`, source ledger out) → receive & inspect (received/damaged/short/rejected per line) → posted at destination. Visibility: source or destination branch access.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P3 | GET | `/transfers` | List (filters: `status`, `sourceBranchId`, `destinationBranchId`, `kind`, `from`, `to`) | `transfer.view` |
| P3 | POST | `/transfers` | Create draft `{kind, source{branch,warehouse,location?}, destination{...}, lines: [{itemId, qty, uomId, lotId?} \| {assetId}], notes}` | `transfer.create` + source-branch access |
| P3 | GET | `/transfers/:id` | Detail + line states + acknowledgment trail | `transfer.view` |
| P3 | PATCH | `/transfers/:id` | Edit draft (requires `version`) | `transfer.create` |
| P3 | POST | `/transfers/:id/submit` | Draft → Pending Approval | `transfer.create` |
| P3 | POST | `/transfers/:id/approve` / `.../reject` | Decision (`reject` needs `{comment}`); no self-approval | `transfer.approve` |
| P3 | POST | `/transfers/:id/dispatch` | Post source-out, mark `In Transfer`. **`Idempotency-Key` required** | `transfer.dispatch` + source-branch access |
| P3 | POST | `/transfers/:id/receive` | Per-line `{received, damaged, short, rejected}` + inspection notes; posts destination-in, finalizes custody/location. **`Idempotency-Key` required** | `transfer.receive` + destination-branch access |
| P3 | POST | `/transfers/:id/cancel` | Cancel before dispatch (`{reason}`) | `transfer.cancel` |

### 4.6 Attachments (`P3`)

Metadata in Postgres, bytes in MinIO/S3 (`gemerp-attachments`); bucket never public — downloads always proxy through the API with parent-resource authorization. File type/size validated; uploader + time recorded; archived (not destroyed) with audit history. Parents: assets, employees, suppliers, POs, receipts, assignments, transfers, work orders, adjustments/disposals.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P3 | POST | `/attachments` | Multipart upload `{resourceType, resourceId, file, kind?}` | update-permission of parent + its branch scope |
| P3 | GET | `/attachments?resourceType=&resourceId=` | List a record's attachments | view-permission of parent |
| P3 | GET | `/attachments/:id/download` | Stream file | view-permission of parent |
| P3 | DELETE | `/attachments/:id` | Archive attachment | update-permission of parent (or uploader) |

### 4.7 Settings & global search (`P3`)

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P3 | GET / PUT | `/settings` | Org-level settings: display timezone (Asia/Manila), currency (PHP), negative-stock allowance (off by default), FEFO enforcement, receiving over-tolerance, tag/number patterns | `settings.manage` |
| P3 | GET | `/search?q=` | Global search across asset tags, serials, SKUs, barcodes, employees, suppliers, POs, receipts, WOs, transaction numbers — results filtered by the caller's permissions and branches | session (per-result permission filtering) |

---

## 5. Phase 4 — Procurement

Not an accounting system: no payments, AP, or GL. Cost/price fields require `procurement.view_cost`.

### 5.1 Suppliers (`P4`)

Global resources.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P4 | GET / POST | `/suppliers` | List (filters: `q`, `categoryId`, `isActive`) / create | `supplier.view` / `supplier.create` |
| P4 | GET / PATCH | `/suppliers/:id` | Detail / edit | `supplier.view` / `supplier.update` |
| P4 | POST | `/suppliers/:id/activate` / `.../deactivate` | Toggle without losing history | `supplier.update` |
| P4 | POST | `/suppliers/:id/archive` | Soft archive | `supplier.archive` |
| P4 | GET / POST | `/suppliers/:id/contacts`; PATCH / DELETE `/suppliers/:id/contacts/:contactId` | Contact people | `supplier.view` / `supplier.update` |
| P4 | GET | `/suppliers/:id/history` | Purchase & delivery history rollup | `procurement.po.view` |

### 5.2 Purchase orders (`P4`)

Branch-scoped by ordering branch. States: `Draft → Pending Approval → Approved → Partially Received → Fully Received → Closed`, plus `Rejected`, `Canceled`. Approved POs are immutable — material changes require cancel-and-recreate or a new revision via resubmission.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P4 | GET | `/purchase-orders` | List (filters: `status`, `supplierId`, `branchId`, `warehouseId`, `number`, `from`, `to`) | `procurement.po.view` |
| P4 | POST | `/purchase-orders` | Create draft `{supplierId, branchId, destinationWarehouseId, orderDate, expectedDate?, currency, lines: [{itemId, uomId, quantity, unitPrice, discount?, tax?}], terms?, notes?}`; PO number generated | `procurement.po.create` |
| P4 | GET | `/purchase-orders/:id` | Detail + receipt links + outstanding quantities | `procurement.po.view` |
| P4 | PATCH | `/purchase-orders/:id` | Edit draft (requires `version`) | `procurement.po.update` |
| P4 | POST | `/purchase-orders/:id/submit` | Draft → Pending Approval | `procurement.po.create` |
| P4 | POST | `/purchase-orders/:id/approve` / `.../reject` | Decision (`reject` needs `{comment}`); no self-approval | `procurement.po.approve` |
| P4 | POST | `/purchase-orders/:id/cancel` | Cancel (pre-receipt, `{reason}`) | `procurement.po.cancel` |
| P4 | POST | `/purchase-orders/:id/close` | Close with outstanding quantities (`{reason}`) | `procurement.po.close` |
| P4 | GET | `/purchase-orders/:id/receipts` | Receipts recorded against this PO | `procurement.receipt.view` |

### 5.3 Goods receipts (`P4`)

Receive against an **approved** PO; partial and multiple receipts supported; received > ordered rejected unless within the configured tolerance/override (`409 VALIDATION_ERROR` otherwise). Posting is the single point that creates stock ledger entries, serialized asset instances (with tags/barcodes/QR), and lot records — all linked to PO + GR.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P4 | GET | `/goods-receipts` | List (filters: `status`, `purchaseOrderId`, `supplierId`, `branchId`, `from`, `to`) | `procurement.receipt.view` |
| P4 | POST | `/goods-receipts` | Create draft `{purchaseOrderId, deliveryRefNo?, invoiceRefNo?, receivedDate, lines: [{poLineId, quantity, uomId, serials?: [], lots?: [{lotNo?, mfgDate?, expiryDate?, qty}], locationId?}]}` | `procurement.receipt.create` |
| P4 | GET | `/goods-receipts/:id` | Detail | `procurement.receipt.view` |
| P4 | PATCH | `/goods-receipts/:id` | Edit draft (requires `version`) | `procurement.receipt.create` |
| P4 | POST | `/goods-receipts/:id/post` | Post: stock in, assets created for serialized lines, lots created/attached, PO status updated (partial/full). **`Idempotency-Key` required** | `procurement.receipt.post` |
| P4 | POST | `/goods-receipts/:id/cancel` | Cancel draft (`{reason}`) | `procurement.receipt.create` |
| P4 | POST | `/goods-receipts/:id/reverse` | Reverse a posted receipt (`{reason}`); creates offsetting ledger entries, restores PO outstanding. **`Idempotency-Key` required** | `procurement.receipt.reverse` |

### 5.4 Supplier returns & purchase history (`P4`)

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P4 | GET / POST | `/supplier-returns`; `/supplier-returns/:id` GET / PATCH | Return-to-supplier documents (draft; requires `version` on PATCH) | `procurement.return.view` / `procurement.return.create` |
| P4 | POST | `/supplier-returns/:id/submit` / `.../approve` / `.../cancel` | Workflow actions | create / `procurement.po.approve` / `procurement.return.cancel` |
| P4 | POST | `/supplier-returns/:id/post` | Post stock-out to supplier. **`Idempotency-Key` required** | `procurement.return.post` |
| P4 | GET | `/purchase-history` | Search by supplier, item, branch, warehouse, date range, PO, receipt, status; reports ordered/received/outstanding/canceled/returned quantities; costs only with `procurement.view_cost` | `procurement.po.view` |

---

## 6. Phase 5 — Maintenance

Maintenance applies only to serialized asset instances. Branch scope follows the asset's branch.

### 6.1 Maintenance plans (`P5`)

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P5 | GET / POST | `/maintenance-plans` | Preventive templates: frequency (interval/meter/schedule), team/vendor, checklist, est. duration & cost, reminder lead time | `maintenance.plan.view` / `maintenance.plan.manage` |
| P5 | GET / PATCH | `/maintenance-plans/:id` | Detail / edit (requires `version`) | view / manage |
| P5 | POST | `/maintenance-plans/:id/activate` / `.../deactivate` | Toggle scheduling | `maintenance.plan.manage` |
| P5 | PUT | `/maintenance-plans/:id/assets` | Replace the set of assets covered `{assetIds[]}` | `maintenance.plan.manage` |

### 6.2 Work orders (`P5`)

Statuses: `Draft, Open, Assigned, Scheduled, In Progress, On Hold, Awaiting Parts, Awaiting Vendor, Completed, Verified, Canceled`. Opening a WO (or damage report / due plan / failed inspection) can move the asset to `Under Maintenance`; completion records final condition and the asset's next state (`Available | Assigned | Damaged | Retired`). Technicians (`maintenance.work_order.view`) see WOs assigned to them; `manage` sees branch-wide.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P5 | GET | `/maintenance-work-orders` | List (filters: `status`, `type`, `priority`, `assetId`, `branchId`, `assignedToMe`, `dueBefore`, `from`, `to`) | `maintenance.work_order.view` |
| P5 | POST | `/maintenance-work-orders` | Create `{assetId, type, priority, problem, reportedById?}`; WO number generated | `maintenance.work_order.manage` |
| P5 | GET | `/maintenance-work-orders/:id` | Detail: checklist, diagnosis, parts, costs, downtime, attachments | `maintenance.work_order.view` |
| P5 | PATCH | `/maintenance-work-orders/:id` | Edit open fields (requires `version`) | `maintenance.work_order.manage` |
| P5 | POST | `.../:id/assign` | `{technicianUserId?/team?/vendorId?}` → Assigned | `maintenance.work_order.manage` |
| P5 | POST | `.../:id/schedule` | `{plannedStart, plannedEnd}` → Scheduled | `maintenance.work_order.manage` |
| P5 | POST | `.../:id/start` | → In Progress (actual start; asset → Under Maintenance) | manage or assigned technician |
| P5 | POST | `.../:id/hold` / `.../resume` | `{reason: "On Hold"\|"Awaiting Parts"\|"Awaiting Vendor"}` / resume | manage or assigned technician |
| P5 | POST | `.../:id/complete` | `{resolution, actionTaken, finalCondition, assetNextStatus, laborCost?, externalCost?, downtimeMinutes, nextMaintenanceDate?}` → Completed | manage or assigned technician |
| P5 | POST | `.../:id/verify` | Supervisor sign-off → Verified | `maintenance.work_order.verify` |
| P5 | POST | `.../:id/cancel` | `{reason}` → Canceled (releases asset state) | `maintenance.work_order.manage` |
| P5 | PUT | `.../:id/tasks`; POST `.../:id/tasks/:taskId/complete` | Checklist management / tick-off | manage or assigned technician |
| P5 | GET / POST | `.../:id/parts-issues` | List parts consumed / create a **linked stock issue draft** (posts via §4.1 with `inventory.post`) — costs roll into the WO | view / `inventory.issue` |
| P5 | GET / POST | `/assets/:id/meter-readings` | Usage-meter history / record reading (drives meter-based plans) | `asset.view` / `asset.update` |

---

## 7. Phase 6 — Counts, approvals, notifications

### 7.1 Physical inventory & cycle counts (`P6`)

Counts never overwrite stock: approved discrepancies generate **draft stock-adjustment transactions** that flow through §4.1 approval + posting.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P6 | GET / POST | `/count-sessions` | List / create `{scope: {branchId, warehouseId?, locationId?, categoryId?, itemIds?}, blind: bool, type: "full"\|"cycle"}` | `count.view` / `count.create` |
| P6 | GET / PATCH | `/count-sessions/:id` | Detail / edit draft (requires `version`) | `count.view` / `count.create` |
| P6 | POST | `/count-sessions/:id/start` | Freeze/snapshot expected balances; generates count lines (expected qty hidden when blind) | `count.create` |
| P6 | POST | `/count-sessions/:id/lines/:lineId/count` | Record count `{countedQty}` — or for assets `{found, condition?, locationConfirmed?}`; flags missing/unexpected/duplicate/misplaced | `count.record` |
| P6 | POST | `/count-sessions/:id/scans` | Rapid-scan entry `{code, qty?}` (barcode-assisted counting) | `count.record` |
| P6 | POST | `/count-sessions/:id/recount` | Reopen selected lines `{lineIds[]}` | `count.record` |
| P6 | GET | `/count-sessions/:id/variance` | Variance report (expected vs counted vs recount) | `count.view` |
| P6 | POST | `/count-sessions/:id/complete` | Close counting; locks lines | `count.approve` |
| P6 | POST | `/count-sessions/:id/create-adjustments` | Generate draft adjustment transactions from approved variances. **`Idempotency-Key` required** | `count.approve` |
| P6 | POST | `/count-sessions/:id/cancel` | Cancel session (`{reason}`) | `count.cancel` |

### 7.2 Approvals framework (`P6`)

Configurable multi-step approvals for POs, disposals/write-offs, adjustments, inter-branch transfers, loss/damage declarations, retirements, and threshold-based rules. The resource action endpoints (`.../approve`, `.../reject` in §4–§6) delegate to this engine once it lands; before P6, a single-step default applies. A requester can never approve their own transaction (`409 SELF_APPROVAL_FORBIDDEN`) unless an explicitly permitted, audited override exists.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P6 | GET / POST | `/approval-workflows`; `/approval-workflows/:id` GET / PATCH | Configure: document type, branch scope, amount/qty thresholds, ordered steps (role or named approver) | `approval.manage` |
| P6 | POST | `/approval-workflows/:id/activate` / `.../deactivate` | Toggle | `approval.manage` |
| P6 | GET | `/approval-requests` | Queue (filters: `status`, `documentType`, `branchId`, `assignedToMe=true`); users always see their own + assigned; all requests need `approval.view` | session / `approval.view` |
| P6 | GET | `/approval-requests/:id` | Detail + full action history | assigned, requester, or `approval.view` |
| P6 | POST | `/approval-requests/:id/approve` | `{comment?}` — advances step or finalizes | assigned approver (or valid delegate) |
| P6 | POST | `/approval-requests/:id/reject` | `{comment}` **required** | assigned approver |
| P6 | POST | `/approval-requests/:id/return` | Return for revision `{comment}` — document goes back to Draft | assigned approver |
| P6 | GET / POST | `/approval-delegations`; DELETE `/approval-delegations/:id` | Delegate own approvals `{delegateUserId, startsAt, endsAt}`; managing others' delegations needs `approval.manage` | session (`approval.delegate`) |

### 7.3 Notifications (`P6`)

Always self-scoped — a user only ever sees their own notifications; no extra permission. In-app now; channel fan-out (email etc.) later. Types per spec §20 (low stock, pending approval, rejected txn, maintenance due/overdue, warranty & lot expiry, overdue return, unreceived transfer, separation with outstanding assets, failed job). Deep links + dedup included.

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P6 | GET | `/notifications` | Own notifications (filters: `read`, `type`) | session |
| P6 | GET | `/notifications/unread-count` | Badge count | session |
| P6 | POST | `/notifications/:id/read` / `/notifications/read-all` | Mark read | session |

---

## 8. Phase 7 — Dashboard, reports, exports

All respect permission + branch scope; value/cost widgets and columns require the relevant `*.view_cost` permission. Report-parameter filters follow §1.4 conventions (`branchId`, `warehouseId`, `categoryId`, `itemId`, `employeeId`, `departmentId`, `supplierId`, `status`, `from`, `to`).

| Phase | Method | Path | Purpose | Permission |
|---|---|---|---|---|
| P7 | GET | `/dashboard/summary` | KPIs: assets by status/condition, assigned vs available, SKU counts, low/out-of-stock, pending transfers & approvals, maintenance due/overdue, open WOs, warranty & lot expirations, recent transactions, open POs/receipts; inventory & acquisition value only with cost permissions | `reports.view` |
| P7 | GET | `/reports` | Report catalog with the caller's runnable subset | `reports.view` |
| P7 | GET | `/reports/asset-register` | Asset register | `reports.view` + `asset.view` |
| P7 | GET | `/reports/asset-custody` | Custody & assignment report | `reports.view` + `asset.view` |
| P7 | GET | `/reports/asset-movements` | Movement & lifecycle history | `reports.view` + `asset.view` |
| P7 | GET | `/reports/asset-condition` | Condition report | `reports.view` + `asset.view` |
| P7 | GET | `/reports/asset-terminal` | Retired / disposed / damaged / lost | `reports.view` + `asset.view` |
| P7 | GET | `/reports/stock-on-hand` | By branch/warehouse/location/item/lot/UOM | `reports.view` + `inventory.view` |
| P7 | GET | `/reports/stock-movement` | Ledger report | `reports.view` + `inventory.view` |
| P7 | GET | `/reports/low-stock` | Reorder recommendations (per-warehouse settings) | `reports.view` + `inventory.view` |
| P7 | GET | `/reports/consumption` | Issuance/consumption by employee, department, project, period | `reports.view` + `inventory.view` |
| P7 | GET | `/reports/expiring-lots` | Lots expiring in window | `reports.view` + `inventory.view` |
| P7 | GET | `/reports/count-variance` | Physical-count variance | `reports.view` + `count.view` |
| P7 | GET | `/reports/transfer-status` | Transfer status & in-transit inventory | `reports.view` + `transfer.view` |
| P7 | GET | `/reports/supplier-purchases` | Supplier purchase history | `reports.view` + `procurement.po.view` |
| P7 | GET | `/reports/po-status` | PO status & outstanding quantities | `reports.view` + `procurement.po.view` |
| P7 | GET | `/reports/maintenance-summary` | Due, overdue, cost, frequency, downtime | `reports.view` + `maintenance.work_order.view` |
| P7 | GET | `/reports/audit-activity` | Audit activity report | `reports.view` + `audit.view` |
| P7 | POST | `/exports` | Queue background export `{reportKey \| resource, format: "csv"\|"xlsx"\|"pdf", filters}` → `201 {id, status: "queued"}`; worker processes; user notified when ready; export itself is audit-logged | `reports.export` (+ underlying report permission) |
| P7 | GET | `/exports` / `/exports/:id` | Own export jobs / status | `reports.export` |
| P7 | GET | `/exports/:id/download` | Download finished file | `reports.export` (owner only) |

**Printable documents** (PDF, print-friendly; gated by the parent resource's view permission; each render is audit-logged):

| Phase | Method | Path | Form |
|---|---|---|---|
| P7 | GET | `/purchase-orders/:id/pdf` | Purchase order |
| P7 | GET | `/goods-receipts/:id/pdf` | Receiving report |
| P7 | GET | `/transfers/:id/pdf` | Transfer document |
| P7 | GET | `/assets/:id/acknowledgment-form` | Custody / acknowledgment form |
| P7 | GET | `/maintenance-work-orders/:id/pdf` | Work order |
| P7 | GET | `/count-sessions/:id/sheet` | Inventory count sheet |

---

## 9. Appendix A — Permission catalog (mirror of `@gemerp/shared` `PERMISSIONS`)

Strings from spec §8 are used verbatim (`asset.view` … `asset.dispose`, `inventory.*`, `procurement.po.create/approve`, `maintenance.work_order.manage`, `reports.export`, `audit.view`); the rest complete the matrix. `SUPER_ADMIN` holds `ALL_PERMISSIONS`.

| Family | Permissions | Phase |
|---|---|---|
| user | `user.view`, `user.create`, `user.update`, `user.activate`, `user.deactivate`, `user.assign_roles`, `user.assign_branches`, `user.reset_password` | 1 |
| role | `role.view`, `role.create`, `role.update`, `role.manage_permissions` | 1 |
| branch | `branch.view`, `branch.create`, `branch.update`, `branch.activate`, `branch.deactivate` | 1 |
| warehouse | `warehouse.view`, `warehouse.create`, `warehouse.update` (also govern storage locations) | 1 |
| audit | `audit.view`, `audit.export` | 1 |
| employee | `employee.view`, `employee.create`, `employee.update`, `employee.archive`, `employee.import`, `employee.export` | 2 |
| lookup | `lookup.view`, `lookup.manage` | 2 |
| item | `item.view`, `item.view_cost`, `item.create`, `item.update`, `item.archive`, `item.import`, `item.export` | 2 |
| inventory | `inventory.view`, `inventory.view_cost`, `inventory.receive`, `inventory.issue`, `inventory.return`, `inventory.transfer`, `inventory.adjust`, `inventory.approve`, `inventory.post`, `inventory.cancel`, `inventory.reverse`, `inventory.export` | 3 |
| asset | `asset.view`, `asset.view_cost`, `asset.create`, `asset.update`, `asset.assign`, `asset.transfer`, `asset.retire`, `asset.dispose`, `asset.report_incident`, `asset.print_label`, `asset.import` | 3 |
| transfer | `transfer.view`, `transfer.create`, `transfer.approve`, `transfer.dispatch`, `transfer.receive`, `transfer.cancel` | 3 |
| settings | `settings.manage` | 3 |
| supplier | `supplier.view`, `supplier.create`, `supplier.update`, `supplier.archive`, `supplier.import` | 4 |
| procurement | `procurement.view_cost`, `procurement.po.view`, `procurement.po.create`, `procurement.po.update`, `procurement.po.approve`, `procurement.po.cancel`, `procurement.po.close`, `procurement.receipt.view`, `procurement.receipt.create`, `procurement.receipt.post`, `procurement.receipt.reverse`, `procurement.return.view`, `procurement.return.create`, `procurement.return.post`, `procurement.return.cancel` | 4 |
| maintenance | `maintenance.plan.view`, `maintenance.plan.manage`, `maintenance.work_order.view`, `maintenance.work_order.manage`, `maintenance.work_order.verify`, `maintenance.view_cost` | 5 |
| count | `count.view`, `count.create`, `count.record`, `count.approve`, `count.cancel` | 6 |
| approval | `approval.view`, `approval.manage`, `approval.delegate` | 6 |
| reports | `reports.view`, `reports.export` | 7 |

## 10. Appendix B — Cross-cutting guarantees

1. **Deny by default.** No endpoint is reachable without an explicit permission (or documented self-scope rule) plus branch scope.
2. **Ledger integrity.** Stock balances are projections of immutable ledger entries; posted documents are never edited or deleted — only reversed with reason, actor, and audit trail.
3. **No silent mutation of approved documents.** Material changes require return-for-revision, cancellation, or reversal/correction flows.
4. **Everything sensitive is audited**: auth events, access changes, approvals, postings, reversals, exports, config changes — with actor, timestamp (UTC), branch, correlation ID, old/new values, and reason where required.
5. **OpenAPI is generated from the implementation** and served at `/api/docs`; the typed frontend client is generated from that contract. If this document and Swagger diverge, fix the code or this document — never let them drift silently.
