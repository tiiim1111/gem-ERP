# GEM ERP — Architecture Decision Record (Phase 0)

**Product:** GEM ERP — Asset & Inventory Management for GemCor. Single company, multi-branch.
**Status:** Accepted (Phase 0 baseline)
**Date:** 2026-07-23
**Authoritative spec:** [`asset-inventory-system-codex-master-prompt.md`](../asset-inventory-system-codex-master-prompt.md)

This document records the foundational architecture decisions for GEM ERP. Later phases build on these decisions; changing any of them requires an explicit superseding entry here, not a silent divergence in code.

---

## 1. Repository Assessment

At Phase 0 start the repository contained only:

- `asset-inventory-system-codex-master-prompt.md` — the authoritative product and engineering specification.
- `WORKLOG.md` — running session log.
- Git metadata (repo initialized, remote `github.com/tiiim1111/gem-ERP`).

There is no existing code, schema, or tooling to preserve or migrate. All architecture choices below are greenfield decisions constrained only by the spec.

Environment findings (from kickoff session): Node v22.23.1 and pnpm 9.x available; Docker is **not** available in this WSL distro until Docker Desktop WSL integration is enabled. Consequence: local Postgres/Redis/MinIO, migrations, and integration tests are deferred to a verification step once Docker is usable. This does not block scaffolding or schema authoring.

---

## 2. Technology Stack

The spec (§2) mandates the baseline; the decisions below pin exact versions and fill in the unspecified details.

| Layer | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript, strict mode everywhere | Spec-mandated; strict mode catches a large class of defects at compile time and is far cheaper to adopt at day zero than retrofit. |
| Frontend | Next.js 15 (App Router), React, Tailwind CSS, shadcn/ui, TanStack Query + Table, React Hook Form + zod, Recharts | Spec-mandated stack. App Router gives server components for fast initial loads of dense operational tables; TanStack Query owns all server state (no bespoke fetch caches). |
| Backend | NestJS 11, REST under `/api/v1`, OpenAPI/Swagger | Spec-mandated. Nest's module system maps 1:1 onto the domain module map (§4), and its guard/interceptor pipeline is the natural home for the centralized authorization and audit layers (§6, §7). |
| Database | PostgreSQL 16 + Prisma ORM with version-controlled migrations | Spec-mandated. Postgres transactional guarantees and row locks are load-bearing for the stock ledger (§5). Prisma gives a typed client shared across api and worker. |
| Jobs | Redis 7 + BullMQ | Spec-mandated. Covers scheduled maintenance reminders, low-stock scans, exports, and notification fan-out. |
| Object storage | MinIO (S3-compatible) | Spec-mandated. Self-hostable in dev and production; the API only ever speaks the S3 protocol, so a managed S3 works unchanged. |
| Monorepo | pnpm@9 workspaces + Turborepo, Node >= 22 | Spec-mandated task-runner requirement; Turborepo gives cached, dependency-ordered `build`/`lint`/`test` across packages. |

**Architecture style: modular monolith.** One NestJS application (`apps/api`) organized into strictly-bounded domain modules, plus one worker process (`apps/worker`) consuming BullMQ queues and sharing the same domain packages. No microservices — the spec (§2) explicitly forbids them absent a real scaling requirement, and a single Postgres transaction boundary is precisely what makes the stock ledger design (§5) simple and correct.

---

## 3. Monorepo Layout

```text
apps/
  web/        @gemerp/web       Next.js 15 App Router UI            (port 3000)
  api/        @gemerp/api       NestJS 11 REST API                  (port 3001, prefix /api/v1, Swagger UI at /api/docs)
  worker/     @gemerp/worker    BullMQ consumer (separate process)
packages/
  database/   @gemerp/database  Prisma schema, generated client, migrations, seed
  shared/     @gemerp/shared    Shared constants and types (permissions, roles, API contracts)
  config/     @gemerp/config    Shared tsconfig / ESLint presets
```

- Workspace-internal dependencies are declared as `"workspace:*"`.
- `packages/ui` and `packages/api-client` from the spec's suggested structure are deferred: the UI shell lives in `apps/web` until a second consumer exists, and the typed API client is generated from the OpenAPI contract when the frontend integration surface is large enough to justify it (Phase 2+). Deferring both avoids empty-package ceremony without foreclosing the split.

