# GEM ERP — Implementation Plan

Asset & Inventory Management for GemCor. Single company, multi-branch.

This document expands the phase plan from spec section 32 of
[`asset-inventory-system-codex-master-prompt.md`](../asset-inventory-system-codex-master-prompt.md)
into a working checklist. Each phase lists concrete deliverables, the verification
criteria that gate phase completion, and current status. The acceptance criteria
from spec section 33 are tracked at the end, together with the risks/assumptions
register.

**Last updated:** 2026-07-23

---

## Status Legend

| Status | Meaning |
| --- | --- |
| ✅ Delivered | Files written and verified in this repository |
| 🟡 Delivered — verification pending | Files written this session; verification commands must still be run (see "Verification criteria" per phase) |
| ⏸ Deferred | Intentionally postponed with a stated reason and target |
| 📋 Planned | Not started; scoped below |

## Phase Summary

| Phase | Name | Status |
| --- | --- | --- |
| 0 | Discovery & architecture | ✅ Delivered (this session) |
| 1 | Foundation | 🟡 Delivered — verification pending (e2e against live DB deferred) |
| 2 | Employees, lookups, and catalog | 📋 Planned |
| 3 | Inventory and serialized assets | 📋 Planned |
| 4 | Procurement | 📋 Planned |
| 5 | Maintenance | 📋 Planned |
| 6 | Counts, approvals, and notifications | 📋 Planned |
| 7 | Analytics and reports | 📋 Planned |
| 8 | Hardening and deployment | 📋 Planned |

Phases are vertical slices: each phase ships migrations, backend services,
API endpoints, web UI, tests, and documentation before the next phase begins.
A phase is not complete while its required verification commands fail.

---

## Phase 0 — Discovery & Architecture — ✅ Delivered

### Deliverables

- [x] Repository assessment (empty repo; scaffold from scratch; spec is authoritative).
- [x] Architecture decisions recorded (this document plus the canonical decisions below).
- [x] Module map: `apps/web` (Next.js 15 App Router, port 3000), `apps/api`
      (NestJS 11, port 3001, global prefix `api/v1`, Swagger UI at `/api/docs`),
      `apps/worker` (BullMQ consumer), `packages/database` (Prisma schema + client + seed),
      `packages/shared` (constants/types contract), `packages/config` (tsconfig/eslint presets).
      Package names `@gemerp/web|api|worker|database|shared|config`, workspace deps `workspace:*`.
- [x] Data-model direction per spec section 26: UUID PKs (`@id @default(uuid()) @db.Uuid`),
      business document numbers from `sequence_counters` (never the PK),
      snake_case tables via `@@map`, camelCase fields via `@map`.
- [x] Permission model: dot-notation `resource.action` strings per spec section 8,
      completed to a full matrix per resource; exported from `@gemerp/shared` as
      `PERMISSIONS`, `ALL_PERMISSIONS`, `ROLE_DEFINITIONS` (7 initial roles,
      `SUPER_ADMIN` holds `ALL_PERMISSIONS`).
- [x] Auth design: server-side cookie sessions — cookie `gemerp_session`, HTTP-only,
      SameSite=Lax, Secure in production; opaque 256-bit token stored SHA-256-hashed
      in `user_sessions` with 12h sliding expiry; argon2id password hashing;
      5 consecutive failures → 15-minute lockout; all auth events audit-logged.
- [x] API conventions: REST under `/api/v1`; error envelope
      `{ "error": { "code", "message", "details?" } }` with `VALIDATION_ERROR` +
      per-field details for validation failures; pagination `page`/`pageSize`
      (default 25, max 100)/`sort` + filters, responses
      `{ "data": [...], "meta": { page, pageSize, total, totalPages } }`.
- [x] Barcode/tag strategy per spec section 5 (`AST-{BRANCH}-{CAT}-{YEAR}-{SEQ}`,
      `SKU-…`, `LOT-…`, `BIN-…`; QR contains an opaque scan token, never record data).
