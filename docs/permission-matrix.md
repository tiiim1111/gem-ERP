# GEM ERP — Permission Matrix

Authoritative catalog of every permission string in GEM ERP (Asset & Inventory Management for GEM Cor), the seven initial roles, and the enforcement rules that bind them. Source spec: `asset-inventory-system-codex-master-prompt.md`, sections 8 (roles, permissions, branch scope), 19 (approvals), 22 (audit), 28 (security).

This document is the contract mirrored in code by `@gemerp/shared`:

- `PERMISSIONS` — nested const object containing every string below.
- `ALL_PERMISSIONS` — flat array of all 88 permission strings.
- `ROLE_DEFINITIONS` — the seven roles in section 2 with the exact grants in section 3.

Any change to this matrix must be made here and in `@gemerp/shared` in the same change set, and is itself an audited configuration change.

---

## 1. Conventions

- **Format**: `resource[.subresource].action`, lower snake_case segments, dot-separated. Examples: `asset.view`, `inventory.receive`, `procurement.po.create`, `maintenance.work_order.manage`, `user.branch_access.manage`.
- **Deny by default**: an endpoint or query is refused unless the caller holds the required permission AND branch access (section 4). There is no permission hierarchy or wildcard expansion at runtime — the checker compares opaque strings. `asset.*` in prose means "every permission in the asset group", never a runtime wildcard.
- **View is a prerequisite by design, not by inference**: holding a mutation permission does not imply the matching `*.view`. Roles defined here always pair them; a custom role granting `inventory.issue` without `inventory.view` is a configuration error surfaced in the role editor, not silently fixed.
- **Transaction permissions cover the document lifecycle**: a permission such as `inventory.receive` or `procurement.po.create` covers creating the draft, editing own drafts, submitting for approval, and posting once approved. Approval is always a separate permission (next rule). Posted documents are never edited — corrections go through reversal (`inventory.reverse`) or the document's cancel/void action.
- **Approval permissions are mechanical**: approving a controlled action `X` requires the permission `X` with `.approve` appended — `procurement.po.approve`, `inventory.adjust.approve`, `inventory.transfer.approve`, `asset.transfer.approve`, `asset.retire.approve`, `asset.dispose.approve`, `asset.declare_loss.approve`.
- **Cost visibility is separate per family**: `item.cost.view`, `inventory.cost.view`, `asset.cost.view`, `procurement.cost.view`, `maintenance.cost.view`. Without the family's cost permission, monetary fields are omitted from API responses, list columns, reports, and exports for that family.
- **Phases**: the group headers below note the phase in which the module ships. All 88 strings are defined (and seeded into the `permissions` table) from Phase 1 so role administration never needs a migration to reference a future module.

## 2. Roles

The seven initial roles. All are `isSystem: true`: their code, and the Super Admin's grant set, cannot be edited or deleted through the API; non-system custom roles can be added later via `role.create`.

| Code | Name | Intent (spec section 8) | Dev seed user |
|---|---|---|---|
| `SUPER_ADMIN` | Super Admin | Full system and all-branch access. Cannot bypass audit logging. Holds `ALL_PERMISSIONS`. | superadmin@gemcor.dev |
| `BRANCH_ADMIN` | Branch Admin | Manages authorized branches only: branch users, operations, approvals, and reports. | branchadmin@gemcor.dev |
| `WAREHOUSE_CUSTODIAN` | Warehouse Custodian | Receives, issues, returns, transfers, counts, and adjusts inventory, subject to approval rules. | warehouse@gemcor.dev |
| `ASSET_CUSTODIAN` | Asset Custodian | Registers, assigns, transfers, returns, inspects, and retires serialized assets, subject to approval rules. | assets@gemcor.dev |
| `MAINTENANCE_PERSONNEL` | Maintenance Personnel | Views maintainable assets, manages assigned maintenance work orders, consumes approved spare parts through linked stock issues. | maintenance@gemcor.dev |
| `AUDITOR` | Auditor / Viewer | Read-only access to authorized branches, reports, ledgers, and audit logs. Export granted by default but separately revocable. | auditor@gemcor.dev |
| `EMPLOYEE` | Employee / Requester | Views assets assigned to them, acknowledges issuance/return, reports damage or loss, creates permitted requests. | employee@gemcor.dev |