### `@gemerp/shared` contract

Other packages code against these exact exports:

- `PERMISSIONS` — nested const object of permission strings.
- `ALL_PERMISSIONS: string[]` — flat list of every permission.
- `ROLE_DEFINITIONS: { code; name; description; isSystem; permissions: string[] }[]` — the 7 initial roles (spec §8). `SUPER_ADMIN` receives `ALL_PERMISSIONS`.
- Types: `ApiError`, `PaginationMeta`, `Paginated<T>`, `SessionUser { id, email, displayName, isSuperAdmin, roles: string[], permissions: string[], branchIds: string[] }`.

Permission strings use dot notation `resource.action` exactly as in spec §8 (`asset.view`, `inventory.receive`, `procurement.po.create`, …), completed to a full matrix for every resource each phase needs (`user.*`, `role.*`, `branch.*`, `warehouse.*`, `employee.*`, `item.*`, `supplier.*`, `maintenance.*`, `approval.*`, `report.*`, `audit.view`, `settings.manage`, …). The permission catalog lives in code (`@gemerp/shared`), is synced into the `permissions` table by the seed/startup routine, and is exposed read-only via `GET /api/v1/permissions`.

---

## 4. Module Map (Modular Monolith)

Each module is a NestJS module with its own controllers, services, and DTOs. Business logic lives in services (testable without HTTP), never in controllers or UI.

| Module | Responsibility | Phase |
| --- | --- | --- |
| `auth` | Login/logout, session lifecycle, password change, lockout | 1 |
| `users-rbac` | Users, roles, permissions, permission overrides, branch access grants | 1 |
| `org-structure` | Branches, warehouses, storage locations | 1 |
| `audit` | Append-only audit log: write API + query endpoint | 1 |
| `employees` | Custody-only employee records (no HRIS) | 2 |
| `catalog` | Item master, categories, brands, UOM + conversions, barcodes, lookup values | 2 |
| `inventory-ledger` | Stock transactions, immutable ledger entries, balances, lots, reservations, reversals | 3 |
| `assets` | Serialized asset instances, lifecycle, custody, tags/QR tokens | 3 |
| `procurement` | Suppliers, purchase orders, goods receipts, purchase history | 4 |
| `transfers` | Location, warehouse, and inter-branch transfers with dispatch/receive flow | 3–4 |
| `counts` | Physical inventory / cycle-count sessions, variance → adjustment | 6 |
| `maintenance` | Plans, work orders, parts consumption, cost and downtime history | 5 |
| `approvals` | Configurable approval workflows, steps, requests, delegation | 6 (minimal engine earlier as needed by PO/transfers) |
| `notifications` | In-app notifications, recipient rules, dedup, read state | 6 |
| `attachments` | File metadata + MinIO object lifecycle, authorized up/download | 1 (foundation), used by all |
| `reporting` | Dashboards, operational reports, queued exports | 7 |

### Dependency direction

Dependencies flow strictly downward; no module imports a module above it.

```text
                 reporting  (reads everything, writes nothing)
                     │
  procurement  transfers  counts  maintenance          ← business workflows
        │          │        │        │
        └──────┬───┴────┬───┴────────┘
        inventory-ledger   assets                      ← core domain engines
               │             │
        catalog        employees                       ← reference data
               │             │
        org-structure ───────┘
               │
        users-rbac ── auth
               │
   ┌───────────┼───────────────┐
 audit   notifications   attachments   approvals       ← cross-cutting services
```

Rules:

- **Cross-cutting modules** (`audit`, `notifications`, `attachments`, `approvals`) expose narrow service interfaces and are injected wherever needed; they never depend on business modules. Workflow modules call *into* them (e.g., procurement asks `approvals` to open a request), never the reverse — `approvals` signals outcomes via emitted events/callbacks registered by the owning module.
- **Only `inventory-ledger` writes ledger entries and balances.** Procurement, transfers, counts, and maintenance produce stock movements exclusively by calling the ledger's posting service — never by touching ledger tables directly.
- **Only `assets` mutates asset lifecycle state.** Other modules request transitions through its service, which enforces the valid-transition table (spec §12).
- `reporting` is read-only over other modules' query services and views.
- Module boundaries are enforced by convention now and by lint rules (import-path restrictions) once the codebase is large enough to drift.

