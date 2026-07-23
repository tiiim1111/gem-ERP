# Asset Management, Inventory, Procurement, and Maintenance System

## Master Implementation Prompt for Codex

You are a senior software architect and full-stack TypeScript engineer. Design and build a production-ready, responsive web application for managing serialized assets, consumable inventory, bulk non-consumable items, procurement, employee custodianship, maintenance, approvals, reporting, and audit history across multiple branches and warehouses.

Treat this document as the authoritative product and engineering specification. Do not silently remove requirements. When a minor detail is unspecified, choose a sensible production-grade default, document the assumption, and continue. Ask the user only when a decision would materially change the business workflow, security model, or data integrity.

Do not attempt to generate the entire application in one unreviewable pass. First inspect the repository, then propose the implementation plan and data model. Implement the system in the phases listed below, completing migrations, validations, tests, and documentation for each vertical slice before proceeding.

---

## 1. Product Goal

Create a single-company, multi-branch asset and inventory platform that provides:

- Secure user authentication and user administration.
- Role-based and permission-based access control.
- Branch- and warehouse-scoped data access.
- Basic employee records used only for asset and consumable assignment.
- Serialized asset tracking with a unique barcode and QR code for every physical asset.
- Quantity-, package-, and lot-based tracking for consumables.
- Quantity or serialized tracking for bulk non-consumable items.
- Complete stock transaction history without directly editing balances.
- Supplier, purchase order, receiving, and purchase history workflows.
- Asset issuance, assignment, acknowledgment, return, transfer, loss, damage, retirement, and disposal.
- Low-stock detection and alerts.
- Preventive and corrective maintenance management.
- Configurable approvals for controlled transactions.
- Dashboards, analytics, operational reports, and exports.
- Immutable audit trails and inventory ledgers.
- Responsive operation on desktop, tablet, and mobile browsers.
- Barcode/QR generation, label printing, hardware-scanner input, and camera-based scanning.

Payroll, attendance, leave, recruitment, performance management, and other full HRIS functions are explicitly out of scope.

Full accounting, accounts payable, general ledger, and supplier payment processing are also out of scope. Procurement records may store quantities, prices, taxes, discounts, and totals, but the application is not an accounting system.

---

## 2. Required Technology Stack

Use a TypeScript monorepo with the following baseline:

### Frontend

- Next.js using the App Router.
- TypeScript with strict mode enabled.
- React.
- Tailwind CSS.
- shadcn/ui or an equivalent accessible component system.
- TanStack Query for server-state fetching, caching, invalidation, and mutations.
- TanStack Table or an equivalent library for large filterable data tables.
- React Hook Form with schema-based validation.
- Recharts or an equivalent accessible charting library.
- Browser camera scanning plus support for USB/Bluetooth barcode scanners that behave as keyboard input.

### Backend

- NestJS with TypeScript.
- REST API under `/api/v1`.
- OpenAPI/Swagger documentation.
- Modular domain organization.
- DTO validation and consistent API error responses.
- PostgreSQL.
- Prisma ORM and version-controlled migrations.
- Redis and BullMQ for scheduled work and background jobs, including alerts, report generation, and maintenance reminders.
- S3-compatible object storage for receipts, warranties, photos, manuals, and maintenance attachments. Support MinIO for self-hosted development and deployment.

### Repository and Tooling

- pnpm workspaces.
- Turborepo or an equivalent monorepo task runner.
- Suggested structure:

```text
apps/
  web/
  api/
  worker/
packages/
  database/
  ui/
  shared/
  api-client/
  config/
```

- Generate or maintain a typed frontend API client from the backend OpenAPI contract.
- ESLint, Prettier, strict TypeScript, and pre-commit checks.
- Unit, integration, and end-to-end tests.
- Playwright for critical browser workflows.
- Dockerfiles and Docker Compose for local and production-like deployment.
- Environment validation at startup.
- Structured application logs, health endpoints, and request correlation IDs.

Keep the initial implementation as a modular monolith. Do not introduce microservices unless an actual scaling requirement justifies them. The worker may run as a separate process while sharing backend domain packages.

---

## 3. Core Architecture Principles

1. **Ledger-driven stock**
   - Never treat an editable `quantity` field as the authoritative inventory history.
   - Every stock change must create an immutable stock-ledger transaction.
   - Current stock balances may be stored as a transactionally updated projection or computed view for performance.
   - Posted transactions cannot be deleted or silently edited. Correct mistakes through reversal and replacement transactions.

2. **Serialized asset instances**
   - A serialized catalog item may have many physical asset instances.
   - Every physical asset instance has a unique internal asset tag, barcode, QR code, lifecycle status, location, condition, and custody history.

3. **Branch isolation**
   - Users receive explicit access to one or more branches.
   - Permissions and branch scope must both pass before data is returned or mutated.
   - Never rely on frontend filtering for authorization.