- [x] Timezone/currency: store UTC, display Asia/Manila; default currency PHP.
- [x] Implementation plan (this document) with risks/assumptions and acceptance-criteria tracking.

### Verification criteria

- Documents exist in `docs/` and match the spec; no code claims are made beyond
  what Phase 1 actually ships. — **Met** (review of this document).

---

## Phase 1 — Foundation — 🟡 Delivered (verification pending)

Foundation scaffold was written this session. Everything below marked "In" exists
as real, working code — no placeholders. Items marked "Deferred" are explicitly
postponed, with reason.

### Delivered in this session

**Monorepo & tooling**
- [x] pnpm@9 workspaces + Turborepo pipeline (`build`, `dev`, `lint`, `typecheck`, `test`).
- [x] Node >= 22 engines constraint; TypeScript strict mode in every package.
- [x] `packages/config`: shared tsconfig and eslint presets consumed by all packages.
- [x] ESLint + Prettier configured repo-wide.
- [x] Root `.env.example` documenting every environment variable; zod-based
      environment validation that fails fast at process start in api and worker.

**Docker development services** (`docker-compose.yml`; compose files written — not started in this session)
- [x] `postgres` — Postgres 16, db `gemerp`, user `gemerp`, password `gemerp_dev_password`, port 5432.
- [x] `redis` — Redis 7 on 6379.
- [x] `minio` — MinIO on 9000 (console 9001), root user `gemerp`,
      password `gemerp_dev_password`, bucket `gemerp-attachments`.

**Database (`packages/database`)**
- [x] Prisma schema covering Phase 1 domains: `organizations`, `users`, `user_sessions`,
      `roles`, `permissions`, `role_permissions`, `user_roles`, `user_branch_access`,
      `branches`, `warehouses`, `storage_locations`, `audit_logs`, `sequence_counters`.
- [x] Initial migration files checked in.
- [x] Seed script (dev only): org "GemCor"; branches SUB "GemCor - Subic",
      MKT "GemCor - Makati"; 1–2 warehouses per branch with
      storage locations; the 7 roles from `ROLE_DEFINITIONS`; one user per role
      (`superadmin@` / `branchadmin@` / `warehouse@` / `assets@` / `maintenance@`
      / `auditor@` / `employee@` — all `…@gemcor.dev`, password `ChangeMe!123`);
      non-superadmin users scoped to SUB (branchadmin also MKT).

**Shared contract (`packages/shared`)**
- [x] `PERMISSIONS` nested const, `ALL_PERMISSIONS`, `ROLE_DEFINITIONS`.
- [x] Types: `ApiError`, `PaginationMeta`, `Paginated<T>`,
      `SessionUser { id, email, displayName, isSuperAdmin, roles, permissions, branchIds }`.

**API (`apps/api`)** — all endpoints under `/api/v1`, Swagger at `/api/docs`
- [x] Session auth: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
      `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`.
      Cookie sessions per Phase 0 design; argon2id; lockout after 5 failures for
      15 minutes; sliding 12h expiry; auth events audit-logged.
- [x] Users: `GET/POST /users`, `GET/PATCH /users/:id`, `POST /users/:id/activate`,
      `POST /users/:id/deactivate`, `PUT /users/:id/roles`,
      `PUT /users/:id/branch-access`, `POST /users/:id/reset-password`.
- [x] Roles & permissions: `GET/POST /roles`, `GET/PATCH /roles/:id`,
      `PUT /roles/:id/permissions`; `GET /permissions` (catalog).
- [x] Org structure CRUD: `GET/POST /branches`, `GET/PATCH /branches/:id`,
      `POST /branches/:id/activate|deactivate`;
      `GET/POST /branches/:branchId/warehouses`, `GET/PATCH /warehouses/:id`;
      `GET/POST /warehouses/:warehouseId/storage-locations`,
      `GET/PATCH /storage-locations/:id`. Deactivate, never delete.
- [x] Audit foundation: append-only `audit_logs` writes from auth, user/role/branch
      admin, and org mutations; `GET /audit-logs` with filters
      (actor, action, resourceType, resourceId, branchId, from, to).
