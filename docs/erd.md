# GEM ERP — Entity-Relationship Design (ERD)

Asset & Inventory Management for GemCor. Single company, multi-branch.

**Source of truth:** `packages/database/prisma/schema.prisma` (66 models, 20 enums).
This document is generated from that schema and must be kept in sync with it. The
schema realizes the "Suggested Core Data Model" of the master spec
(`asset-inventory-system-codex-master-prompt.md`, section 26); deviations are listed
in [Gaps to address](#11-gaps-to-address).

## Schema-wide conventions

- **Primary keys:** UUID everywhere — `@id @default(uuid()) @db.Uuid`. Business
  document numbers (PO number, asset tag, transaction number, ...) come from
  `sequence_counters`, never from the PK.
- **Naming:** snake_case table names via `@@map`, snake_case columns via `@map`.
- **Money:** `Decimal(14, 2)`. **Quantities:** `Decimal(14, 4)`.
- **Enums** exist only for true invariants (document statuses, asset lifecycle,
  tracking method, business category, transaction types, approval states). All
  business-managed vocabularies (conditions, reasons, maintenance types,
  priorities, supplier categories, document types, ...) live in `lookup_values`
  and are referenced by FK with `onDelete: Restrict`.
- **FK delete behavior:** `Restrict` by default; `Cascade` only for pure child
  rows (document lines, join tables, contacts, per-item settings); `SetNull`
  only for optional convenience pointers (e.g. warehouse default locations).
- **Archival:** master data carries `is_active` and/or `archived_at` — soft
  archive, never hard delete of referenced records. Ledger/audit tables are
  append-only. Documents are never deleted; they end life in a terminal status
  (`CANCELED`, `REVERSED`, `CLOSED`, ...).
- **Time:** all timestamps stored in UTC; org display timezone Asia/Manila.
  Default currency PHP.

---

## 1. Identity and access

Tables: `organizations`, `users`, `user_sessions`, `roles`, `permissions`,
`role_permissions`, `user_roles`, `user_branch_access`, `user_permission_overrides`.

```mermaid
erDiagram
  organizations ||--o{ branches : "has"
  users ||--o{ user_sessions : "opens"
  users ||--o{ user_roles : ""
  roles ||--o{ user_roles : ""
  roles ||--o{ role_permissions : ""
  permissions ||--o{ role_permissions : ""
  users ||--o{ user_branch_access : ""
  branches ||--o{ user_branch_access : ""
  users ||--o{ user_permission_overrides : "subject of"
  permissions ||--o{ user_permission_overrides : ""

  organizations {
    uuid id PK
    string code UK
    string name
    string timezone "default Asia/Manila"
    string currency_code "default PHP"
  }
  users {
    uuid id PK
    string email UK
    string password_hash "argon2id"
    string display_name
    boolean is_active
    int failed_login_count
    datetime locked_until "login throttling"
    datetime archived_at
  }
  user_sessions {
    uuid id PK
    uuid user_id FK
    string token_hash UK "SHA-256 of opaque token"
    datetime expires_at "12h sliding"
    datetime revoked_at
  }
  roles {
    uuid id PK
    string code UK
    string name
    boolean is_system
  }
  permissions {
    uuid id PK
    string code UK "resource.action"
    string resource
    string action
  }
  role_permissions {
    uuid id PK
    uuid role_id FK
    uuid permission_id FK
  }
  user_roles {
    uuid id PK
    uuid user_id FK
    uuid role_id FK
  }
  user_branch_access {
    uuid id PK
    uuid user_id FK
    uuid branch_id FK
  }
  user_permission_overrides {
    uuid id PK
    uuid user_id FK
    uuid permission_id FK
    enum effect "ALLOW | DENY"
    datetime expires_at
  }
```

## 2. Organization structure and employees

Tables: `branches`, `warehouses`, `storage_locations`, `departments`,
`positions`, `employees`.

```mermaid
erDiagram
  organizations ||--o{ branches : "has"
  branches ||--o{ warehouses : "has"
  warehouses ||--o{ storage_locations : "has"
  storage_locations |o--o{ storage_locations : "parent (zone/aisle/rack/shelf/bin)"
  storage_locations |o--o{ warehouses : "default receiving / issue (SetNull)"
  branches |o--o{ departments : "optionally scopes"
  branches ||--o{ employees : "home branch"
  departments |o--o{ employees : ""
  positions |o--o{ employees : ""
  employees |o--o{ employees : "supervisor"
  users |o--o| employees : "optional login link (1:1)"

  branches {
    uuid id PK
    uuid organization_id FK
    string code UK
    string name
    boolean is_active
    datetime archived_at
  }
  warehouses {
    uuid id PK
    uuid branch_id FK
    string code "unique per branch"
    uuid default_receiving_location_id FK
    uuid default_issue_location_id FK
    datetime archived_at
  }
  storage_locations {
    uuid id PK
    uuid warehouse_id FK
    uuid parent_id FK
    string code "unique per warehouse"
    string location_type
    string barcode UK "BIN-{BRANCH}-{WH}-{LOC}"
  }
  departments {
    uuid id PK
    uuid branch_id FK "optional"
    string code UK
  }
  positions {
    uuid id PK
    string code UK
  }
  employees {
    uuid id PK
    string employee_number UK
    string work_email UK
    uuid branch_id FK
    uuid department_id FK
    uuid position_id FK
    uuid supervisor_id FK
    enum status "EmployeeStatus"
    uuid user_id FK "unique, optional"
    datetime archived_at
  }
```

## 3. Catalog and inventory

### 3.1 Item master and catalog

Tables: `item_categories`, `item_subcategories`, `brands`, `manufacturers`,
`units_of_measure`, `uom_conversions`, `items`, `item_barcodes`,
`item_warehouse_settings`, `inventory_lots`.

```mermaid
erDiagram
  item_categories ||--o{ item_subcategories : "has"
  item_categories |o--o{ items : ""
  item_subcategories |o--o{ items : ""
  brands |o--o{ items : ""
  manufacturers |o--o{ items : ""
  units_of_measure ||--o{ items : "base UOM (purchase/issue optional)"
  suppliers |o--o{ items : "default supplier"
  items ||--o{ uom_conversions : "item-specific factors"
  units_of_measure ||--o{ uom_conversions : "from / to"
  items ||--o{ item_barcodes : "alternate barcodes"
  items ||--o{ item_warehouse_settings : "reorder policy"
  warehouses ||--o{ item_warehouse_settings : ""
  items ||--o{ inventory_lots : "lot/batch"

  items {
    uuid id PK
    string sku UK "SKU-{CATEGORY}-{SEQ}"
    string name
    enum business_category "BusinessCategory"
    enum tracking_method "TrackingMethod"
    uuid base_uom_id FK
    uuid default_supplier_id FK
    decimal standard_cost
    boolean is_lot_tracked
    boolean is_expiry_tracked
    boolean requires_serial_number
    boolean is_maintainable
    datetime archived_at
  }
  item_categories {
    uuid id PK
    string code UK
  }
  item_subcategories {
    uuid id PK
    uuid category_id FK
    string code "unique per category"
  }
  units_of_measure {
    uuid id PK
    string code UK
  }
  uom_conversions {
    uuid id PK
    uuid item_id FK
    uuid from_uom_id FK
    uuid to_uom_id FK
    decimal factor "1 from = factor x to"
  }
  item_barcodes {
    uuid id PK
    uuid item_id FK
    string barcode "unique while active"
    uuid uom_id FK
    boolean is_primary
    boolean is_active "true or NULL, never false"
  }
  item_warehouse_settings {
    uuid id PK
    uuid item_id FK
    uuid warehouse_id FK
    decimal reorder_level
    decimal reorder_quantity
    uuid default_storage_location_id FK
  }
  inventory_lots {
    uuid id PK
    uuid item_id FK
    string lot_number "unique per item"
    date expiry_date
    string barcode UK "LOT-{SKU}-{DATE}-{SEQ}"
  }
```

### 3.2 Inventory ledger

Tables: `stock_transactions`, `stock_transaction_lines`, `stock_ledger_entries`,
`stock_balances`, `stock_reservations`. See section
[9. Ledger integrity](#9-ledger-integrity) for the posting contract.

```mermaid
erDiagram
  stock_transactions ||--o{ stock_transaction_lines : "lines (Cascade)"
  stock_transactions ||--o{ stock_ledger_entries : "posting writes"
  stock_transaction_lines |o--o{ stock_ledger_entries : ""
  stock_transactions |o--o{ stock_transactions : "reversal_of"
  branches ||--o{ stock_transactions : "owning branch"
  items ||--o{ stock_transaction_lines : ""
  inventory_lots |o--o{ stock_transaction_lines : ""
  assets |o--o{ stock_transaction_lines : "serialized lines"
  storage_locations |o--o{ stock_transaction_lines : "source / destination"
  items ||--o{ stock_ledger_entries : ""
  warehouses ||--o{ stock_ledger_entries : ""
  items ||--o{ stock_balances : "projection of ledger"
  warehouses ||--o{ stock_balances : ""
  items ||--o{ stock_reservations : ""
  warehouses ||--o{ stock_reservations : ""
  transfers |o--o{ stock_reservations : "reserves for"

  stock_transactions {
    uuid id PK
    string transaction_number UK "from sequence_counters"
    enum type "StockTransactionType"
    enum status "StockDocumentStatus"
    date transaction_date
    uuid branch_id FK
    uuid source_warehouse_id FK
    uuid destination_warehouse_id FK
    uuid employee_id FK "issue/return party"
    uuid purchase_order_id FK
    uuid goods_receipt_id FK
    uuid transfer_id FK
    uuid maintenance_work_order_id FK
    uuid count_session_id FK
    uuid reversal_of_id FK
    uuid created_by_id FK
    datetime posted_at
  }
  stock_transaction_lines {
    uuid id PK
    uuid transaction_id FK
    int line_number "unique per transaction"
    uuid item_id FK
    uuid lot_id FK
    uuid asset_id FK
    uuid entered_uom_id FK
    decimal entered_quantity
    decimal base_quantity "in item base UOM"
    decimal unit_cost
  }
  stock_ledger_entries {
    uuid id PK
    uuid transaction_id FK
    uuid transaction_line_id FK
    uuid item_id FK
    uuid lot_id FK
    uuid asset_id FK
    uuid branch_id FK
    uuid warehouse_id FK
    uuid storage_location_id FK
    decimal quantity_delta "signed, base UOM"
    datetime posted_at "append-only, no updated_at"
  }
  stock_balances {
    uuid id PK
    uuid item_id FK
    uuid branch_id FK
    uuid warehouse_id FK
    uuid storage_location_id FK
    uuid lot_id FK
    decimal on_hand_qty
    decimal reserved_qty
    decimal in_transit_qty
  }
  stock_reservations {
    uuid id PK
    uuid item_id FK
    uuid warehouse_id FK
    uuid lot_id FK
    decimal quantity
    enum status "StockReservationStatus"
    uuid transfer_id FK
    datetime expires_at
  }
```

## 4. Serialized assets

Tables: `assets`, `asset_assignments`, `asset_movements`,
`asset_condition_history`, `asset_status_history`, `asset_acknowledgments`.
(`asset_meter_readings` is drawn with maintenance in section 7, matching spec
grouping.)

```mermaid
erDiagram
  items ||--o{ assets : "instance of"
  branches ||--o{ assets : "current branch"
  warehouses |o--o{ assets : "current warehouse"
  storage_locations |o--o{ assets : "current bin"
  employees |o--o{ assets : "current custodian"
  suppliers |o--o{ assets : "acquired from"
  goods_receipt_lines |o--o{ assets : "created by receipt"
  lookup_values |o--o{ assets : "condition / criticality / disposal method"
  assets ||--o{ asset_assignments : "custody records"
  employees |o--o{ asset_assignments : "assignee"
  departments |o--o{ asset_assignments : "assignee"
  asset_assignments ||--o{ asset_acknowledgments : "issue / return ack"
  assets ||--o{ asset_movements : "location history"
  asset_assignments |o--o{ asset_movements : ""
  transfers |o--o{ asset_movements : ""
  assets ||--o{ asset_condition_history : ""
  assets ||--o{ asset_status_history : ""

  assets {
    uuid id PK
    string asset_tag UK "AST-{BRANCH}-{CAT}-{YEAR}-{SEQ}"
    string scan_token UK "opaque QR token"
    string serial_number "unique per item"
    uuid item_id FK
    enum status "AssetLifecycleStatus"
    uuid branch_id FK
    uuid custodian_employee_id FK
    date acquisition_date
    decimal acquisition_cost
    date warranty_end_date
    datetime next_maintenance_at
    datetime archived_at
  }
  asset_assignments {
    uuid id PK
    uuid asset_id FK
    enum status "AssetAssignmentStatus"
    uuid employee_id FK
    uuid department_id FK
    uuid location_id FK
    datetime assigned_at
    datetime expected_return_at
    uuid condition_at_issue_id FK
    datetime returned_at
    uuid condition_at_return_id FK
  }
  asset_movements {
    uuid id PK
    uuid asset_id FK
    datetime moved_at
    uuid from_branch_id FK
    uuid to_branch_id FK
    uuid from_employee_id FK
    uuid to_employee_id FK
    uuid transfer_id FK
    uuid reason_id FK
  }
  asset_condition_history {
    uuid id PK
    uuid asset_id FK
    uuid condition_id FK
    datetime recorded_at
    uuid maintenance_work_order_id FK
  }
  asset_status_history {
    uuid id PK
    uuid asset_id FK
    enum from_status
    enum to_status
    datetime changed_at
    uuid reason_id FK
  }
  asset_acknowledgments {
    uuid id PK
    uuid assignment_id FK
    uuid asset_id FK
    uuid employee_id FK
    enum type "ISSUE | RETURN"
    datetime acknowledged_at
  }
```

## 5. Procurement

Tables: `suppliers`, `supplier_contacts`, `purchase_orders`,
`purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`,
`supplier_returns`, `supplier_return_lines`.

```mermaid
erDiagram
  suppliers ||--o{ supplier_contacts : "Cascade"
  lookup_values |o--o{ suppliers : "supplier category"
  suppliers ||--o{ purchase_orders : ""
  branches ||--o{ purchase_orders : ""
  warehouses ||--o{ purchase_orders : "destination"
  purchase_orders ||--o{ purchase_order_lines : "lines (Cascade)"
  items ||--o{ purchase_order_lines : ""
  purchase_orders ||--o{ goods_receipts : "partial receipts allowed"
  goods_receipts ||--o{ goods_receipt_lines : "lines (Cascade)"
  purchase_order_lines ||--o{ goods_receipt_lines : "received against"
  inventory_lots |o--o{ goods_receipt_lines : ""
  goods_receipt_lines |o--o{ assets : "serialized units created on post"
  suppliers ||--o{ supplier_returns : ""
  goods_receipts |o--o{ supplier_returns : "returned against"
  supplier_returns ||--o{ supplier_return_lines : "lines (Cascade)"
  items ||--o{ supplier_return_lines : ""

  suppliers {
    uuid id PK
    string code UK
    string legal_name
    uuid category_id FK
    datetime archived_at
  }
  purchase_orders {
    uuid id PK
    string po_number UK "from sequence_counters"
    uuid supplier_id FK
    uuid branch_id FK
    uuid destination_warehouse_id FK
    enum status "PurchaseOrderStatus"
    date order_date
    decimal grand_total
    uuid created_by_id FK
    uuid approved_by_id FK
  }
  purchase_order_lines {
    uuid id PK
    uuid purchase_order_id FK
    int line_number "unique per PO"
    uuid item_id FK
    decimal quantity
    decimal unit_price
    decimal received_quantity
    decimal canceled_quantity
  }
  goods_receipts {
    uuid id PK
    string receipt_number UK
    uuid purchase_order_id FK
    uuid warehouse_id FK
    enum status "GoodsReceiptStatus"
    date receipt_date
    datetime posted_at
  }
  goods_receipt_lines {
    uuid id PK
    uuid goods_receipt_id FK
    uuid purchase_order_line_id FK
    uuid item_id FK
    decimal received_quantity
    decimal base_quantity
    uuid lot_id FK
    uuid storage_location_id FK
  }
  supplier_returns {
    uuid id PK
    string return_number UK
    uuid supplier_id FK
    uuid goods_receipt_id FK
    enum status "StockDocumentStatus"
    uuid reason_id FK
  }
  supplier_return_lines {
    uuid id PK
    uuid supplier_return_id FK
    int line_number "unique per return"
    uuid item_id FK
    decimal quantity
  }
```

## 6. Transfers and physical counts

Tables: `transfers`, `transfer_lines`, `transfer_receipts`,
`transfer_receipt_lines`, `inventory_count_sessions`, `inventory_count_lines`.

```mermaid
erDiagram
  branches ||--o{ transfers : "source / destination"
  warehouses ||--o{ transfers : "source (dest optional until receipt)"
  transfers ||--o{ transfer_lines : "lines (Cascade)"
  items |o--o{ transfer_lines : "quantity line"
  assets |o--o{ transfer_lines : "serialized line"
  inventory_lots |o--o{ transfer_lines : ""
  transfers ||--o{ transfer_receipts : "partial receipts"
  transfer_receipts ||--o{ transfer_receipt_lines : "lines (Cascade)"
  transfer_lines ||--o{ transfer_receipt_lines : "received against"
  transfers |o--o{ stock_transactions : "OUT / IN postings"
  branches ||--o{ inventory_count_sessions : ""
  warehouses |o--o{ inventory_count_sessions : "scope"
  item_categories |o--o{ inventory_count_sessions : "scope"
  inventory_count_sessions ||--o{ inventory_count_lines : "lines (Cascade)"
  items |o--o{ inventory_count_lines : ""
  assets |o--o{ inventory_count_lines : "asset verification"
  inventory_count_sessions |o--o{ stock_transactions : "approved variances post adjustments"

  transfers {
    uuid id PK
    string transfer_number UK
    enum type "LOCATION | INTRA_BRANCH | INTER_BRANCH"
    enum status "TransferStatus"
    uuid source_branch_id FK
    uuid source_warehouse_id FK
    uuid destination_branch_id FK
    uuid destination_warehouse_id FK
    date transfer_date
    datetime dispatched_at
    datetime completed_at
  }
  transfer_lines {
    uuid id PK
    uuid transfer_id FK
    int line_number "unique per transfer"
    uuid item_id FK "XOR asset_id"
    uuid asset_id FK
    decimal quantity
    decimal dispatched_quantity
    decimal received_quantity
    decimal damaged_quantity
    decimal short_quantity
  }
  transfer_receipts {
    uuid id PK
    uuid transfer_id FK
    string receipt_number UK
    uuid received_by_id FK
    datetime received_at
  }
  transfer_receipt_lines {
    uuid id PK
    uuid transfer_receipt_id FK
    uuid transfer_line_id FK
    decimal received_quantity
    decimal damaged_quantity
    uuid condition_id FK
  }
  inventory_count_sessions {
    uuid id PK
    string count_number UK
    enum type "FULL | CYCLE"
    enum status "InventoryCountStatus"
    uuid branch_id FK
    boolean is_blind
    datetime snapshot_at
    uuid approved_by_id FK
  }
  inventory_count_lines {
    uuid id PK
    uuid count_session_id FK
    uuid item_id FK
    uuid asset_id FK
    uuid lot_id FK
    decimal expected_quantity
    decimal counted_quantity
    decimal variance_quantity
    enum flag "CountLineFlag"
  }
```

## 7. Maintenance

Tables: `maintenance_plans`, `maintenance_plan_tasks`,
`maintenance_work_orders`, `maintenance_work_order_tasks`, `maintenance_parts`,
`asset_meter_readings`.

```mermaid
erDiagram
  assets |o--o{ maintenance_plans : "per-asset plan"
  items |o--o{ maintenance_plans : "per-item template"
  lookup_values ||--o{ maintenance_plans : "maintenance type"
  suppliers |o--o{ maintenance_plans : "external vendor"
  maintenance_plans ||--o{ maintenance_plan_tasks : "checklist (Cascade)"
  maintenance_plans |o--o{ maintenance_work_orders : "generates"
  assets ||--o{ maintenance_work_orders : "worked on"
  branches ||--o{ maintenance_work_orders : ""
  employees |o--o{ maintenance_work_orders : "assigned technician"
  suppliers |o--o{ maintenance_work_orders : "assigned vendor"
  maintenance_work_orders ||--o{ maintenance_work_order_tasks : "checklist (Cascade)"
  maintenance_plan_tasks |o--o{ maintenance_work_order_tasks : "instantiates"
  maintenance_work_orders ||--o{ maintenance_parts : "parts consumed"
  items ||--o{ maintenance_parts : ""
  stock_transactions |o--o{ maintenance_parts : "MAINTENANCE_ISSUE posting"
  assets ||--o{ asset_meter_readings : ""

  maintenance_plans {
    uuid id PK
    string code UK
    uuid asset_id FK "and/or item_id"
    uuid item_id FK
    uuid maintenance_type_id FK
    int interval_days
    decimal meter_interval
    string schedule_cron
    datetime next_due_at
    datetime archived_at
  }
  maintenance_plan_tasks {
    uuid id PK
    uuid plan_id FK
    int sequence "unique per plan"
    string name
  }
  maintenance_work_orders {
    uuid id PK
    string work_order_number UK "WO-{BRANCH}-{YEAR}-{SEQ}"
    uuid asset_id FK
    uuid plan_id FK
    uuid branch_id FK
    uuid maintenance_type_id FK
    uuid priority_id FK
    enum status "MaintenanceWorkOrderStatus"
    datetime scheduled_start_at
    datetime actual_end_at
    decimal total_cost
    decimal downtime_hours
    uuid verified_by_id FK
  }
  maintenance_work_order_tasks {
    uuid id PK
    uuid work_order_id FK
    int sequence "unique per WO"
    boolean is_completed
  }
  maintenance_parts {
    uuid id PK
    uuid work_order_id FK
    uuid item_id FK
    uuid lot_id FK
    decimal quantity
    uuid stock_transaction_id FK
  }
  asset_meter_readings {
    uuid id PK
    uuid asset_id FK
    string meter_type
    decimal reading_value
    datetime reading_at
  }
```

## 8. Workflow and system

Tables: `approval_workflows`, `approval_steps`, `approval_requests`,
`approval_actions`, `approval_delegations`, `notifications`, `attachments`,
`audit_logs`, `lookup_values`, `sequence_counters`.

```mermaid
erDiagram
  approval_workflows ||--o{ approval_steps : "ordered steps (Cascade)"
  branches |o--o{ approval_workflows : "optional scope"
  roles |o--o{ approval_steps : "approver role"
  users |o--o{ approval_steps : "approver user"
  approval_workflows ||--o{ approval_requests : ""
  approval_steps |o--o{ approval_requests : "current step"
  approval_requests ||--o{ approval_actions : "history (Cascade)"
  users ||--o{ approval_actions : "actor"
  users ||--o{ approval_delegations : "delegator / delegate"
  users ||--o{ notifications : "recipient (Cascade)"
  users ||--o{ attachments : "uploaded by"
  lookup_values |o--o{ attachments : "document type"
  users |o--o{ audit_logs : "actor"
  branches |o--o{ audit_logs : ""
  branches |o--o{ lookup_values : "optional scope"

  approval_workflows {
    uuid id PK
    string code UK
    string resource_type "purchase_order, transfer, ..."
    uuid branch_id FK
    decimal min_amount
    decimal max_amount
  }
  approval_steps {
    uuid id PK
    uuid workflow_id FK
    int sequence "unique per workflow"
    uuid approver_role_id FK "or approver_user_id"
    uuid approver_user_id FK
  }
  approval_requests {
    uuid id PK
    uuid workflow_id FK
    string resource_type "polymorphic"
    uuid resource_id "polymorphic"
    enum status "ApprovalStatus"
    uuid current_step_id FK
    decimal amount
  }
  approval_actions {
    uuid id PK
    uuid request_id FK
    uuid step_id FK
    uuid actor_id FK
    enum action "ApprovalActionType"
    uuid delegated_for_id FK
  }
  approval_delegations {
    uuid id PK
    uuid delegator_id FK
    uuid delegate_id FK
    datetime starts_at
    datetime ends_at
  }
  notifications {
    uuid id PK
    uuid recipient_user_id FK
    string type "LOW_STOCK, MAINTENANCE_DUE, ..."
    string resource_type
    uuid resource_id
    string dedupe_key "unique per recipient"
    datetime read_at
  }
  attachments {
    uuid id PK
    string resource_type "polymorphic"
    uuid resource_id
    string storage_key UK "MinIO gemerp-attachments"
    string mime_type
    uuid document_type_id FK
    uuid uploaded_by_id FK
    datetime archived_at
  }
  audit_logs {
    uuid id PK
    uuid actor_user_id FK
    string action
    string resource_type
    string resource_id "plain string, non-UUID allowed"
    datetime occurred_at
    json old_values
    json new_values
  }
  lookup_values {
    uuid id PK
    string category "ASSET_CONDITION, TRANSACTION_REASON, ..."
    string code "unique per category"
    boolean is_system
    uuid branch_id FK "optional scope"
  }
  sequence_counters {
    uuid id PK
    string key UK "e.g. AST-SUB-LAP-2026"
    bigint last_value
  }
```

---

## Table-by-table reference

FK delete behavior is `Restrict` unless stated; "Cascade child" means the row is
deleted with its parent. Archival legend:

- **soft-archive** — `is_active` and/or `archived_at`; never hard-deleted while referenced.
- **append-only** — never updated or deleted after creation.
- **status-terminal** — document kept forever; ends in a terminal status.
- **child** — lives and dies with its parent document/master row.

### Identity and access

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `organizations` | Single-company root ("GemCor"); org timezone (Asia/Manila) and currency (PHP). | `code` unique. | soft-archive (`is_active`). |
| `users` | Login accounts. Password argon2id; lockout counters for 5-failure/15-min throttling. | `email` unique; index `is_active`. | soft-archive (`is_active`, `archived_at`). |
| `user_sessions` | Server-side cookie sessions; stores only SHA-256 hash of the opaque 256-bit token; 12h sliding expiry. | `token_hash` unique; indexes `user_id`, `expires_at`. Cascade on user delete. | rows expire (`expires_at`) or are revoked (`revoked_at`); purgeable. |
| `roles` | Role catalog (7 seeded roles; `is_system` protects them). | `code` unique. | soft-archive (`is_active`). |
| `permissions` | Permission catalog, dot-notation codes (`asset.view`, `procurement.po.create`). | `code` unique; index `resource`. | permanent catalog; seed-synced. |
| `role_permissions` | Role↔permission join. | unique `(role_id, permission_id)`; Cascade child of both. | child. |
| `user_roles` | User↔role join. | unique `(user_id, role_id)`; Cascade child of both. | child. |
| `user_branch_access` | Branch scope per user. | unique `(user_id, branch_id)`; Cascade on user, Restrict on branch. | child of user. |
| `user_permission_overrides` | Audited per-user ALLOW/DENY on top of roles; optional expiry. | unique `(user_id, permission_id)`; `effect` enum; Cascade on user/permission, Restrict on `created_by`. | child of user; time-boxed via `expires_at`. |

### Organization structure and employees

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `branches` | Physical branches (SUB/MKT). | `code` globally unique; indexes `organization_id`, `is_active`. | soft-archive. |
| `warehouses` | Warehouses within a branch; optional default receiving/issue locations (`SetNull`). | unique `(branch_id, code)`; indexes `branch_id`, `is_active`. | soft-archive. |
| `storage_locations` | Nested zone/aisle/rack/shelf/bin tree (self-FK `parent_id`); bins may carry their own barcode. | unique `(warehouse_id, code)`; `barcode` unique (nullable); indexes `warehouse_id`, `parent_id`. | soft-archive. |
| `departments` | Departments, optionally branch-scoped (`branch_id` nullable). | `code` globally unique; index `branch_id`. | soft-archive. |
| `positions` | Job positions. | `code` unique. | soft-archive. |
| `employees` | Custody-only employee records (no HRIS/payroll); optional 1:1 link to a login user; self-FK supervisor. | `employee_number` unique; `work_email` unique (nullable); `user_id` unique (nullable, `SetNull`); indexes `branch_id`, `department_id`, `status`, `(last_name, first_name)`. | soft-archive + `status` (`EmployeeStatus`); `separation_date`. |

### Catalog

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `item_categories` | Top-level item categories (drive SKU/asset-tag prefixes). | `code` unique. | soft-archive. |
| `item_subcategories` | Second level under a category. | unique `(category_id, code)`. | soft-archive. |
| `brands` / `manufacturers` | Brand and manufacturer masters. | `code` unique each. | soft-archive. |
| `units_of_measure` | UOM catalog (PIECE, BOX, LITER, ...). | `code` unique. | soft-archive (`is_active` only). |
| `uom_conversions` | Item-specific conversion: 1 `from_uom` = `factor` × `to_uom`. | unique `(item_id, from_uom_id, to_uom_id)`; Cascade child of item. | child. |
| `items` | Item master. `business_category` + `tracking_method` enums decide serialized vs quantity vs lot handling; flags for lot/expiry/serial/maintainable; base/purchase/issue UOMs; default supplier; standard & last purchase cost. | `sku` unique; indexes `business_category`, `tracking_method`, `category_id`, `default_supplier_id`, `is_active`, `name`. | soft-archive. |
| `item_barcodes` | Alternate barcodes (supplier/UPC/EAN/packaging), optionally UOM-specific. **Unique-while-active pattern:** `is_active` is `true` for live rows and `NULL` (never `false`) once deactivated, so unique `(barcode, is_active)` allows one active mapping system-wide plus unlimited deactivated duplicates. | unique `(barcode, is_active)`; indexes `item_id`, `barcode`; Cascade child of item. | deactivate (`is_active` → NULL, `deactivated_at`); history kept. |
| `item_warehouse_settings` | Per-warehouse reorder policy (reorder level/qty, min/max, default bin) used by low-stock alerts. | unique `(item_id, warehouse_id)`; Cascade on item, `SetNull` default location. | child of item. |
| `inventory_lots` | Lot/batch records for lot-controlled items; expiry tracked here. | unique `(item_id, lot_number)`; `barcode` unique (nullable); index `expiry_date`. | soft-archive (`is_active`); referenced by ledger forever. |

### Inventory ledger

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `stock_transactions` | Controlled stock document (15 types, see `StockTransactionType`). Workflow status `StockDocumentStatus`; only `POSTED` documents affect stock. Carries context FKs to employee/department/supplier/PO/GR/transfer/work-order/count-session and a `reversal_of` self-FK. Actor + timestamp pairs for create/submit/approve/post/cancel/reverse. | `transaction_number` unique; indexes `type`, `status`, `transaction_date`, `branch_id`, `posted_at`, and each context FK. | status-terminal; posted documents are immutable, corrected only by `REVERSAL` documents. |
| `stock_transaction_lines` | Document lines; entered qty/UOM plus converted `base_quantity`; optional lot, asset (serialized), source/destination bins, unit cost. | unique `(transaction_id, line_number)`; indexes `item_id`, `lot_id`, `asset_id`; Cascade child of transaction. | child (immutable once parent is posted). |
| `stock_ledger_entries` | **Append-only ledger.** One signed base-quantity delta per item/warehouse/location/lot (and asset) touched by a posted transaction. No `updated_at` column by design. | indexes `(item_id, warehouse_id)`, `(item_id, branch_id)`, `(warehouse_id, storage_location_id)`, `transaction_id`, `lot_id`, `asset_id`, `posted_at`; all FKs Restrict. | append-only, never updated or deleted. |
| `stock_balances` | Transactionally-maintained projection of the ledger: `on_hand_qty`, `reserved_qty`, `in_transit_qty` per item/warehouse/location/lot. Never edited directly. | unique `(item_id, warehouse_id, storage_location_id, lot_id)` — defense in depth only, since Postgres treats NULLs as distinct (see section 9); indexes `warehouse_id`, `branch_id`, `item_id`. | derived; rebuildable from the ledger. |
| `stock_reservations` | Soft holds on quantity stock (e.g. for approved transfers) feeding `reserved_qty`. | indexes `(item_id, warehouse_id)`, `status`, `transfer_id`; `status` enum with `expires_at`/`released_at`. | status-terminal (`RELEASED`/`FULFILLED`/`CANCELED`). |

### Serialized assets

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `assets` | Physical serialized unit: tag, opaque QR `scan_token` (scanning still requires authn/authz), lifecycle `status`, current branch/warehouse/bin/custodian/department, acquisition + warranty + disposal data, maintenance scheduling fields. Condition/criticality/disposal-method are `lookup_values` FKs. | `asset_tag` unique; `scan_token` unique; unique `(item_id, serial_number)`; indexes `status`, `branch_id`, `warehouse_id`, `custodian_employee_id`, `item_id`, `next_maintenance_at`, `warranty_end_date`. | soft-archive after `RETIRED`/`DISPOSED`; never hard-deleted (history points at it). |
| `asset_assignments` | Custody record per issue: employee, department, location, or project; condition at issue/return; acknowledgment and return tracking. | indexes `asset_id`, `employee_id`, `status`, `expected_return_at`. | status-terminal (`RETURNED`/`LOST`/`CANCELED`); permanent custody history. |
| `asset_movements` | Append-only location/custody movement history (from/to branch, warehouse, location, employee), optionally linked to a transfer or assignment. | indexes `asset_id`, `moved_at`, `transfer_id`. | append-only. |
| `asset_condition_history` | Condition timeline; can originate from a work order (`source` free-text notes origin). | indexes `asset_id`, `recorded_at`. | append-only. |
| `asset_status_history` | Lifecycle transitions `from_status` → `to_status` with reason lookup. | indexes `asset_id`, `changed_at`. | append-only. |
| `asset_acknowledgments` | Employee acknowledgment of issue/return (`type` = `ISSUE`/`RETURN`, capture `method`). | indexes `assignment_id`, `asset_id`, `employee_id`. | append-only. |
| `asset_meter_readings` | Usage meters (hours, km, pages) driving meter-based maintenance. | index `(asset_id, reading_at)`. | append-only. |

### Procurement

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `suppliers` | Supplier master; category is a `lookup_values` FK; PH-default country. | `code` unique; index `is_active`. | soft-archive. |
| `supplier_contacts` | Contact persons per supplier. | index `supplier_id`; Cascade child of supplier. | child; `is_active` flag. |
| `purchase_orders` | PO header with money totals (subtotal/discount/tax/grand, `Decimal(14,2)`), status workflow, actor/timestamp pairs. | `po_number` unique; indexes `supplier_id`, `branch_id`, `status`, `order_date`. | status-terminal (`CANCELED`/`CLOSED`). |
| `purchase_order_lines` | PO lines with pricing and receiving progress (`received_quantity`, `canceled_quantity`). | unique `(purchase_order_id, line_number)`; index `item_id`; Cascade child of PO. | child. |
| `goods_receipts` | Receipt against an approved PO; supports partial/multiple receipts; stock + serialized assets are created only when `POSTED`. | `receipt_number` unique; indexes `purchase_order_id`, `branch_id`, `status`, `receipt_date`. | status-terminal (`CANCELED`/`REVERSED`). |
| `goods_receipt_lines` | Received quantities per PO line, with lot, bin, and unit cost; back-referenced by `assets.goods_receipt_line_id` for serialized units created on posting. | unique `(goods_receipt_id, line_number)`; indexes `purchase_order_line_id`, `item_id`; Cascade child of receipt (PO-line FK Restrict). | child. |
| `supplier_returns` | Return-to-supplier document (uses `StockDocumentStatus`), optionally tied to the originating goods receipt; reason lookup. | `return_number` unique; indexes `supplier_id`, `branch_id`, `status`. | status-terminal. |
| `supplier_return_lines` | Returned quantities per item/lot. | unique `(supplier_return_id, line_number)`; index `item_id`; Cascade child. | child. |

### Transfers and counts

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `transfers` | Transfer document — bin-to-bin (`LOCATION`), warehouse-to-warehouse (`INTRA_BRANCH`), or `INTER_BRANCH` with the controlled flow draft → approval → dispatch (`IN_TRANSIT`) → receipt(s) → `RECEIVED`. Destination warehouse/location optional until receipt. | `transfer_number` unique; indexes `status`, `source_branch_id`, `destination_branch_id`, `transfer_date`. | status-terminal. |
| `transfer_lines` | A line is either quantity stock (`item_id` + `quantity`) **or** one serialized asset (`asset_id`) — XOR enforced in the app layer, not the DB. Tracks dispatched/received/damaged/short/rejected quantities. | unique `(transfer_id, line_number)`; indexes `item_id`, `asset_id`; Cascade child of transfer. | child. |
| `transfer_receipts` | Destination-side receipt event (supports partial receipt and inspection). | `receipt_number` unique; index `transfer_id`. | append-only event. |
| `transfer_receipt_lines` | Per-line received/damaged/short/rejected quantities with condition lookup. | index `transfer_line_id`; Cascade child of receipt (transfer-line FK Restrict). | child. |
| `inventory_count_sessions` | Physical (`FULL`) or `CYCLE` count, scoped by branch and optionally warehouse/location/category; blind-count option; snapshot timestamp. Counts never overwrite stock — approved variances generate adjustment `stock_transactions` (back-linked via `count_session_id`). | `count_number` unique; indexes `branch_id`, `warehouse_id`, `status`. | status-terminal. |
| `inventory_count_lines` | Expected vs counted vs recount vs variance per item/lot/bin, or per asset for verification (`flag` = `CountLineFlag`). | indexes `count_session_id`, `item_id`, `asset_id`; Cascade child of session. | child. |

### Maintenance

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `maintenance_plans` | Preventive-maintenance template for a specific asset and/or every maintainable asset of an item; frequency by `interval_days`, `meter_interval` (+ `meter_type`), or `schedule_cron`; vendor, cost/duration estimates, reminder lead, computed `next_due_at`. | `code` unique; indexes `asset_id`, `item_id`, `is_active`, `next_due_at`. | soft-archive. |
| `maintenance_plan_tasks` | Ordered checklist template. | unique `(plan_id, sequence)`; Cascade child of plan. | child. |
| `maintenance_work_orders` | Corrective/preventive work order: reporting, assignment (employee, vendor, or team), scheduling, diagnosis/action/resolution, labor/parts/external/total cost, downtime, completion condition (lookup), verification. | `work_order_number` unique; indexes `asset_id`, `branch_id`, `status`, `scheduled_start_at`, `assigned_to_employee_id`. | status-terminal (`COMPLETED`/`VERIFIED`/`CANCELED`). |
| `maintenance_work_order_tasks` | Checklist instances (optionally copied from plan tasks). | unique `(work_order_id, sequence)`; Cascade child of WO. | child. |
| `maintenance_parts` | Spare parts consumed by a work order, backed by a posted `MAINTENANCE_ISSUE` stock transaction — parts always move through the inventory ledger. | indexes `work_order_id`, `item_id`; WO FK is Restrict (not Cascade). | kept with the work order. |

### Workflow and system

| Table | Purpose | Constraints / uniques / indexes | Archival |
|---|---|---|---|
| `approval_workflows` | Configurable approval rule per `resource_type` (purchase_order, transfer, stock_transaction, asset_disposal, ...), optionally branch-scoped and amount-banded (`min_amount`–`max_amount`). | `code` unique; indexes `resource_type`, `branch_id`. | soft-archive (`is_active`). |
| `approval_steps` | Ordered steps; approver is a role **or** a named user. | unique `(workflow_id, sequence)`; Cascade child of workflow. | child. |
| `approval_requests` | Running approval for one document — polymorphic `resource_type`/`resource_id`; tracks current step and amount. | indexes `(resource_type, resource_id)`, `status`, `requested_by_id`. | status-terminal (`ApprovalStatus`). |
| `approval_actions` | Full decision history (`APPROVE`/`REJECT`/`RETURN`/`CANCEL`/`COMMENT`); `delegated_for` records the original approver when acting under delegation. | indexes `request_id`, `actor_id`; Cascade child of request. | append-only history. |
| `approval_delegations` | Time-boxed delegation of approval authority between users. | indexes `delegator_id`, `delegate_id`; Cascade on both users. | `is_active` + date window. |
| `notifications` | In-app notifications; `type` is a machine code (LOW_STOCK, PENDING_APPROVAL, MAINTENANCE_DUE, ...); `dedupe_key` prevents duplicate alerts per recipient. | unique `(recipient_user_id, dedupe_key)`; indexes `(recipient_user_id, read_at)`, `type`, `created_at`; Cascade on recipient. | read-tracking; purgeable per retention policy. |
| `attachments` | File metadata; bytes live in MinIO/S3 bucket `gemerp-attachments`. Polymorphic owner; branch scoping enforced in the app layer. | `storage_key` unique; indexes `(resource_type, resource_id)`, `branch_id`. | soft-archive (`archived_at`). |
| `audit_logs` | **Append-only** audit trail. No `updated_at` by design. `resource_id` is a plain string so non-UUID identifiers (e.g. permission codes) can be referenced. Old/new values as JSON; secrets redacted by the writer. | indexes `actor_user_id`, `action`, `(resource_type, resource_id)`, `branch_id`, `occurred_at`. | append-only; retention policy TBD. |
| `lookup_values` | Business-managed configurable vocabularies keyed by `category` (ASSET_CONDITION, TRANSACTION_REASON, ADJUSTMENT_REASON, DISPOSAL_METHOD, MAINTENANCE_TYPE, MAINTENANCE_PRIORITY, SUPPLIER_CATEGORY, DOCUMENT_TYPE, ASSET_CRITICALITY, NOTIFICATION_TYPE, ...); optionally branch-scoped; `is_system` protects seeded values. All referencing FKs are Restrict — deactivate, never delete. | unique `(category, code)`; indexes `(category, is_active)`, `branch_id`. | soft-archive (`is_active`). |
| `sequence_counters` | Named counters for business document numbers (asset tags, PO numbers, transaction numbers). Keys embed scope+period, e.g. `AST-SUB-LAP-2026`, `PO-2026`, `TRF-2026`. | `key` unique; `last_value` BigInt. | permanent. |

---

## 9. Ledger integrity

The inventory subsystem is event-sourced at its core. Three tables carry the
contract; every service that touches stock must honor it.

### `stock_ledger_entries` — immutable event log

- The ledger is **append-only**: rows are never updated or deleted. The model
  deliberately has no `updated_at` column.
- Only a `stock_transactions` row reaching `POSTED` writes ledger rows, and the
  ledger rows are created **in the same database transaction** as the status
  flip to `POSTED`. A document is either fully posted (all deltas written) or
  not posted at all.
- Each row is one signed `quantity_delta` in the item's **base UOM** for one
  `(item, branch, warehouse, storage_location?, lot?, asset?)` slot; line-level
  provenance via `transaction_line_id`.
- Mistakes are corrected with `REVERSAL` transactions (type `REVERSAL`, header
  `reversal_of_id` pointing at the original), which append compensating
  entries. Posted history is never edited.
- All ledger FKs are `onDelete: Restrict`, so no referenced master row (item,
  lot, asset, branch, warehouse, location) can ever be hard-deleted out from
  under history — masters are archived instead.
- Prisma cannot express "no UPDATE/DELETE" at the DB level; the migration layer
  should add a belt-and-braces guard (revoke UPDATE/DELETE from the app role
  or a raising trigger). Until then it is an application-layer invariant.

### `stock_balances` — derived projection

- `stock_balances` is a **projection** of the ledger: `on_hand_qty` per
  `(item, warehouse, storage_location?, lot?)` slot must always equal the sum
  of `quantity_delta` for that slot. `reserved_qty` mirrors active
  `stock_reservations`; `in_transit_qty` mirrors dispatched-not-yet-received
  transfer quantity.
- The posting service upserts the balance row **inside the same serialized
  transaction** as the ledger write, using `SELECT ... FOR UPDATE` on the
  balance row to prevent lost updates under concurrency. Negative-stock and
  reservation checks happen under that same lock.
- The unique constraint `(item_id, warehouse_id, storage_location_id, lot_id)`
  is defense in depth only: Postgres treats NULLs as distinct in unique
  constraints, so slots with NULL location/lot are not fully protected by the
  constraint — correctness rests on the serialized upsert.
- Because it is derived, `stock_balances` is rebuildable at any time by
  re-aggregating `stock_ledger_entries`; a reconciliation job should compare
  the two and alarm on drift.

### `sequence_counters` — human-readable document numbering

- Every business number (asset tag `AST-{BRANCH}-{CAT}-{YEAR}-{SEQ}`, PO
  number, transaction number, transfer number, count number, WO number, lot
  barcodes, ...) is generated from a named counter row — **never** from the
  UUID primary key.
- Counter keys embed the scope and period (e.g. `AST-SUB-LAP-2026`,
  `PO-2026`, `TRF-2026`), so sequences reset per year/prefix by key
  convention, not by resetting rows.
- Increment protocol: `SELECT ... FOR UPDATE` (or an atomic
  `UPDATE ... SET last_value = last_value + 1 ... RETURNING`) **inside the
  same transaction that creates the document**, guaranteeing no duplicate
  numbers under concurrency. A rolled-back transaction may leave a gap in the
  sequence; gaps are acceptable, duplicates are not.
- `last_value` is `BigInt`; the formatted number is derived (zero-padded) by
  the numbering service.

Related integrity notes:

- `audit_logs` follows the same append-only discipline as the ledger (no
  `updated_at`, never updated or deleted).
- Asset history tables (`asset_movements`, `asset_status_history`,
  `asset_condition_history`, `asset_acknowledgments`, `asset_meter_readings`)
  are append-only by convention.
- Serialized assets also flow through the ledger: serialized stock transaction
  lines carry `asset_id`, and their ledger entries move quantity 1 of the
  asset's item, keeping quantity truth and asset truth reconciled.

---

## 10. Enum inventory

All Prisma enums and their values, verbatim from the schema. Everything not
listed here (conditions, reasons, priorities, types, categories of suppliers,
document types, ...) is a `lookup_values` category, not an enum.

| Enum | Values | Used by |
|---|---|---|
| `BusinessCategory` | `SERIALIZED_ASSET`, `CONSUMABLE`, `BULK_NON_CONSUMABLE` | `items.business_category` |
| `TrackingMethod` | `SERIAL`, `QUANTITY`, `LOT` | `items.tracking_method` |
| `AssetLifecycleStatus` | `DRAFT`, `AVAILABLE`, `RESERVED`, `ASSIGNED`, `IN_TRANSFER`, `UNDER_INSPECTION`, `UNDER_MAINTENANCE`, `DAMAGED`, `LOST`, `RETIRED`, `DISPOSED` | `assets.status`, `asset_status_history.from_status` / `to_status` |
| `StockTransactionType` | `OPENING_BALANCE`, `PURCHASE_RECEIPT`, `NON_PURCHASE_RECEIPT`, `ISSUE_TO_EMPLOYEE`, `ISSUE_TO_DEPARTMENT`, `RETURN_FROM_EMPLOYEE`, `RETURN_TO_SUPPLIER`, `LOCATION_TRANSFER`, `INTER_BRANCH_TRANSFER_OUT`, `INTER_BRANCH_TRANSFER_IN`, `ADJUSTMENT_INCREASE`, `ADJUSTMENT_DECREASE`, `MAINTENANCE_ISSUE`, `DISPOSAL`, `REVERSAL` | `stock_transactions.type` |
| `StockDocumentStatus` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `POSTED`, `CANCELED`, `REVERSED` | `stock_transactions.status`, `supplier_returns.status` |
| `PurchaseOrderStatus` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `PARTIALLY_RECEIVED`, `FULLY_RECEIVED`, `CANCELED`, `CLOSED` | `purchase_orders.status` |
| `GoodsReceiptStatus` | `DRAFT`, `POSTED`, `CANCELED`, `REVERSED` | `goods_receipts.status` |
| `TransferType` | `LOCATION`, `INTRA_BRANCH`, `INTER_BRANCH` | `transfers.type` |
| `TransferStatus` | `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `IN_TRANSIT`, `PARTIALLY_RECEIVED`, `RECEIVED`, `CANCELED` | `transfers.status` |
| `InventoryCountType` | `FULL`, `CYCLE` | `inventory_count_sessions.type` |
| `InventoryCountStatus` | `DRAFT`, `IN_PROGRESS`, `REVIEW`, `COMPLETED`, `CANCELED` | `inventory_count_sessions.status` |
| `CountLineFlag` | `MATCHED`, `VARIANCE`, `MISSING`, `UNEXPECTED`, `DUPLICATE`, `MISPLACED` | `inventory_count_lines.flag` |
| `MaintenanceWorkOrderStatus` | `DRAFT`, `OPEN`, `ASSIGNED`, `SCHEDULED`, `IN_PROGRESS`, `ON_HOLD`, `AWAITING_PARTS`, `AWAITING_VENDOR`, `COMPLETED`, `VERIFIED`, `CANCELED` | `maintenance_work_orders.status` |
| `ApprovalStatus` | `PENDING`, `APPROVED`, `REJECTED`, `RETURNED`, `CANCELED` | `approval_requests.status` |
| `ApprovalActionType` | `APPROVE`, `REJECT`, `RETURN`, `CANCEL`, `COMMENT` | `approval_actions.action` |
| `EmployeeStatus` | `ACTIVE`, `INACTIVE`, `SUSPENDED`, `SEPARATED` | `employees.status` |
| `AssetAssignmentStatus` | `PENDING_ACKNOWLEDGMENT`, `ACTIVE`, `RETURNED`, `LOST`, `CANCELED` | `asset_assignments.status` |
| `AcknowledgmentType` | `ISSUE`, `RETURN` | `asset_acknowledgments.type` |
| `PermissionOverrideEffect` | `ALLOW`, `DENY` | `user_permission_overrides.effect` |
| `StockReservationStatus` | `ACTIVE`, `RELEASED`, `FULFILLED`, `CANCELED` | `stock_reservations.status` |

---

## 11. Gaps to address

### Spec section 26 coverage

**Every table named in spec section 26 exists in the schema** — all 63 listed
tables are present under their exact snake_case names. Nothing is missing.

### Additions beyond the spec section 26 list

The schema adds three tables the spec's list did not name explicitly (all are
natural completions of spec-described behavior, not new features):

| Table | Why it exists |
|---|---|
| `supplier_return_lines` | Line detail for `supplier_returns` (the spec listed only the header). |
| `transfer_receipt_lines` | Per-line received/damaged/short/rejected detail under `transfer_receipts`, required for partial-receipt and inspection outcomes (spec section 16). |
| `approval_delegations` | Time-boxed approval delegation, required by spec section 19 ("Delegation with start and end dates"); `approval_actions.delegated_for_id` records acting-on-behalf-of. |

Note: `asset_meter_readings` is listed in spec section 26 under Maintenance and
exists in the schema (its model sits in the serialized-assets block of
`schema.prisma`; this document draws it in the maintenance diagram to match the
spec grouping).

### Invariants the database cannot enforce (application-layer duties)

These are correct-by-construction in the services, but reviewers should know
the DB alone does not guarantee them:

1. **Ledger/audit immutability** — Prisma cannot forbid UPDATE/DELETE on
   `stock_ledger_entries` / `audit_logs`; add a migration-level trigger or
   role-privilege revoke as hardening.
2. **`stock_balances` slot uniqueness with NULLs** — Postgres NULL-distinct
   semantics weaken the unique constraint; the serialized `SELECT ... FOR
   UPDATE` upsert in the posting service is the real guarantee.
3. **XOR line shapes** — `transfer_lines` (item+quantity vs. asset) and
   `maintenance_plans` (asset and/or item), `approval_steps` (role vs. user)
   have optional-FK pairs whose validity rules live in validation code, not
   CHECK constraints.
4. **Status machines** — enum columns list the states; legal transitions
   (documented in `docs/status-transitions.md`) are service-enforced.
5. **Branch scoping of polymorphic rows** — `attachments` and
   `approval_requests` reference documents polymorphically
   (`resource_type`/`resource_id`, no FK); referential integrity and branch
   scoping for them are app-enforced.