4. **Auditability**
   - Business events must identify who performed the action, when it occurred, what changed, which branch was affected, and why when a reason is required.
   - Critical records use soft deletion or archival.
   - Transactional records use cancellation, reversal, or void workflows rather than destructive deletion.

5. **Transactional consistency**
   - Posting receipts, stock issues, transfers, returns, adjustments, asset assignments, and reversals must use database transactions.
   - Prevent negative inventory unless a specifically authorized business setting permits it.
   - Protect concurrent stock operations from overselling or double issuance.

6. **Security by default**
   - Use secure HTTP-only cookies or another well-justified secure session strategy.
   - Implement password hashing, rate limiting, CSRF protection where applicable, secure cookie settings, session revocation, and account lockout/throttling.
   - Never log passwords, access tokens, refresh tokens, reset tokens, or sensitive secrets.

7. **Online-first responsive web application**
   - Optimize for desktop, tablet, and mobile browser use.
   - The first release is online-first. Do not add offline stock transactions unless a later phase explicitly defines conflict resolution and synchronization.

---

## 4. Item Classification and Tracking Model

Use an `Item Master` as the common product/catalog definition. Keep business category separate from tracking method so the system remains flexible.

### Business categories

- `SERIALIZED_ASSET`
  - Examples: laptops, monitors, instruments, machines, specialized tools.
- `CONSUMABLE`
  - Examples: paper, ink, PPE, cleaning supplies, electronic components.
- `BULK_NON_CONSUMABLE`
  - Examples: chairs, extension cables, generic tools, reusable accessories.

### Tracking methods

- `SERIAL`
  - Each physical unit creates an individual asset instance.
- `QUANTITY`
  - Stock is tracked by item, unit of measure, branch, warehouse, and storage location.
- `LOT`
  - Stock is tracked by batch/lot, with optional manufacturing date and expiration date.

### Default rules

- `SERIALIZED_ASSET` defaults to `SERIAL`.
- `CONSUMABLE` defaults to `QUANTITY`, but may use `LOT` when batch or expiry tracking is required.
- `BULK_NON_CONSUMABLE` may use `QUANTITY` or `SERIAL`, depending on whether individual custody and return history are required.
- Maintenance applies only to individually identifiable, serialized asset instances.

---

## 5. Barcode and QR-Code Design

### Serialized assets

Every serialized asset instance must receive:

- A unique internal asset tag.
- A Code 128 barcode or equivalent one-dimensional barcode.
- A QR code.
- A human-readable label.
- A system scan token that resolves to the asset record.

Recommended internal tag pattern:

```text
AST-{BRANCH_CODE}-{CATEGORY_CODE}-{YEAR}-{SEQUENCE}
```

Examples:

```text
AST-MNL-LAP-2026-000123
AST-SUB-MON-2026-000045
```

The QR code should contain an opaque scan URL or scan token, not sensitive record data. A scan must still require authentication and authorization before showing protected details.

### Consumables

Do not create a unique barcode for every individual piece by default. Use the following model:

- Assign one unique internal SKU barcode to the item or stocking unit.
- Allow multiple alternate barcodes for the same SKU, including supplier, UPC, EAN, and packaging barcodes.
- Scanning the item barcode identifies the SKU; the user then enters or confirms the quantity being received, issued, returned, transferred, or counted.
- If a consumable is lot-controlled, generate or capture a unique barcode for each lot or batch.
- Allow bin, shelf, and storage-location labels to have their own barcodes.
- Support unit-of-measure conversions such as:
  - `1 BOX = 10 PACKS`
  - `1 PACK = 100 PIECES`
- The transaction must store both the entered unit and normalized base-unit quantity.

Recommended internal patterns:

```text
SKU-{CATEGORY_CODE}-{SEQUENCE}
LOT-{SKU_CODE}-{DATE}-{SEQUENCE}
BIN-{BRANCH_CODE}-{WAREHOUSE_CODE}-{LOCATION_CODE}
```

### Bulk non-consumables

- If quantity-tracked, use the consumable/SKU scanning workflow.
- If each unit is assigned to an employee or requires individual condition and return history, use serialized asset tags.

### Scan workflows

Support:

- USB/Bluetooth scanners that type and submit the barcode.
- Mobile/tablet camera scanning.
- Rapid-scan receiving, issuance, transfer, return, and physical count modes.
- Duplicate-scan protection.
- Audible and visual success/error feedback.
- Manual code entry when scanning is unavailable.
- Label preview and printing for common label sizes.

---

## 6. Organizations, Branches, Warehouses, and Locations

Model the hierarchy:

```text
Organization
  Branch
    Warehouse or Stockroom
      Storage Location
        Zone / Aisle / Rack / Shelf / Bin
```

Required capabilities:

- Create and manage branches.
- Create one or more warehouses or stockrooms per branch.
- Create nested or structured storage locations.
- Mark records active or inactive without deleting history.
- Designate default receiving and issuance locations.
- Assign users to one or more permitted branches.
- Support inter-location, intra-branch, and inter-branch transfers.
- Store the current location of serialized assets and the stock location of quantity-tracked items.

---

## 7. Authentication and User Management

Implement:

- Login and logout.
- Create, edit, activate, deactivate, and archive users.
- Password setup, reset, and forced reset.
- Session listing and revocation where practical.
- Failed-login throttling and security-event logging.
- Last successful login and last activity.
- Optional future-ready support for OIDC/SSO, but local credentials are sufficient for the first release.

Do not allow hard deletion of users referenced by business records. Deactivate them instead.

---

## 8. Roles, Permissions, and Branch Scope

Implement role-based access control with granular permissions. Users may have multiple roles. Roles contain permissions, and users may optionally receive carefully audited permission overrides.

Permission actions should include:

- View
- Create
- Edit draft
- Submit for approval
- Approve
- Reject
- Post
- Cancel
- Reverse
- Archive
- Export
- Print
- View cost
- View audit history
- Manage settings

Permissions must be resource-specific, such as:

```text
asset.view
asset.create
asset.update
asset.assign
asset.transfer
asset.retire
asset.dispose
inventory.view
inventory.receive
inventory.issue
inventory.return
inventory.transfer
inventory.adjust
procurement.po.create
procurement.po.approve
maintenance.work_order.manage
reports.export
audit.view
```

Create these initial roles:

1. **Super Admin**
   - Full system and all-branch access.
   - Cannot bypass audit logging.

2. **Branch Admin**
   - Manages authorized branches only.
   - Manages branch users, operations, and reports subject to permissions.

3. **Warehouse Custodian**
   - Receives, issues, returns, transfers, counts, and adjusts inventory subject to approval rules.

4. **Asset Custodian**
   - Registers, assigns, transfers, returns, inspects, and retires serialized assets subject to approval rules.

5. **Maintenance Personnel**
   - Views maintainable assets and manages assigned maintenance work orders.
   - May consume approved spare parts through linked stock issues.

6. **Auditor / Viewer**
   - Read-only access to authorized branches, reports, ledgers, and audit logs.
   - Export permission may be configured separately.

7. **Employee / Requester**
   - Views assets assigned to them.
   - Creates permitted requests, reports damage/loss, and acknowledges issuance or return.

All list, search, report, export, and detail endpoints must enforce branch scope.

---

## 9. Basic Employee Management

Employees are not necessarily system users. A user account may optionally link to an employee record.

Store only information needed for custody and transaction tagging:

- Employee number.
- First, middle, and last name.
- Preferred/display name.
- Work email.
- Work phone or extension.
- Branch.
- Department.
- Position/title.
- Immediate supervisor or manager.
- Employment status: active, inactive, separated, suspended, or equivalent.
- Start date and optional separation date.
- Optional profile photo.
- Notes with restricted visibility.
- Linked system user, when applicable.

Provide:

- Employee list, detail, filtering, import, export, activation, and archival.
- Current assigned assets.
- Consumable issuance history.
- Returned assets and condition history.
- Outstanding acknowledgments and overdue returns.

Do not implement payroll, attendance, leave, recruitment, benefits, performance, or timekeeping.

---

## 10. Lookup and Configuration Tables

Provide an admin interface for lookup values, including:

- Asset type.
- Item category.
- Item subcategory.
- Brand and manufacturer.
- Model.
- Unit of measure and conversion.
- Department.
- Position.
- Asset condition.
- Asset lifecycle status.
- Transaction reason.
- Adjustment reason.
- Disposal method.
- Maintenance type.
- Maintenance priority.
- Work-order status.
- Supplier category.
- Document type.
- Notification type.

Lookup records should support:

- Code.
- Name.
- Description.
- Sort order.
- Active/inactive state.
- Optional branch scope.
- Protection from deletion when already referenced.

Use enums only for true system invariants. Use configurable tables for business-managed values.

---

## 11. Item Master and Catalog

Required fields:

- Internal item/SKU code.
- Item name.
- Description.
- Business category.
- Tracking method.
- Category and subcategory.
- Brand, manufacturer, and model.
- Base unit of measure.
- Purchasing and issuance units.
- UOM conversions.
- Primary barcode and alternate barcodes.
- Default supplier.
- Standard or reference cost.
- Last purchase cost.
- Reorder level by warehouse.
- Reorder quantity by warehouse.
- Minimum and maximum stock by warehouse.
- Lot tracking requirement.
- Expiration tracking requirement.
- Serial number requirement.
- Maintenance eligibility.
- Image and attachments.
- Active/inactive status.

Prevent duplicate internal codes and duplicate active barcode mappings.

---