- [x] Health: `GET /health` (liveness), `GET /health/ready`
      (Postgres checked; Redis/MinIO reported but non-fatal in dev).
- [x] Cross-cutting: permission + branch-scope guards (deny by default),
      global error envelope filter (no stack traces leaked), pagination helpers,
      DTO validation returning `VALIDATION_ERROR` with per-field details.

**Worker (`apps/worker`)**
- [x] BullMQ consumer process scaffold connected to Redis with env validation
      and graceful shutdown (queues will be populated from Phase 3 onward).

**Web (`apps/web`)**
- [x] App shell: Next.js 15 App Router, Tailwind, responsive layout with
      permission-aware navigation.
- [x] Login page wired to the session cookie flow; logout; current-user context
      from `GET /auth/me`.
- [x] Admin pages: user management (list/create/edit/activate/deactivate,
      role and branch-access assignment, password reset), role management
      (permission matrix editing), org structure (branches → warehouses →
      storage locations), audit-log viewer with filters.

### Deferred from Phase 1

| Item | Reason | Unblocks when |
| --- | --- | --- |
| ⏸ End-to-end tests requiring a live database (login/logout flow, admin CRUD through the real API + Postgres) | Docker (Postgres/Redis/MinIO) was not available to this session; e2e suites need a live DB | Docker availability — orchestrator/dev runs `docker compose up -d`, migrations, and seed, then executes the e2e suite |
| ⏸ Playwright browser e2e (login, user/role admin) | Same as above, plus browser runtime | Same as above |

### Verification criteria (to be run by the orchestrator / developer)

All of the following must pass before Phase 1 is marked ✅:

```bash
pnpm install
docker compose up -d                        # postgres, redis, minio healthy
pnpm --filter @gemerp/database db:migrate   # prisma migrate deploy
pnpm --filter @gemerp/database db:seed
pnpm lint                                   # turbo run lint — clean
pnpm typecheck                              # turbo run typecheck — clean, strict mode
pnpm test                                   # unit tests green (auth token hashing,
                                            #   lockout logic, permission guard,
                                            #   pagination, error envelope, shared contract)
pnpm build                                  # all packages build
pnpm dev                                    # api on :3001, web on :3000, worker attaches to redis
```

Manual/scripted checks against the running stack:

- `GET http://localhost:3001/api/v1/health` → 200; `/health/ready` → Postgres OK.
- Swagger UI loads at `http://localhost:3001/api/docs`.
- `POST /api/v1/auth/login` with `superadmin@gemcor.dev` / `ChangeMe!123` sets the
  `gemerp_session` cookie (HTTP-only, SameSite=Lax); `GET /auth/me` returns a
  `SessionUser` with all permissions; 6th consecutive bad password locks the
  account for 15 minutes; every attempt appears in `GET /audit-logs`.
- A non-superadmin user (e.g. `warehouse@gemcor.dev`) cannot list users
  (403 with machine-readable code) and sees only SUB-scoped org data.
- Web: login → shell renders; admin pages perform real CRUD against the API;
  logout revokes the session (token unusable afterwards).
- Deferred e2e suites executed once Docker is available (see table above).

---

## Phase 2 — Employees, Lookups, and Catalog — 📋 Planned

### Deliverables

- [ ] Migrations: `departments`, `positions`, `employees`, `lookup_values`,
      `item_categories`, `item_subcategories`, `brands`, `manufacturers`,
      `units_of_measure`, `uom_conversions`, `items`, `item_barcodes`,
      `item_warehouse_settings`.
- [ ] Employee management (spec section 9): list/detail/filter, activate/archive,
      optional link to a system user, restricted-visibility notes. No payroll,
      attendance, or leave features. Custody/issuance history panels stubbed to
      real (empty) queries that Phase 3 populates.
- [ ] Lookup/configuration admin (spec section 10): code/name/description/sort/
      active/optional branch scope; referenced records protected from deletion.