---

## 5. Ledger-Driven Stock Design

Core principle (spec §3.1, §13): **no editable authoritative quantity field.** Stock truth is an append-only ledger; balances are a projection.

### Tables

- `stock_transactions` / `stock_transaction_lines` — business documents (receipt, issue, transfer, adjustment, …) with statuses Draft → Pending Approval → Approved → **Posted** (or Rejected / Canceled / Reversed). Only Posted affects stock.
- `stock_ledger_entries` — **immutable**, append-only. One row per posted line per location effect (a transfer posts a negative entry at source and positive at destination). Carries item, branch, warehouse, storage location, lot, entered UOM + quantity, normalized base quantity, signed base delta, unit cost (permission-gated in reads), and a reference back to the posting transaction. No UPDATE or DELETE is ever issued against this table; the API exposes no mutation path for it.
- `stock_balances` — transactionally updated projection keyed by (item, branch, warehouse, storage location, lot). Holds on-hand, reserved, and in-transfer quantities. It exists purely for read performance and posting-time validation; it is always derivable by summing ledger entries, and a reconciliation job can verify projection = Σ ledger.

### Posting protocol

All posting happens inside a single Postgres transaction:

1. Load the transaction document and verify status, permissions, and branch scope.
2. `SELECT … FOR UPDATE` the affected `stock_balances` rows (creating missing rows first), in a **deterministic key order** to prevent deadlocks between concurrent postings.
3. Validate the outcome: resulting on-hand must not go below zero (negative stock is rejected unless a specifically authorized business setting permits it), lot expiry rules respected.
4. Insert `stock_ledger_entries` rows.
5. Update the locked `stock_balances` rows by the signed deltas.
6. Flip the document to Posted, stamp poster and posting timestamp, write the audit record.
7. Commit. Any failure rolls back everything — a document is never Posted with missing ledger rows, and ledger rows never exist without the balance update.

Row locks (not application-level mutexes) are the concurrency control: two simultaneous issues of the last unit serialize on the balance row, and the second fails validation. This is what makes acceptance criterion 10 ("stock cannot become negative under concurrent issue attempts") hold by construction.

**Reversal, not edit.** Posted documents are immutable. Corrections create a linked reversal transaction that posts equal-and-opposite ledger entries under the same locking protocol, flips the original to Reversed, and records who/when/why. Idempotency keys on posting endpoints prevent duplicate client submissions from double-posting.

Business document numbers (transaction numbers, PO numbers, asset tags) come from `sequence_counters` rows incremented inside the same transaction — never derived from primary keys.

---

## 6. Branch-Scoping Model

Spec §3.3 and §8: permission **and** branch scope must both pass before any read or write; frontend filtering is never authorization.

- `user_branch_access` records grant a user explicit access to specific branches. Super Admin implicitly spans all branches (`isSuperAdmin` on `SessionUser`); everyone else is limited to their granted `branchIds`, resolved once at session load into the `SessionUser` object.
- **Deny by default.** A central NestJS guard chain runs on every route: authentication guard → permission guard (route declares required permissions via decorator) → branch-scope guard. Routes without an explicit `@Public()` marker require an authenticated session; routes touching branch-scoped resources declare how the branch is derived (path param, body field, or the target record's branch).
- **Applied to direct and joined records.** List/report queries inject a `branchId IN (allowed)` predicate at the service layer through a shared query-scoping helper — not ad hoc per endpoint. Detail and mutation endpoints resolve the target record's branch (including via joins: a warehouse's branch, a storage location's warehouse's branch, an asset's current branch, a transfer's source *and* destination branches) and verify membership before acting. Inter-branch transfers require access checks on both ends appropriate to the action (dispatch needs source access, receive needs destination access).
- Postgres Row-Level Security is noted as possible defense-in-depth (spec §28) but is not part of the baseline; application-layer authorization is the mandatory and tested control.

---

## 7. Session Authentication Design

Server-side cookie sessions (spec §3.6, §7):