Users may hold multiple roles; effective permissions are the union (section 4.3). Grant totals: SUPER_ADMIN 88, BRANCH_ADMIN 79, WAREHOUSE_CUSTODIAN 21, ASSET_CUSTODIAN 23, MAINTENANCE_PERSONNEL 13, AUDITOR 21, EMPLOYEE 4.

## 3. Permission Catalog and Role Matrix

Column legend: **SA** Super Admin, **BA** Branch Admin, **WC** Warehouse Custodian, **AC** Asset Custodian, **MP** Maintenance Personnel, **AUD** Auditor / Viewer, **EMP** Employee / Requester. `✓` granted, `–` not granted. SA holds every permission by definition.

### 3.1 Users — `user.*` (Phase 1)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `user.view` | View user accounts, their roles, and branch access | ✓ | ✓ | – | – | – | ✓ | – |
| `user.create` | Create user accounts | ✓ | ✓ | – | – | – | – | – |
| `user.update` | Edit user profile details (name, email) | ✓ | ✓ | – | – | – | – | – |
| `user.activate` | Reactivate a deactivated user | ✓ | ✓ | – | – | – | – | – |
| `user.deactivate` | Deactivate a user (blocks login, revokes sessions) | ✓ | ✓ | – | – | – | – | – |
| `user.roles.manage` | Assign or remove roles on a user | ✓ | ✓¹ | – | – | – | – | – |
| `user.branch_access.manage` | Grant or revoke a user's branch access | ✓ | ✓¹ | – | – | – | – | – |
| `user.password.reset` | Force-reset another user's password | ✓ | ✓ | – | – | – | – | – |

¹ Guardrails in section 4.5 apply: a Branch Admin cannot assign `SUPER_ADMIN`, cannot manage users holding it, and can only grant branch access within their own branches.

### 3.2 Roles — `role.*` (Phase 1)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `role.view` | View roles and the permission catalog (`GET /permissions`) | ✓ | ✓ | – | – | – | ✓ | – |
| `role.create` | Create custom (non-system) roles | ✓ | – | – | – | – | – | – |
| `role.update` | Edit role name/description; system roles are locked | ✓ | – | – | – | – | – | – |
| `role.permissions.manage` | Change the permission set attached to a role | ✓ | – | – | – | – | – | – |

### 3.3 Branches — `branch.*` (Phase 1)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `branch.view` | View branches in the caller's branch scope | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `branch.create` | Create branches | ✓ | – | – | – | – | – | – |
| `branch.update` | Edit branch details (code, name, address) | ✓ | – | – | – | – | – | – |
| `branch.activate` | Reactivate an inactive branch | ✓ | – | – | – | – | – | – |
| `branch.deactivate` | Deactivate a branch without deleting history | ✓ | – | – | – | – | – | – |

### 3.4 Warehouses and Storage Locations — `warehouse.*` (Phase 1)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `warehouse.view` | View warehouses and their storage locations | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `warehouse.create` | Create warehouses/stockrooms in an accessible branch | ✓ | ✓ | – | – | – | – | – |
| `warehouse.update` | Edit warehouse details, active flag, default receiving/issuance locations | ✓ | ✓ | – | – | – | – | – |
| `warehouse.location.manage` | Create and edit storage locations (zone/aisle/rack/shelf/bin) | ✓ | ✓ | – | – | – | – | – |

### 3.5 Employees — `employee.*` (Phase 2)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `employee.view` | View employee records, current assets, issuance history | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `employee.create` | Create employee records | ✓ | ✓ | – | – | – | – | – |
| `employee.update` | Edit employee records | ✓ | ✓ | – | – | – | – | – |
| `employee.archive` | Archive/deactivate employees (separation workflow) | ✓ | ✓ | – | – | – | – | – |
| `employee.import` | Bulk import employees from CSV/XLSX | ✓ | ✓ | – | – | – | – | – |
| `employee.notes.view` | View restricted-visibility employee notes | ✓ | ✓ | – | – | – | – | – |

### 3.6 Item Master — `item.*` (Phase 2)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `item.view` | View items, barcodes, UOM conversions, reorder settings | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `item.create` | Create catalog items | ✓ | ✓ | – | – | – | – | – |
| `item.update` | Edit items, barcode mappings, per-warehouse reorder settings | ✓ | ✓ | – | – | – | – | – |
| `item.archive` | Deactivate/archive items | ✓ | ✓ | – | – | – | – | – |
| `item.import` | Bulk import item master from CSV/XLSX | ✓ | ✓ | – | – | – | – | – |
| `item.cost.view` | View standard and last purchase cost on items | ✓ | ✓ | – | – | – | ✓ | – |
| `item.label.print` | Print SKU, lot, and bin barcode labels | ✓ | ✓ | ✓ | – | – | – | – |