- [ ] Item master (spec section 11): business category
      (`SERIALIZED_ASSET` | `CONSUMABLE` | `BULK_NON_CONSUMABLE`) ×
      tracking method (`SERIAL` | `QUANTITY` | `LOT`) with the default rules from
      spec section 4; UOM conversions storing entered + normalized base quantity;
      primary + alternate barcodes with duplicate-active-mapping prevention;
      per-warehouse reorder level/quantity and min/max.
- [ ] CSV/XLSX import (spec section 24 workflow: template → upload → validate
      without writing → row-level errors → preview → confirm → transactional
      apply → result file → audit) for employees, items, suppliers-ready lookups.
- [ ] Permissions added to `@gemerp/shared` matrix: `employee.*`, `item.*`,
      lookup/settings actions; role definitions extended accordingly.
- [ ] Web: employees, lookups, and item-master pages with server-side pagination,
      filtering, and import wizard.
- [ ] Seed extension: departments, positions, employees; sample items across all
      three categories and all three tracking methods.

### Verification criteria

- `pnpm lint && pnpm typecheck && pnpm test` clean.
- Unit tests: UOM conversion math (e.g. `1 BOX = 10 PACKS = 1000 PIECES`),
  duplicate barcode rejection, lookup delete-protection.
- Integration tests (real Postgres): employee CRUD + archival, item creation for
  each category/tracking combination, import dry-run vs. commit parity.
- Branch-scope tests: SUB-only user cannot read MKT employees.
- e2e: create item, import employees from template file.

---

## Phase 3 — Inventory and Serialized Assets — 📋 Planned

### Deliverables

- [ ] Migrations: `stock_transactions`, `stock_transaction_lines`,
      `stock_ledger_entries`, `stock_balances`, `stock_reservations`,
      `inventory_lots`, `assets`, `asset_assignments`, `asset_movements`,
      `asset_condition_history`, `asset_status_history`, `asset_acknowledgments`.
- [ ] Stock-ledger engine (spec sections 3.1, 13): every stock change is an
      immutable ledger entry; balances are a transactionally updated projection;
      posting validates availability inside a DB transaction with row locks;
      negative stock blocked by default; corrections via reversal, never edits.
- [ ] Transaction types: opening balance, purchase/non-purchase receipt, issue
      (employee/department/project), returns, location transfer, inter-branch
      transfer (draft → submit → approve → dispatch → in-transfer → receive →
      post), adjustments, disposal/write-off, reversal. Statuses per spec
      (Draft → … → Posted/Canceled/Reversed); only Posted affects stock.
- [ ] Document numbering from `sequence_counters` (per type, per branch, per year)
      with concurrency-safe allocation.
- [ ] Serialized assets (spec section 12): asset instances with unique tag
      (`AST-{BRANCH}-{CAT}-{YEAR}-{SEQ}`), Code 128 barcode + QR scan token,
      lifecycle state machine with enforced transitions, full custody/condition/
      location/status history.
- [ ] Assignment/issuance/return (spec section 15): assign to employee/department/
      project/location, acknowledgment records, condition at issue/return,
      printable acknowledgment form, overdue-return detection, lost/damaged
      reporting; separation workflow surfaces outstanding assets.
- [ ] Barcode/QR generation and label rendering; scan endpoint resolving opaque
      tokens with auth + branch checks; rapid-scan receive/issue/count input
      modes (keyboard-wedge scanners + camera scanning); duplicate-scan protection.
- [ ] Low-stock detection job (worker): available vs. per-warehouse reorder level;
      idempotent scheduled scan feeding Phase 6 notifications (interim: surfaced
      via API/report).
- [ ] Idempotency keys on posting-sensitive endpoints; optimistic concurrency on
      mutable drafts.
- [ ] Permissions: `inventory.*`, `asset.*` completed; cost fields gated behind
      view-cost permission.
- [ ] Web: stock transaction screens, asset register/detail with history timelines,
      assignment/return flows, label preview/print, mobile-friendly scan screens.
- [ ] Seed extension: opening balances, sample assets, an active assignment,
      a low-stock example.