- **Cookie:** `gemerp_session`; HTTP-only; `SameSite=Lax`; `Secure` in production; no token contents readable by JS.
- **Token:** opaque 256-bit random value. The server stores only its **SHA-256 hash** in `user_sessions` alongside user id, expiry, IP, and user agent — a database leak does not yield usable session tokens.
- **Expiry:** 12-hour sliding window; activity extends the session, absolute revocation always possible. `GET /auth/sessions` lists a user's active sessions; `DELETE /auth/sessions/:id` revokes one.
- **Passwords:** argon2id via the `argon2` package. Passwords, tokens, and secrets are never logged.
- **Lockout:** 5 consecutive failed logins lock the account for 15 minutes. All auth events — login, logout, failure, lockout, password change/reset, session revocation — are audit-logged.
- **CSRF:** `SameSite=Lax` plus origin verification on state-changing requests; the API accepts no cross-site form posts.

Phase 1 auth API (under `/api/v1`): `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`.

---

## 8. API Conventions

- All endpoints under global prefix `/api/v1`; OpenAPI docs served at `/api/docs`.
- **Error envelope** for every API error: `{ "error": { "code": "MACHINE_CODE", "message": "human friendly", "details?": [...] } }`. Validation failures use code `VALIDATION_ERROR` with per-field details. Stack traces and raw database errors are never exposed; a global exception filter maps everything into the envelope.
- **Pagination:** query params `page` (1-based), `pageSize` (default 25, max 100), `sort`, plus resource filters. Response shape: `{ "data": [...], "meta": { "page", "pageSize", "total", "totalPages" } }`.
- Business transitions (submit, approve, post, reverse, dispatch, receive, assign, return, activate, deactivate) are explicit action endpoints, never generic record updates.
- Phase 1 surface: `auth` (above); `users` (CRUD-ish + activate/deactivate + roles + branch-access + reset-password); `roles` (+ permissions assignment) and read-only `permissions` catalog; `org` (branches → warehouses → storage locations, with activate/deactivate rather than deletion); `audit-logs` (filtered query); `health` (`GET /health` liveness, `GET /health/ready` checks Postgres; Redis/MinIO status reported but non-fatal in dev).

---

## 9. Audit Trail Design

Spec §22: append-only, immutable to ordinary users.

- `audit_logs` table: actor user id (+ employee link where applicable), action, resource type/id, branch, UTC timestamp, request correlation id, IP, user agent, old values, new values (JSONB, secrets redacted), reason/comment, related transaction or approval id.
- **Two write paths, one service:**
  1. A global interceptor captures request-level context — correlation id (generated per request and returned in responses/logs), actor, IP, user agent — and auto-audits standard mutations.
  2. Domain services make **explicit** `AuditService.record()` calls for business events where semantic meaning matters (posting, approval, assignment, reversal, lockout), passing old/new value snapshots and reason codes. Explicit calls join the surrounding database transaction so an audit row is never committed for a rolled-back action and vice versa.
- Append-only enforcement: the service exposes no update/delete; no API mutation path exists. `GET /audit-logs` (permission `audit.view`) supports filters: actor, action, resourceType, resourceId, branchId, from, to — branch-scoped like every other read.
- Sensitive fields (password hashes, session tokens) are redacted before snapshots are stored.

---

## 10. Background Jobs (BullMQ)

- `apps/worker` is a separate Node process consuming BullMQ queues on Redis; it imports the same `@gemerp/database` client and domain service packages as the API — no logic duplication, no HTTP hop.
- Queue families: scheduled scans (low-stock detection, maintenance due/overdue, warranty and lot expiry, overdue returns, unreceived transfers), notification fan-out, report/export generation, and import processing.
- Jobs are **idempotent** (deterministic job ids or dedup checks) so retries and repeat schedules cannot double-alert or double-write.
- Repeatable jobs use BullMQ's cron-style schedulers; heavy exports run as one-off jobs that notify the requesting user on completion.
- Redis unavailability degrades gracefully: the API keeps serving synchronous operations; enqueue failures are logged and surfaced, not fatal (matching the dev-mode readiness policy in §8).

---

## 11. Attachments

Spec §23: metadata in Postgres, bytes in object storage, never a public bucket.