## 12. Serialized Asset Management

Each physical asset instance should store:

- System ID.
- Unique asset tag.
- Manufacturer serial number.
- Linked Item Master.
- Barcode and QR scan token.
- Acquisition source and purchase-order/receipt link.
- Acquisition date.
- Acquisition cost, subject to permission.
- Supplier.
- Warranty start and end date.
- Current branch, warehouse, storage location, or employee custodian.
- Department or cost center.
- Lifecycle status.
- Current condition.
- Maintenance-required flag.
- Criticality or priority.
- Last inspection date.
- Next maintenance date.
- Retirement date and disposal details.
- Photos, receipt, warranty, manual, and supporting documents.
- Notes.

Lifecycle states should include:

- Draft
- Available
- Reserved
- Assigned
- In Transfer
- Under Inspection
- Under Maintenance
- Damaged
- Lost
- Retired
- Disposed

Enforce valid transitions. For example:

- A disposed asset cannot be assigned.
- An asset under maintenance cannot be transferred or issued unless the work order is completed or canceled.
- A lost asset cannot return to available without an authorized recovery workflow.
- A posted disposal cannot be deleted; it requires an authorized reversal where legally and operationally appropriate.

Maintain complete custody, condition, location, and status history.

---

## 13. Inventory and Stock Transactions

Support these transaction types:

- Opening balance.
- Purchase receipt.
- Non-purchase receipt.
- Issue to employee.
- Issue to department or project.
- Return from employee.
- Return to supplier.
- Location transfer.
- Inter-branch transfer.
- Stock adjustment increase.
- Stock adjustment decrease.
- Maintenance-parts issue.
- Disposal or write-off.
- Reversal.

Every transaction must contain:

- Transaction number.
- Transaction type.
- Status.
- Transaction date and posting timestamp.
- Source and destination branch/location when applicable.
- Item lines.
- Lot/batch and expiry when applicable.
- Entered UOM and quantity.
- Normalized base quantity.
- Unit cost and total cost where permitted.
- Employee, department, project, supplier, purchase order, maintenance order, or asset references when applicable.
- Reason code and notes.
- Attachments.
- Creator, approver, poster, and reversal information.

Use statuses:

- Draft
- Pending Approval
- Approved
- Rejected
- Posted
- Canceled
- Reversed

Only posted transactions affect stock.

### Stock rules

- Do not allow zero or negative transaction quantities.
- Do not allow stock to fall below zero by default.
- Validate available quantity at posting time inside the database transaction.
- Respect lot expiry and optionally enforce FEFO for expiring consumables.
- Support FIFO-style operational suggestions without implementing full financial accounting.
- Low-stock detection is based on available stock compared with configured reorder level per warehouse.
- Display available, reserved, in-transfer, damaged/quarantined, and on-hand quantities separately where relevant.

---

## 14. Procurement

Implement:

### Suppliers

- Supplier code and legal/trade name.
- Address and contact information.
- Contact people.
- Tax or registration fields as configurable optional information.
- Payment terms as reference text only.
- Categories.
- Active/inactive status.
- Documents and notes.
- Purchase and delivery history.

### Purchase Orders

- Auto-generated PO number.
- Supplier.
- Ordering branch and destination warehouse.
- Order date and expected delivery date.
- Currency.
- Line items, UOM, quantity, unit price, discount, tax, and total.
- Terms, notes, and attachments.
- Created by, approved by, and approval timestamps.
- Draft, Pending Approval, Approved, Partially Received, Fully Received, Canceled, and Closed states.

### Receiving

- Receive against an approved purchase order.
- Support partial and multiple receipts.
- Prevent received quantity from exceeding ordered quantity unless an authorized tolerance or override is provided.
- Capture supplier delivery receipt/invoice reference.
- Generate asset instances for serialized purchase lines.
- Generate or capture lot records for lot-controlled consumables.
- Update stock only when the receipt is posted.
- Link all created asset and stock records to the PO and receiving document.

### Purchase History

- Search by supplier, item, branch, warehouse, date range, PO, receipt, and status.
- Report ordered, received, outstanding, canceled, and returned quantities.
- Report purchase costs only to users with cost-view permission.

Do not implement supplier payments, journal entries, accounts payable, or general-ledger integration in the first release.

---

## 15. Asset Assignment, Issuance, and Return

Support:

- Assign serialized assets to an employee, department, project, or location.
- Issue consumables to an employee, department, project, or work order.
- Expected return date for temporary assignments.
- Employee acknowledgment through authenticated confirmation or a captured acknowledgment record.
- Condition at issuance and return.
- Photos and notes.
- Return, reassignment, and transfer workflows.
- Overdue-return alerts.
- Lost or damaged reporting.
- Custody agreement or printable acknowledgment form.

An employee separation or deactivation workflow must display outstanding assigned assets before final archival. Do not automatically mark those assets returned.