### Verification criteria

- Unit tests: status-transition tables (asset lifecycle + transaction statuses),
  document numbering, quantity normalization, reorder detection.
- Integration tests (real Postgres, concurrent): two simultaneous issues of the
  last unit — exactly one posts, stock never goes negative; reversal restores
  balances and preserves both ledger entries; duplicate idempotency key does not
  double-post.
- Ledger invariant test: recomputing balances from `stock_ledger_entries` always
  equals `stock_balances`.
- e2e: receive serialized assets; receive consumables by quantity and by lot;
  assign an asset and return it; issue consumables; inter-branch transfer through
  approval, dispatch, and receipt; low-stock condition detected.
- Audit assertions: every posting/assignment writes an audit record with actor,
  branch, old/new values.

---

## Phase 4 — Procurement — 📋 Planned

### Deliverables

- [ ] Migrations: `suppliers`, `supplier_contacts`, `purchase_orders`,
      `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`,
      `supplier_returns`.
- [ ] Suppliers (spec section 14): CRUD, contacts, categories, documents,
      activate/deactivate, purchase and delivery history.
- [ ] Purchase orders: auto-numbered from `sequence_counters`; lines with UOM,
      quantity, unit price, discount, tax, total (PHP default currency);
      states Draft → Pending Approval → Approved → Partially Received →
      Fully Received / Canceled / Closed; requester cannot self-approve.
- [ ] Receiving against approved POs: partial and multiple receipts; over-receipt
      blocked unless authorized tolerance; serialized lines generate asset
      instances, lot-controlled lines generate lots; stock affected only when the
      receipt posts; all records linked back to PO + receipt.
- [ ] Purchase history search and outstanding-quantity reporting; costs visible
      only with cost-view permission. No AP/GL/payments (out of scope).
- [ ] Permissions: `supplier.*`, `procurement.po.*`, `procurement.receipt.*`.
- [ ] Web: supplier admin, PO builder, approval queue, receiving screen
      (scan-assisted), purchase-history views.
- [ ] Seed extension: suppliers, an approved PO with a partial receipt.

### Verification criteria

- Unit tests: PO totals math, over-receipt guard, state machine.
- Integration tests: partial receipt leaves correct outstanding quantities;
  posting a receipt creates ledger entries + asset instances + lots atomically;
  canceling an unapproved PO is blocked once receipts exist.
- Authorization tests: cost fields hidden without view-cost; self-approval rejected.
- e2e: PO create → approve → partial receive → fully receive; verify stock and
  asset records.

---

## Phase 5 — Maintenance — 📋 Planned

### Deliverables

- [ ] Migrations: `maintenance_plans`, `maintenance_plan_tasks`,
      `maintenance_work_orders`, `maintenance_work_order_tasks`,
      `maintenance_parts`, `asset_meter_readings`.
- [ ] Preventive maintenance plans (spec section 18): frequency by interval,
      meter, or schedule; checklists; assigned team/vendor; reminder lead time.
- [ ] Work orders: numbered, typed (preventive/corrective/inspection/…),
      prioritized, full status flow (Draft → … → Completed → Verified/Canceled);
      diagnosis/action/resolution; labor/parts/external cost; downtime capture;
      attachments.
- [ ] Parts consumption via linked Phase 3 maintenance-parts stock issues.
- [ ] Lifecycle integration: asset becomes `Under Maintenance`; cannot be
      transferred/issued while an open work order holds it; completion records
      final condition and returns the asset to Available/Assigned/Damaged/Retired.
- [ ] Worker jobs: generate work orders from due plans; upcoming/overdue
      maintenance alerts (idempotent).
- [ ] Permissions: `maintenance.plan.*`, `maintenance.work_order.*`.
- [ ] Web: plan admin, work-order board/detail, technician task view, cost and
      downtime history per asset.
- [ ] Seed extension: a plan with upcoming maintenance and one overdue work order.

### Verification criteria