### 3.7 Suppliers — `supplier.*` (Phase 4)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `supplier.view` | View suppliers, contacts, purchase/delivery history | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `supplier.create` | Create suppliers | ✓ | ✓ | – | – | – | – | – |
| `supplier.update` | Edit suppliers and contacts | ✓ | ✓ | – | – | – | – | – |
| `supplier.archive` | Deactivate/archive suppliers | ✓ | ✓ | – | – | – | – | – |
| `supplier.import` | Bulk import suppliers from CSV/XLSX | ✓ | ✓ | – | – | – | – | – |

### 3.8 Inventory — `inventory.*` (Phases 3 and 6)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `inventory.view` | View stock balances, ledger, lots, and transaction history | ✓ | ✓ | ✓ | – | ✓ | ✓ | – |
| `inventory.view_own` | View stock transactions where the viewer is the receiving employee | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `inventory.receive` | Draft/post opening balances and non-PO receipts | ✓ | ✓ | ✓ | – | – | – | – |
| `inventory.issue` | Draft/post issues to employee, department, or project | ✓ | ✓ | ✓ | – | – | – | – |
| `inventory.return` | Draft/post returns from employees and returns to supplier | ✓ | ✓ | ✓ | – | – | – | – |
| `inventory.transfer` | Draft/submit/dispatch/receive stock transfers (location, warehouse, inter-branch) | ✓ | ✓ | ✓ | – | – | – | – |
| `inventory.transfer.approve` | Approve inter-branch stock transfers | ✓ | ✓ | – | – | – | – | – |
| `inventory.adjust` | Draft/submit stock adjustment increases and decreases | ✓ | ✓ | ✓ | – | – | – | – |
| `inventory.adjust.approve` | Approve stock adjustments, including count variances | ✓ | ✓ | – | – | – | – | – |
| `inventory.reverse` | Post reversal transactions against posted stock movements | ✓ | ✓ | – | – | – | – | – |
| `inventory.count` | Create and record physical/cycle count sessions | ✓ | ✓ | ✓ | – | – | – | – |
| `inventory.cost.view` | View unit/total costs on stock transactions and inventory value on reports | ✓ | ✓ | – | – | – | ✓ | – |

### 3.9 Serialized Assets — `asset.*` (Phase 3)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `asset.view` | View asset instances, custody, condition, and status history | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| `asset.view_own` | View assets currently assigned to the viewer | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `asset.create` | Register asset instances (manual entry or import) | ✓ | ✓ | – | ✓ | – | – | – |
| `asset.update` | Edit asset details, condition, attachments | ✓ | ✓ | – | ✓ | – | – | – |
| `asset.assign` | Assign, issue, or reassign assets to employee/department/project/location | ✓ | ✓ | – | ✓ | – | – | – |
| `asset.return` | Process asset returns and record return condition | ✓ | ✓ | – | ✓ | – | – | – |
| `asset.transfer` | Draft/submit/dispatch/receive asset transfers | ✓ | ✓ | – | ✓ | – | – | – |
| `asset.transfer.approve` | Approve inter-branch asset transfers | ✓ | ✓ | – | – | – | – | – |
| `asset.retire` | Draft/submit asset retirement | ✓ | ✓ | – | ✓ | – | – | – |
| `asset.retire.approve` | Approve asset retirement | ✓ | ✓ | – | – | – | – | – |
| `asset.dispose` | Draft/submit disposal or write-off | ✓ | ✓ | – | ✓ | – | – | – |
| `asset.dispose.approve` | Approve disposal or write-off | ✓ | ✓ | – | – | – | – | – |
| `asset.report_incident` | Report damage or loss of an asset in own custody | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `asset.declare_loss` | Draft/submit a lost/damaged asset declaration | ✓ | ✓ | – | ✓ | – | – | – |
| `asset.declare_loss.approve` | Approve lost/damaged declarations (and authorized recovery) | ✓ | ✓ | – | – | – | – | – |
| `asset.acknowledge` | Acknowledge an issuance or return directed to the signed-in user | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| `asset.cost.view` | View acquisition cost and asset value figures | ✓ | ✓ | – | ✓ | – | ✓ | – |
| `asset.label.print` | Print asset tag barcode/QR labels | ✓ | ✓ | – | ✓ | – | – | – |