---

## 16. Transfers

Support:

- Bin-to-bin or location-to-location transfer.
- Warehouse-to-warehouse transfer within a branch.
- Inter-branch transfer.
- Employee-to-employee reassignment.

For controlled inter-branch transfers:

1. Create draft transfer.
2. Submit for approval.
3. Approve or reject.
4. Dispatch from source.
5. Mark inventory or asset as `In Transfer`.
6. Receive and inspect at destination.
7. Post receipt and finalize destination custody/location.

Track dispatched, received, damaged-in-transit, short, and rejected quantities. Preserve source and destination acknowledgment.

---

## 17. Physical Inventory and Cycle Counts

Implement:

- Full physical count and cycle-count sessions.
- Count scope by branch, warehouse, location, category, or selected items.
- Freeze or snapshot expected balances at count start.
- Barcode-assisted counting.
- Blind-count option where expected quantity is hidden.
- Recount workflow.
- Variance report.
- Approval for adjustment transactions created from discrepancies.
- Asset existence verification, condition confirmation, and location confirmation.
- Missing, unexpected, duplicate, and misplaced asset flags.

Counts must not directly overwrite stock. Approved discrepancies create posted stock-adjustment transactions.

---

## 18. Maintenance Management

Maintenance applies to serialized assets.

### Maintenance plans

- Preventive maintenance templates.
- Frequency by date interval, usage meter, or configurable schedule.
- Assigned internal team or external vendor.
- Checklist and required tasks.
- Estimated duration and cost.
- Reminder lead time.

### Work orders

- Work-order number.
- Asset.
- Type: preventive, corrective, inspection, calibration, emergency, or configurable type.
- Priority.
- Problem description.
- Reported by and reported date.
- Assigned technician/team/vendor.
- Planned and actual start/end.
- Checklist, diagnosis, action taken, and resolution.
- Parts consumed through linked inventory issues.
- Labor, parts, and external-service cost.
- Downtime.
- Photos, documents, quotations, and service reports.
- Next maintenance date.

Suggested statuses:

- Draft
- Open
- Assigned
- Scheduled
- In Progress
- On Hold
- Awaiting Parts
- Awaiting Vendor
- Completed
- Verified
- Canceled

### Maintenance rules

- An asset may be manually tagged as requiring maintenance.
- Automatic tagging may occur after failed inspection, damage report, or due maintenance.
- The asset lifecycle should become `Under Maintenance` when applicable.
- Completion must record final condition and whether the asset returns to `Available`, `Assigned`, `Damaged`, or `Retired`.
- Scheduled jobs should generate upcoming and overdue maintenance alerts.
- Preserve complete maintenance cost and downtime history.

---

## 19. Approvals

Implement a configurable approval framework for:

- Purchase orders.
- Disposal and write-off.
- Stock adjustments.
- Inter-branch transfers.
- Lost or damaged asset declarations.
- Asset retirement.
- High-value transactions.
- Other configured transaction types.

Support:

- One or more approval steps.
- Approver role or named approver.
- Branch scope.
- Amount or quantity thresholds.
- Approve, reject, return for revision, and cancel.
- Required comments for rejection.
- Delegation with start and end dates.
- Full approval history.
- Notifications to approvers and requesters.

By default, a requester cannot approve their own controlled transaction. Any override must be explicitly permitted and audited.

Approved and posted documents must not be silently modified. Material changes require resubmission or a reversal/correction flow.

---

## 20. Notifications and Alerts

Provide in-app notifications and design the service so email or messaging channels can be added later.

Alert types:

- Low stock and out of stock.
- Pending approval.
- Rejected or returned transaction.
- Upcoming and overdue maintenance.
- Warranty expiration.
- Lot expiration.
- Overdue asset return.
- Unreceived inter-branch transfer.
- Employee separation with outstanding assets.
- Failed scheduled job or integration.

Support read/unread state, deep links to related records, recipient rules, deduplication, and notification history.

---

## 21. Dashboard, Analytics, and Reports

All dashboards and reports must respect permissions and branch scope. Provide date, branch, warehouse, category, item, employee, department, supplier, status, and other relevant filters.

### Dashboard

Include:

- Total serialized assets.
- Assets by lifecycle status and condition.
- Assigned versus available assets.
- Total inventory SKUs.
- Low-stock and out-of-stock items.
- Pending transfers and approvals.
- Maintenance due and overdue.
- Open maintenance work orders.
- Warranty and lot expirations.
- Recent transactions.
- Purchase orders and outstanding receipts.
- Inventory value and asset acquisition value only for authorized users.

### Operational reports