- `attachments` table stores owner resource type/id, branch scope, file name, MIME type, size, object key, uploader, timestamps, and archival state.
- Bytes live in MinIO bucket `gemerp-attachments` under safe, unique, non-guessable object keys (UUID-based; original filenames are metadata only).
- Upload and download both pass the full guard chain — permission plus branch scope of the *owning resource*, not just the attachment row. Downloads are served either as short-lived presigned URLs or streamed through the API; either way authorization happens in the API first, and the bucket itself is never publicly reachable.
- File type and size validated on upload; removal is archival with audit history, not hard deletion.

---

## 12. Data Layer Conventions (Prisma)

- Schema at `packages/database/prisma/schema.prisma`; every schema change ships as a version-controlled migration.
- UUID primary keys: `@id @default(uuid()) @db.Uuid`.
- Table names snake_case via `@@map`; camelCase model fields mapped with `@map` where needed.
- Human-readable business numbers from `sequence_counters`, never from PKs.
- Critical records use soft deletion/archival (`isActive`, archived state); transactional records use cancel/reverse/void, never destructive deletes.
- Timezone: **store UTC**; org display timezone Asia/Manila. Default currency PHP.

---

## 13. Configuration and Environments

- **Environment validation:** zod schema parsed at process start in web, api, and worker; the process fails fast with a precise error on any missing/invalid variable. Root `.env.example` documents every variable.
- Development services (Docker Compose):
  - Postgres 16 — service `postgres`, db `gemerp`, user `gemerp`, password `gemerp_dev_password`, port 5432. `DATABASE_URL=postgresql://gemerp:gemerp_dev_password@localhost:5432/gemerp`
  - Redis 7 — port 6379, `REDIS_URL=redis://localhost:6379`
  - MinIO — API 9000, console 9001, root user `gemerp`, password `gemerp_dev_password`, bucket `gemerp-attachments`
- These credentials are development-only and must never be used outside local development.

### Seed data (dev only)

- Org **GemCor**; branches **SUB** "GemCor - Subic", **MKT** "GemCor - Makati"; 1–2 warehouses per branch with a few storage locations each.
- The 7 roles from `ROLE_DEFINITIONS`; one user per role: `superadmin@`, `branchadmin@`, `warehouse@`, `assets@`, `maintenance@`, `auditor@`, `employee@` — all `@gemcor.dev`, password `ChangeMe!123`.
- Non-superadmin users get branch access to SUB only; branchadmin additionally gets MKT.

---

## 14. Deployment Shape

- **Docker Compose** for local and production-like deployment: services `postgres`, `redis`, `minio`, plus the three apps (`web`, `api`, `worker`), each with its own Dockerfile built from the monorepo (pnpm workspace-aware, pruned per app).
- The worker is a **separate process/container** sharing `@gemerp/database` and domain packages with the API — same code, independent scaling and restart policy, one database.
- Health endpoints (`/health`, `/health/ready`) back container health checks; in production, Redis and MinIO readiness are enforced rather than advisory.
- Migrations run as an explicit deploy step (`prisma migrate deploy`) before app rollout; backup/restore and rollback procedures are documented in Phase 8 per spec §28–29.

---

## 15. Assumptions and Risks

**Assumptions** (spec left open; documented per spec preamble):

- `packages/ui` and `packages/api-client` deferred until they have a real consumer (§3).
- Presigned vs streamed attachment downloads decided per endpoint at implementation time; both remain behind API authorization (§11).
- The permission catalog is code-defined in `@gemerp/shared` and synced to the database, rather than database-authored (§3).
- Approvals ship as a general engine in Phase 6, with the minimal subset needed by earlier phases (PO approval, transfer approval) built against the same tables to avoid rework (§4).

**Risks:**

- Docker unavailable in the current WSL environment — migrations, integration tests, and E2E runs are blocked until Docker Desktop WSL integration is enabled. Mitigation: everything else (schema, code, unit tests) proceeds; verification runs as soon as Docker is available.
- Ledger/balance drift would be a severe defect; mitigated by the single posting path, transactional projection updates, and a reconciliation check job.
- Branch-scope enforcement on *joined* records is the most error-prone authorization surface; mitigated by the shared query-scoping helper and the branch-isolation test matrix required by spec §30.