### 3.10 Maintenance — `maintenance.*` (Phase 5)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `maintenance.view` | View plans, work orders, schedules, and history | ✓ | ✓ | – | ✓ | ✓ | ✓ | – |
| `maintenance.plan.manage` | Create/edit preventive maintenance plans and schedules | ✓ | ✓ | – | – | – | – | – |
| `maintenance.work_order.manage` | Create, assign, progress, complete, and verify work orders | ✓ | ✓ | – | – | ✓² | – | – |
| `maintenance.parts.issue` | Post maintenance-parts stock issues linked to a work order | ✓ | ✓ | – | – | ✓ | – | – |
| `maintenance.cost.view` | View labor, parts, external-service cost and downtime figures | ✓ | ✓ | – | – | ✓ | ✓ | – |

² Record-scoped for this role: Maintenance Personnel may only manage work orders assigned to them or their team (section 5).

### 3.11 Procurement — `procurement.*` (Phase 4)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `procurement.po.view` | View purchase orders, goods receipts, and purchase history | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `procurement.po.create` | Draft/edit/submit purchase orders | ✓ | ✓ | – | – | – | – | – |
| `procurement.po.approve` | Approve purchase orders | ✓ | ✓ | – | – | – | – | – |
| `procurement.po.cancel` | Cancel or close purchase orders | ✓ | ✓ | – | – | – | – | – |
| `procurement.po.print` | Print/PDF purchase order forms | ✓ | ✓ | – | – | – | – | – |
| `procurement.receipt.create` | Draft/post goods receipts against approved POs (partial receipts included) | ✓ | ✓ | ✓ | – | – | – | – |
| `procurement.cost.view` | View prices, discounts, taxes, and totals on POs and purchase history | ✓ | ✓ | – | – | – | ✓ | – |

Without `procurement.cost.view`, receiving is effectively blind: the Warehouse Custodian sees ordered/received quantities but no monetary fields.

### 3.12 Approvals — `approval.*` (Phase 6)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `approval.view` | View approval requests, queues, and full approval history in scope | ✓ | ✓ | – | – | – | ✓ | – |
| `approval.workflow.manage` | Configure approval workflows, steps, thresholds, and delegations | ✓ | – | – | – | – | – | – |

Acting on an approval step additionally requires the document-specific `.approve` permission (section 1). Requesters always see the status and history of their own submissions without `approval.view`.

### 3.13 Reports and Dashboards — `report.*` (Phase 7; dashboard shell earlier)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `report.view` | Access dashboards and operational reports (branch-scoped) | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| `report.export` | Export lists/reports to CSV/XLSX/PDF, including queued background exports | ✓ | ✓ | – | – | – | ✓ | – |

Every export also requires the underlying `*.view` permission of the data being exported, and the family cost permission for cost columns. Exports of sensitive data are audit-logged.

### 3.14 Audit — `audit.*` (Phase 1)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `audit.view` | Search the append-only audit log (`GET /audit-logs`), branch-scoped | ✓ | ✓ | – | – | – | ✓ | – |
| `audit.export` | Export audit log search results | ✓ | ✓ | – | – | – | ✓ | – |

No permission allows editing or deleting audit records; the log is append-only for every user including Super Admin.

### 3.15 Settings — `settings.*` (Phase 1 onward)

| Permission | Description | SA | BA | WC | AC | MP | AUD | EMP |
|---|---|---|---|---|---|---|---|---|
| `settings.manage` | Manage org settings, lookup tables, UOM catalog, sequence formats, notification rules, negative-stock policy | ✓ | – | – | – | – | – | – |

---

## 4. Enforcement Model

### 4.1 Evaluation pipeline

Every protected request passes these checks in order, in the backend (never frontend-only):

1. **Authentication** — valid, unexpired `gemerp_session` cookie resolving to an active user; otherwise `401` with error code `AUTH_REQUIRED`.
2. **Permission** — the required permission string is in the caller's effective permission set (4.3); otherwise `403` `PERMISSION_DENIED`.
3. **Branch scope** — the branch of every record touched is in the caller's branch access (4.2); otherwise `403` `BRANCH_ACCESS_DENIED`. List endpoints filter silently to accessible branches instead of erroring.
4. **Record-level scope refinements** — own-custody and assigned-work-order rules (section 5).
5. **Business rules** — status transitions, self-approval prohibition (4.4), stock rules, etc.