- Asset register.
- Asset custody and assignment report.
- Asset movement and lifecycle history.
- Asset condition report.
- Retired, disposed, damaged, and lost assets.
- Stock on hand by branch, warehouse, location, item, lot, and UOM.
- Stock movement ledger.
- Low-stock and reorder recommendation report.
- Inventory issuance and consumption by employee, department, project, or period.
- Expiring-lot report.
- Physical-count variance report.
- Transfer status and in-transit inventory.
- Supplier purchase history.
- Purchase-order status and outstanding quantities.
- Maintenance due, overdue, cost, frequency, and downtime.
- Audit activity report.

Allow CSV and XLSX exports. Provide print-friendly or PDF output for key forms and reports, such as asset acknowledgment, transfer document, purchase order, receiving report, maintenance work order, and inventory count sheet.

Large exports should run as queued background jobs and notify the user when ready.

---

## 22. Audit Trail

Create an append-only audit log for:

- Login, logout, failed login, password reset, and session revocation.
- User, role, permission, and branch-access changes.
- Record creation, update, archive, restore, approval, rejection, posting, cancellation, and reversal.
- Asset assignment, return, movement, maintenance, retirement, and disposal.
- Inventory and procurement transactions.
- Report exports containing potentially sensitive data.
- Configuration changes.

Capture where applicable:

- Actor user ID and employee link.
- Action.
- Resource type and resource ID.
- Branch.
- Timestamp in UTC.
- Request/correlation ID.
- IP address and user agent.
- Old values and new values.
- Reason or comment.
- Related transaction or approval ID.

Redact secrets and sensitive authentication fields. Ordinary users cannot edit or delete audit records. Provide authorized search and export with filters.

Use UTC in storage and display dates/times in the configured organization or user timezone.

---

## 23. Attachments and Document Handling

Support attachments for:

- Assets.
- Employees where appropriate.
- Suppliers.
- Purchase orders and receipts.
- Assignments and returns.
- Transfers.
- Maintenance work orders.
- Disposal and adjustment approvals.

Requirements:

- Store metadata in PostgreSQL and bytes in S3-compatible object storage.
- Validate file type and size.
- Generate safe unique object keys.
- Enforce resource and branch authorization for upload and download.
- Record uploader and upload time.
- Support archive/removal with audit history.
- Consider antivirus-scanning hooks for future deployment.
- Never expose the storage bucket publicly.

---

## 24. Import and Export

Provide controlled CSV/XLSX import for:

- Employees.
- Item master.
- Opening balances.
- Existing serialized assets.
- Suppliers.
- Lookup values where safe.

Import workflow:

1. Download template.
2. Upload file.
3. Parse and validate without writing.
4. Show row-level errors and warnings.
5. Preview proposed changes.
6. Confirm import.
7. Process transactionally or in safe chunks.
8. Produce a result file.
9. Audit the import.

Do not partially import invalid rows unless the user explicitly selects an allowed partial-import mode.

---

## 25. Search and User Experience

Provide:

- Global search for asset tag, serial number, item/SKU, barcode, employee, supplier, PO, receipt, work order, and transaction number.
- Permission-aware results.
- Saved filters and column preferences.
- Pagination and server-side filtering for large datasets.
- Clear empty, loading, validation, and error states.
- Responsive navigation.
- Keyboard accessibility.
- Mobile-friendly scan and transaction screens.
- Confirmation dialogs for consequential actions.
- Reason capture for adjustments, reversals, cancellations, disposal, loss, and damage.
- No hardcoded dashboard values or fake analytics in production paths.

Design a professional operations interface with high information density on desktop and simplified task-focused layouts on mobile.

---

## 26. Suggested Core Data Model

Refine this during the design phase, but preserve the concepts:

### Identity and access

- `organizations`
- `users`
- `user_sessions`
- `roles`
- `permissions`
- `role_permissions`
- `user_roles`
- `user_branch_access`
- `user_permission_overrides`

### Organization structure and employees

- `branches`
- `warehouses`
- `storage_locations`
- `departments`
- `positions`
- `employees`

### Catalog and inventory

- `item_categories`
- `item_subcategories`
- `brands`
- `manufacturers`
- `units_of_measure`
- `uom_conversions`
- `items`
- `item_barcodes`
- `item_warehouse_settings`
- `inventory_lots`
- `stock_transactions`
- `stock_transaction_lines`
- `stock_ledger_entries`
- `stock_balances`
- `stock_reservations`

### Serialized assets

- `assets`
- `asset_assignments`
- `asset_movements`
- `asset_condition_history`
- `asset_status_history`
- `asset_acknowledgments`

### Procurement

- `suppliers`
- `supplier_contacts`
- `purchase_orders`
- `purchase_order_lines`
- `goods_receipts`
- `goods_receipt_lines`
- `supplier_returns`

### Transfers and counts

- `transfers`
- `transfer_lines`
- `transfer_receipts`
- `inventory_count_sessions`
- `inventory_count_lines`

### Maintenance