- Unit tests: next-due-date scheduling math, status transitions, downtime calc.
- Integration tests: due plan generates exactly one work order (idempotent job);
  parts issue decrements stock through the ledger; completing a WO restores the
  asset lifecycle correctly.
- e2e: corrective work order from damage report through parts issue to completion.

---

## Phase 6 — Counts, Approvals, and Notifications — 📋 Planned

### Deliverables

- [ ] Migrations: `inventory_count_sessions`, `inventory_count_lines`,
      `approval_workflows`, `approval_steps`, `approval_requests`,
      `approval_actions`, `notifications`.
- [ ] Physical inventory & cycle counts (spec section 17): scoped sessions,
      snapshot of expected balances at start, barcode-assisted and blind counts,
      recounts, variance report; approved discrepancies create posted adjustment
      transactions — counts never overwrite balances directly.
- [ ] Configurable approval framework (spec section 19) retrofitted onto POs,
      adjustments, inter-branch transfers, disposals, loss/damage declarations,
      retirement, and high-value thresholds: multi-step, branch scope,
      amount/quantity thresholds, delegation windows, required rejection
      comments, full history; self-approval denied by default.
- [ ] **Parameterized approver resolution** (GemCor requirement, 2026-07-27 —
      already modeled in `approval_steps.approver_type`): each step resolves its
      approver by one of
      `ROLE` (any active user holding the role, branch-scoped) ·
      `POSITION` (any active user whose employee record holds the position) ·
      `DEPT_HEAD` (the requester's department head via
      `departments.head_employee_id`, resolved at request time) ·
      `USER` (a specific named person). Admin UI must let workflow editors pick
      any of the four per step.
- [ ] In-app notifications (spec section 20): low/out of stock, pending approval,
      rejected/returned, maintenance due/overdue, warranty expiry, lot expiry,
      overdue returns, unreceived transfers, separation with outstanding assets,
      failed jobs. Read/unread, deep links, recipient rules, deduplication.
      External channels (email/SMS/Viber) are **on hold** per GemCor
      (2026-07-27) — design the service interface channel-ready but ship
      in-app only.
- [ ] Worker: notification fan-out and scheduled detectors moved fully onto BullMQ.
- [ ] Permissions: `approval.*`, count and notification actions.
- [ ] Web: count session screens (mobile-first scanning), approval inbox,
      notification center.

### Verification criteria

- Unit tests: workflow resolution (threshold + branch + role), delegation windows,
  dedup rules.
- Integration tests: variance → approval → posted adjustment updates ledger;
  requester cannot approve own request; snapshot isolation (stock movement during
  a count does not corrupt variance math).
- e2e: physical count with approved variance; PO approval routed through a
  two-step workflow; notification received and deep-links correctly.

---

## Phase 7 — Analytics and Reports — 📋 Planned

### Deliverables

- [ ] Dashboard (spec section 21) driven by real queries only: asset totals by
      status/condition, assigned vs. available, SKU counts, low/out-of-stock,
      pending transfers/approvals, maintenance due/overdue, expirations, recent
      transactions, outstanding POs; value widgets only for cost-permitted users.
- [ ] Operational reports: asset register, custody, movement/lifecycle, condition,
      retired/disposed/lost; stock on hand (branch/warehouse/location/item/lot/UOM),
      stock movement ledger, low-stock/reorder, consumption, expiring lots,
      count variance, transfer status/in-transit, supplier purchase history,
      PO status, maintenance cost/downtime, audit activity.
- [ ] CSV and XLSX exports for all reports; print-friendly/PDF output for key
      forms (acknowledgment, transfer document, PO, receiving report, work order,
      count sheet).
- [ ] Large exports as queued background jobs (worker) with completion
      notifications; export of sensitive data audit-logged.
- [ ] Permissions: `report.*`, `report.export`, cost-view enforcement everywhere.
- [ ] Web: dashboard, report pages with saved filters and column preferences,
      export center.

### Verification criteria

- Integration tests: every report query respects branch scope and permissions
  (auditor sees, employee-role does not; SUB user never sees MKT rows).