Errors use the standard envelope `{ "error": { "code", "message", "details?" } }` and never leak which specific record exists outside the caller's scope (missing and forbidden-by-branch both read as not found on detail endpoints, to prevent probing).

### 4.2 Branch scope rule

**A request succeeds only when BOTH the permission check and the branch check pass.** Holding `inventory.issue` grants nothing in a branch the user cannot access; having branch access grants nothing without the permission.

- Branch access is explicit rows in `user_branch_access`, exposed as `SessionUser.branchIds`.
- Super Admins (`isSuperAdmin: true`, derived from holding the `SUPER_ADMIN` role — see 4.3) implicitly have all branches; `branchIds` is informational for them.
- The check applies to direct records and joined/related records: a stock transaction is scoped by its warehouse's branch, an asset by its current branch, an audit entry by its `branchId`, an approval request by its document's branch.
- Multi-branch documents (inter-branch transfers): creating and dispatching require access to the **source** branch; receiving requires access to the **destination** branch; approving requires access to the source branch. Users see a transfer if they can access either endpoint branch.
- Org-wide resources (users, roles, item master, suppliers, lookup values, settings) are not branch-scoped as records, but Branch Admin guardrails (4.5) still constrain user administration to their branches.
- All list, search, report, export, dashboard, and detail endpoints enforce branch scope server-side. Frontend filtering is presentation only, never authorization.

### 4.3 Effective permissions and user overrides

```
effectivePermissions(user):
  if user holds role SUPER_ADMIN:
      return ALL_PERMISSIONS          # overrides are NOT applied
  base    = union of permissions of all active roles of the user
  granted = user_permission_overrides where effect = GRANT
  revoked = user_permission_overrides where effect = REVOKE
  return (base ∪ granted) − revoked
```

- **Overrides** live in `user_permission_overrides`: `{ userId, permission, effect: GRANT | REVOKE, reason, grantedById, createdAt, expiresAt? }`. A GRANT adds a single permission a user's roles lack; a REVOKE removes a single permission their roles would give. REVOKE wins over any role and over GRANT for the same string.
- Overrides cannot touch a Super Admin: the `SUPER_ADMIN` role always evaluates to `ALL_PERMISSIONS`, and the API rejects override rows targeting users who hold it.
- Every override create/expire/delete is audit-logged with actor, target user, permission, effect, and the mandatory `reason`. Override evaluation ships with the Phase 1 authorization layer; management UI/endpoints are Super Admin-only and may land after Phase 1 (see assumptions).
- The effective set (roles + overrides) is snapshotted into `SessionUser.permissions` at login and refreshed when roles, role permissions, branch access, or overrides change (session refresh or forced re-evaluation on the sliding-window touch).

### 4.4 Self-approval prohibition

Per spec section 19: **a requester cannot approve their own controlled transaction**, even when they hold the matching `.approve` permission.

- At approval-action time the service rejects the action if the actor is the creator or submitter of the underlying document, with error code `APPROVAL_SELF_NOT_ALLOWED`.
- The prohibition applies to every controlled type: POs, stock adjustments, inter-branch transfers (stock and asset), disposal/write-off, retirement, lost/damaged declarations, and any workflow-configured type.
- The only exception is an explicit per-workflow setting (`allowSelfApproval`, default `false`) that can be enabled solely via `approval.workflow.manage`; enabling it and every self-approval performed under it are prominently audit-logged.
- Delegation does not bypass the rule: a delegate cannot approve a document they themselves created.

### 4.5 Guardrails (privilege-escalation prevention)

- Only a Super Admin may assign or remove the `SUPER_ADMIN` role, or deactivate/reset/manage a user who holds it. Branch Admins' `user.roles.manage` is restricted to non-system-critical roles (everything except `SUPER_ADMIN`).
- `user.branch_access.manage` held by a Branch Admin can only grant/revoke branches within the admin's own branch access.
- System roles (`isSystem: true`) cannot be renamed, deleted, or — for `SUPER_ADMIN` — repermissioned. `role.permissions.manage` on the other system roles is allowed (Super Admin only) so GEM Cor can tune defaults, and every change is audited.
- Users referenced by business records are never hard-deleted; `user.deactivate` is the terminal action and revokes all their sessions.
- No permission exempts anyone from audit logging.