- `maintenance_plans`
- `maintenance_plan_tasks`
- `maintenance_work_orders`
- `maintenance_work_order_tasks`
- `maintenance_parts`
- `asset_meter_readings`

### Workflow and system

- `approval_workflows`
- `approval_steps`
- `approval_requests`
- `approval_actions`
- `notifications`
- `attachments`
- `audit_logs`
- `lookup_values`
- `sequence_counters`

Use UUIDs or another collision-safe identifier for primary keys. Use human-readable, separately generated business numbers for documents and labels. Define unique constraints, foreign keys, indexes, archival strategy, and concurrency controls explicitly.

---

## 27. API Requirements

- Version endpoints under `/api/v1`.
- Use resource-oriented REST endpoints with explicit action endpoints for business transitions such as submit, approve, post, reverse, dispatch, receive, assign, and return.
- Do not implement important business transitions as generic unrestricted record updates.
- Generate OpenAPI documentation.
- Use consistent:
  - Pagination.
  - Filtering.
  - Sorting.
  - Validation errors.
  - Authorization errors.
  - Conflict errors.
  - Idempotency behavior.
- Add idempotency keys for posting-sensitive operations where duplicate client submissions could create duplicate stock movement.
- Return stable machine-readable error codes plus user-friendly messages.
- Add optimistic concurrency controls or version fields for mutable draft records.

---

## 28. Security and Privacy Requirements

- Apply backend authorization to every protected endpoint.
- Validate branch access on both direct records and joined/related records.
- Hash passwords using a modern password-hashing algorithm.
- Use secure, HTTP-only, SameSite cookies when using cookie sessions.
- Protect state-changing requests against CSRF where applicable.
- Apply login and sensitive-endpoint rate limits.
- Validate and sanitize input.
- Prevent SQL injection through parameterized ORM queries.
- Prevent insecure direct object references.
- Restrict attachment access.
- Apply secure headers and a content security policy.
- Keep secrets in environment variables or a secret manager.
- Never expose stack traces or database errors to end users.
- Audit role, permission, branch-access, approval, and export changes.
- Create a database backup and restore guide.

Consider PostgreSQL Row-Level Security as defense in depth only if it can be implemented and tested correctly. Application-layer authorization remains mandatory.

---

## 29. Performance and Reliability

- Use database indexes for codes, barcodes, dates, statuses, foreign keys, branch scope, and frequent report filters.
- Use server-side pagination.
- Avoid N+1 queries.
- Queue heavy exports and scheduled notifications.
- Make scheduled jobs idempotent.
- Add health and readiness endpoints for API, database, Redis, and object storage.
- Use transactional outbox or an equivalent reliable pattern if business events and background notifications must remain consistent.
- Add graceful handling for Redis or storage outages.
- Add database backup, migration, rollback, and disaster-recovery documentation.

---

## 30. Testing Requirements

Create:

- Unit tests for permission checks, quantity/UOM conversion, document numbering, status transitions, reorder detection, and maintenance scheduling.
- Integration tests using a real test PostgreSQL database for stock posting, concurrency, reversal, receiving, transfers, and approvals.
- Authorization matrix tests for every initial role.
- Branch-isolation tests proving users cannot view or mutate unauthorized branch data.
- End-to-end tests for:
  1. Login and logout.
  2. User and role administration.
  3. Create item and receive serialized assets.
  4. Receive consumable stock by quantity and lot.
  5. Assign an asset to an employee and return it.
  6. Issue consumables to an employee.
  7. Inter-branch transfer with approval, dispatch, and receipt.
  8. Low-stock alert.
  9. Maintenance work order and parts issue.
  10. Physical count and approved variance.
  11. PO approval and partial receiving.
  12. Audit-log verification.
- Security tests for common authorization and file-access failures.

Tests must verify database effects, ledger entries, balances, audit logs, and permission enforcement—not only HTTP success codes.

---

## 31. Seed Data and Demonstration Scenario

Provide development seed data for:

- One organization.
- At least three branches.
- Multiple warehouses and storage locations.
- All initial roles.
- Sample users for each role.
- Departments, positions, and employees.
- Serialized assets, consumables, and bulk non-consumables.
- Quantity-, serial-, and lot-tracked items.
- Suppliers.
- Low-stock examples.
- Purchase orders and partial receipts.
- Asset assignments.
- Pending transfer.
- Upcoming and overdue maintenance.
- Audit entries generated through real service actions where possible.

Never use seed credentials in production. Document development credentials clearly and force replacement outside development.

---

## 32. Implementation Phases

### Phase 0: Discovery and architecture

- Inspect the existing repository and preserve unrelated user changes.
- Confirm the development commands and environment.
- Produce:
  - Architecture decision record.
  - Module map.
  - ERD.
  - Permission matrix.
  - Status-transition tables.
  - API outline.
  - Implementation plan.
- Identify assumptions and risks.

### Phase 1: Foundation