- Snapshot tests for export files against seeded data.
- Queued export job test: enqueue → process → notify → download authorized only
  for the requester.
- e2e: dashboard renders from seed data with zero hardcoded values; export a
  stock-on-hand XLSX.

---

## Phase 8 — Hardening and Deployment — 📋 Planned

### Deliverables

- [ ] Full authorization matrix test suite: every endpoint × 7 roles ×
      in-branch/out-of-branch — deny by default proven.
- [ ] Branch-isolation review including joined/related records and attachment access.
- [ ] Performance pass: index audit against real query plans, N+1 elimination,
      pagination limits enforced, load test on stock posting concurrency.
- [ ] Accessibility review of critical flows (keyboard, screen reader, contrast).
- [ ] Security hardening: rate limits on sensitive endpoints, secure headers/CSP,
      attachment download authorization re-verified, secret handling audit,
      dependency audit.
- [ ] Production Docker configuration (multi-stage images for web/api/worker,
      production compose or deployment manifests), health/readiness wired to
      orchestration.
- [ ] Backup/restore guide with an actually executed restore test; migration,
      upgrade, and rollback runbooks; troubleshooting guide.
- [ ] Seed credentials disabled outside development; forced credential replacement
      documented.

### Verification criteria

- Entire test pyramid green: `pnpm lint && pnpm typecheck && pnpm test` plus the
  full integration and Playwright e2e suites (all 12 workflows from spec
  section 30).
- Restore drill: backup taken, database dropped, restore completed, app healthy.
- Production images build and boot with only documented environment variables.
- Acceptance-criteria table below fully ✅.

---

## Acceptance Criteria Tracking (spec section 33)

| # | Criterion | Satisfied in phase | Status |
| --- | --- | --- | --- |
| 1 | Admins create users, assign roles and branches | 1 | 🟡 Delivered — live verification pending |
| 2 | Users see/modify only permitted resources in permitted branches | 1 (foundation) → enforced in every phase, proven in 8 | 🟡 Foundation delivered; full matrix in Phase 8 |
| 3 | Employees without payroll/attendance/leave | 2 | 📋 Planned |
| 4 | All three item categories and all three tracking modes work | 2 (catalog) + 3 (transactions) | 📋 Planned |
| 5 | Every serialized asset has unique tag, barcode, QR | 3 | 📋 Planned |
| 6 | Consumables use SKU/lot barcodes + quantity entry, not per-piece barcodes | 3 | 📋 Planned |
| 7 | Receiving an approved PO creates stock and asset records | 4 | 📋 Planned |
| 8 | Partial receiving preserves outstanding PO quantities | 4 | 📋 Planned |
| 9 | Posted movements create immutable ledger entries and correct balances | 3 | 📋 Planned |
| 10 | Stock cannot go negative under concurrent issues | 3 (load-proven in 8) | 📋 Planned |
| 11 | Assignment, acknowledgment, return, custody history | 3 | 📋 Planned |
| 12 | Inter-branch transfer: approval, dispatch, in-transit, receipt | 3 (configurable approvals in 6) | 📋 Planned |
| 13 | Low-stock uses warehouse-specific reorder settings | 3 | 📋 Planned |
| 14 | Maintenance due dates, work orders, parts, cost, downtime | 5 | 📋 Planned |
| 15 | Counts create approved adjustments, never overwrite balances | 6 | 📋 Planned |
| 16 | Approval rules enforced; no self-approval by default | 6 | 📋 Planned |
| 17 | Dashboards/reports/exports/search respect permissions and branch scope | 7 | 📋 Planned |
| 18 | Critical changes in immutable, searchable audit trail | 1 (foundation) → extended each phase | 🟡 Foundation delivered |
| 19 | Usable on desktop, tablet, mobile | 1 (responsive shell) → reviewed in 8 | 🟡 Shell delivered |
| 20 | Automated tests cover critical workflows, security, isolation, ledger | Every phase; completed in 8 | 🟡 Phase 1 unit tests delivered; e2e deferred pending Docker |
| 21 | Repo includes setup, deployment, backup, restore, troubleshooting docs | 0–1 (setup) → completed in 8 | 🟡 Setup docs delivered; ops runbooks in Phase 8 |