---

## 5. Record-Level Scope Refinements

Applied after permission and branch checks; these narrow, never widen, access:

| Rule | Affects | Behavior |
|---|---|---|
| Own custody | `asset.view_own`, `inventory.view_own` | Returns only records where the caller's linked employee is the current custodian / receiving employee. `asset.view` / `inventory.view` supersede these within branch scope. |
| Own acknowledgment | `asset.acknowledge` | Can only acknowledge issuances/returns addressed to the caller's linked employee. Covers consumable-issue acknowledgments where the workflow requires one. |
| Own incident reports | `asset.report_incident` | Can only file reports for assets in the caller's own custody (roles with `asset.view` may report on any asset in branch scope). |
| Assigned work orders | `maintenance.work_order.manage` held via `MAINTENANCE_PERSONNEL` | Limited to work orders assigned to the caller or their team; the same permission via `BRANCH_ADMIN`/`SUPER_ADMIN` is unrestricted within branch scope. |
| Restricted notes | `employee.notes.view` | Employee notes are omitted from responses without this permission even when `employee.view` passes. |

## 6. Cross-Cutting Rules

- **Attachments** inherit the parent record's authorization: uploading/downloading an attachment requires the view (download) or update/create (upload) permission of the owning resource plus its branch scope. Attachment archival is audited.
- **Notifications** need no permission: users always see their own notifications. Recipient rules decide fan-out using this matrix (e.g., low-stock alerts go to users holding `inventory.view` in the warehouse's branch).
- **Imports** map to the owning family: `employee.import`, `item.import`, `supplier.import`; opening-balance imports require `inventory.receive`; existing-asset imports require `asset.create`; lookup-value imports require `settings.manage`. All imports are audited.
- **Exports** are uniformly gated by `report.export` plus the underlying view permission (section 3.13); `audit.export` is the one specialized export permission because of the log's sensitivity.
- **Lookup tables** (section 10 of the spec) are administered under `settings.manage`; reading active lookup values requires only authentication, since every module's forms depend on them.
- **Scan endpoints** (barcode/QR resolution) require authentication plus the resolved record's view permission and branch scope — a scan token is never an access bypass.
- **Dashboards** show only the tiles the caller's permissions allow; monetary tiles (inventory value, acquisition value) additionally require the relevant cost permission.

## 7. Change Management

To add a permission: add the string to this document (catalog + matrix row), to `PERMISSIONS`/`ALL_PERMISSIONS` in `@gemerp/shared`, to the `permissions` table seed, and to `ROLE_DEFINITIONS` for any role that should hold it by default. Role grant changes on live systems go through `role.permissions.manage` and are audit-logged. Never rename a shipped permission string; deprecate and migrate explicitly, because override rows and audit history reference strings verbatim.

## Appendix A — Assumptions

1. The spec's example `reports.export` is normalized to `report.export` to keep every resource segment singular (`user.*`, `role.*`, `branch.*`, ..., `report.*`), per the project's canonical naming convention. All other spec-section-8 example strings are kept verbatim.
2. Approval permissions follow the mechanical `<base-permission>.approve` pattern; `procurement.po.approve` from the spec anchors it.
3. Storage locations are governed by the `warehouse.*` group (`warehouse.location.manage`) rather than their own group.
4. Auditor / Viewer receives `report.export` and `audit.export` by default; the spec allows export to be configured separately, which is handled by editing the role or a per-user REVOKE override.
5. Branch Admin manages the org-wide item master and supplier registry (single-company deployment; catalog stewardship would otherwise fall solely on Super Admin).
6. Warehouse Custodian receives no cost permissions (blind receiving); Asset Custodian sees acquisition costs because they register assets from receipts.
7. Override management endpoints are not in the Phase 1 API surface; the evaluation logic and audited data model ship in Phase 1, administration UI follows.
8. The spec's Employee "creates permitted requests" has no dedicated request module in the phase plan; request-type permissions will be added to this matrix when Phase 6 approval workflows define them.

## Appendix B — Catalog Totals

88 permissions across 15 groups: user 8, role 4, branch 5, warehouse 4, employee 6, item 7, supplier 5, inventory 12, asset 18, maintenance 5, procurement 7, approval 2, report 2, audit 2, settings 1.