- Monorepo and tooling.
- Docker development services.
- PostgreSQL, Prisma, Redis, and object storage setup.
- Authentication.
- Users, roles, permissions, and branch access.
- Organization structure.
- Audit foundation.
- Shared UI shell and design system.

### Phase 2: Employees, lookups, and catalog

- Basic employee management.
- Lookup configuration.
- Item master.
- UOM conversion.
- Barcode mapping.
- Import templates.

### Phase 3: Inventory and serialized assets

- Stock-ledger engine.
- Receiving, issuance, return, transfer, adjustment, and reversal.
- Serialized asset instances.
- Asset lifecycle and custody.
- Barcode/QR generation and scanning.
- Low-stock rules.

### Phase 4: Procurement

- Suppliers.
- Purchase orders and approvals.
- Partial and full receiving.
- Serialized-asset creation during receipt.
- Lot creation.
- Purchase history.

### Phase 5: Maintenance

- Maintenance plans.
- Scheduling and reminders.
- Work orders.
- Parts issuance.
- Cost and downtime history.

### Phase 6: Counts, approvals, and notifications

- Physical inventory and cycle counts.
- Reusable approval workflows.
- In-app notifications.
- Background jobs.

### Phase 7: Analytics and reports

- Dashboard.
- Operational reports.
- CSV/XLSX/PDF outputs.
- Background exports.

### Phase 8: Hardening and deployment

- End-to-end authorization and branch-isolation review.
- Performance tests.
- Accessibility review.
- Backup/restore test.
- Production Docker configuration.
- Deployment, upgrade, migration, and rollback guides.

At the end of each phase:

- Run linting, type checks, migrations, unit tests, integration tests, and relevant end-to-end tests.
- Report exactly what changed.
- Report commands executed and their results.
- List remaining risks or incomplete work.
- Update documentation.
- Do not mark a phase complete while required tests are failing.

---

## 33. Minimum Acceptance Criteria

The first production-ready release is acceptable only when:

1. Authorized administrators can create users and assign roles and branches.
2. Users see and modify only permitted resources in permitted branches.
3. Employees can be created without any payroll, attendance, or leave functionality.
4. All three item categories and all three tracking modes work.
5. Every serialized asset has a unique asset tag, barcode, and QR code.
6. Consumables use SKU/package or lot barcodes and quantity entry rather than a barcode per individual piece.
7. Receiving an approved PO correctly creates stock and serialized asset records.
8. Partial receiving works without corrupting outstanding PO quantities.
9. Posted stock movements create immutable ledger entries and correct balances.
10. Stock cannot become negative under concurrent issue attempts.
11. Asset assignment, acknowledgment, return, and custody history work.
12. Inter-branch transfer approval, dispatch, in-transit state, and destination receipt work.
13. Low-stock detection uses warehouse-specific reorder settings.
14. Maintenance due dates, work orders, parts use, cost, and downtime are tracked.
15. Physical counts create approved adjustment transactions rather than overwriting balances.
16. Controlled actions follow approval rules and cannot be self-approved by default.
17. Dashboards, reports, exports, and searches respect permissions and branch scope.
18. Critical changes appear in an immutable, searchable audit trail.
19. The interface is usable on desktop, tablet, and mobile browsers.
20. Automated tests cover critical workflows, security rules, branch isolation, and ledger integrity.
21. The repository includes environment setup, local development, deployment, backup, restore, and troubleshooting documentation.

---

## 34. Codex Working Instructions

When implementing this project:

1. Inspect the repository, current branch, project instructions, existing code, and working-tree changes before editing.
2. Preserve unrelated user changes.
3. Do not run destructive Git, database, or filesystem operations without explicit authorization.
4. Present the Phase 0 architecture and implementation plan before large-scale generation.
5. Prefer small, reviewable, vertically complete changes.
6. Use migrations for every schema change.
7. Keep business logic in testable backend domain services, not only controllers or UI components.
8. Keep authorization centralized and deny by default.
9. Keep stock posting, approvals, and reversals transactional.
10. Do not use mock data in real application paths.
11. Do not leave placeholder buttons or fake completed features.
12. Do not claim completion without running the relevant verification commands.
13. If the repository is empty, scaffold only the foundation needed for the current phase.
14. If a requirement conflicts with the existing architecture, explain the conflict and propose the smallest safe resolution.
15. Maintain a living `README`, architecture notes, ERD, API documentation, permission matrix, and implementation checklist.

Begin with Phase 0. Return:

- Repository assessment.
- Proposed architecture and module boundaries.
- Proposed ERD and major constraints.
- Proposed barcode strategy.
- Proposed permission and branch-scoping model.
- Proposed stock-ledger and posting design.
- Proposed phase plan with verification criteria.
- Any blocking questions only.

Do not start broad implementation until the Phase 0 design has been presented and accepted.