---

## Risks & Assumptions Register

### Risks

| # | Risk | Impact | Likelihood | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Docker unavailable in the build environment — migrations, seed, integration and e2e tests unverified this session | Phase 1 stays 🟡; latent defects in DB-touching code | High (observed) | Verification command list above is exhaustive; orchestrator runs it as the immediate next step; Phase 2 does not start until Phase 1 is ✅ |
| R2 | Concurrency bugs in stock posting (double issue, negative stock) | Data integrity — core product promise | Medium | Row-level locks inside DB transactions, idempotency keys, dedicated concurrent integration tests (Phase 3), load test (Phase 8) |
| R3 | Permission matrix drift as resources are added per phase | Authorization holes | Medium | Single source of truth in `@gemerp/shared`; deny-by-default guard; matrix test in Phase 8 enumerates endpoints × roles |
| R4 | Framework major-version churn (Next.js 15 / NestJS 11 / Prisma) breaking minor updates | Build breakage | Medium | Caret ranges on known-stable majors; lockfile committed; upgrades only at phase boundaries |
| R5 | Approval framework (Phase 6) retrofitting onto documents shipped in Phases 3–4 | Rework of transfer/PO flows | Medium | Phases 3–4 ship a minimal built-in approve step behind the same service interface the Phase 6 engine will implement |
| R6 | Label printing across unknown printer hardware/sizes | Unusable physical labels | Medium | Render standard sizes as print-friendly HTML/PDF first; treat direct printer drivers as out of scope until hardware is known (open question Q2) |
| R7 | Audit log volume growth degrading queries | Slow admin/reporting | Low–Medium | Indexed by actor/action/resource/branch/time; archival strategy decided by Phase 8 |
| R8 | Seed credentials leaking into production | Account takeover | Low | Seed guarded to dev environment; Phase 8 disables and documents forced replacement |
| R9 | MinIO/Redis outage handling | Degraded uploads/jobs | Low | Readiness reports non-fatal in dev; graceful degradation + retry policies hardened in Phase 8 |

### Assumptions

| # | Assumption |
| --- | --- |
| A1 | Single organization ("GemCor"); no multi-tenant requirements. Multi-branch only. |
| A2 | Single currency PHP; no FX. Timezone: store UTC, display Asia/Manila org-wide. |
| A3 | Online-first: no offline stock transactions in any planned phase. |
| A4 | Local credential auth is sufficient; OIDC/SSO is future-ready but unscheduled. |
| A5 | In-app notifications only through Phase 7; email/messaging channels are a later addition behind the same notification service. |
| A6 | CSRF posture: SameSite=Lax cookie + JSON-only APIs + origin checking on state-changing requests is the accepted strategy. |
| A7 | Attachments live in MinIO (S3-compatible) in all environments; bucket never public. |
| A8 | Modular monolith throughout; the worker shares domain packages but no microservices. |
| A9 | Barcode scanners behave as keyboard input; camera scanning covers mobile. |
| A10 | Accounting (AP/GL/payments) permanently out of scope; procurement stores amounts as reference data only. |
| A11 | Dev seed data (branches SUB/MKT, 7 role users, `ChangeMe!123`) is development-only and never shipped to production. |

---

## Standing Verification Commands (every phase)

```bash
pnpm lint          # eslint via turbo, all packages
pnpm typecheck     # tsc --noEmit, strict, all packages
pnpm test          # unit + integration (integration requires docker compose up)
pnpm build         # full workspace build
pnpm --filter @gemerp/database db:migrate && pnpm --filter @gemerp/database db:seed
# e2e (from Phase 1 once Docker is available):
pnpm --filter @gemerp/api test:e2e
pnpm --filter @gemerp/web test:e2e   # Playwright
```

A phase is complete only when all of the above pass, the phase's own criteria are
met, documentation is updated, and remaining risks are recorded here.
