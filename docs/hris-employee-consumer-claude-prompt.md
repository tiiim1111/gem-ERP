# Claude prompt — implement and deploy the GEM-ENI HRIS employee consumer

Paste this entire document into the Claude session working on the GEM-ENI repository.

---

Proceed with the GEM-ENI consumer side of the HRIS employee integration. Implement it completely, verify it, push it to GitHub, and deploy it to the existing GEM-ENI production VM.

You are authorized to:

- modify the GEM-ENI source code;
- create and apply forward-only Prisma migrations;
- add tests, permissions, UI, operations documentation, and environment settings;
- commit and push the completed changes to the repository's current `main` branch;
- take a production backup and deploy through the existing `/opt/gemeni` Docker Compose deployment;
- update the protected production environment file without printing or committing secrets;
- run a dry-run reconciliation and, only when its safety conditions pass, enable the scheduled sync and perform the first real sync.

Do not merely produce a plan. Inspect the actual repository and production environment, implement the integration according to the existing architecture, and carry the work through production verification. Preserve unrelated user changes and do not replace the current stack.

## 1. Authoritative local references

Read these files completely before changing code:

- `docs/hris-employee-api-phase2-decisions.md`
- `docs/hris-employee-integration-request.md`
- `docs/deploy-on-premise.md`
- `docs/architecture.md`
- `docs/erd.md`
- `packages/database/prisma/schema.prisma`
- the existing employee, department, position, asset-custody, notification, audit, permissions, environment, worker, and production deployment implementations

When an older request conflicts with the Phase 2 decisions or with this prompt, the Phase 2 decisions and this prompt win.

Use the established stack and conventions:

- pnpm/Turborepo monorepo
- NestJS API
- Prisma/PostgreSQL
- BullMQ worker and Redis
- Next.js frontend
- existing RBAC, branch scope, audit, notification, error-envelope, and Docker Compose patterns

## 2. HRIS producer is live

The read-only HRIS feed is already deployed on the private LAN.

```text
HRIS URL:       http://192.168.0.60
SSH target:     gem-hris@192.168.0.60
Endpoint:       GET /api/v1/integrations/gemeni/employees
Authentication: Authorization: Bearer <shared token>
Company:        GEM
Snapshot mode:  full snapshot, paginated
Page size:      default 200, maximum 500
HRIS revision:  1f2a8d43be8e
```

Production verification on October 21, 2026 returned:

- HTTP `200` with valid authentication;
- 12 employee records;
- `meta.companyCode = "GEM"`;
- `meta.snapshot = true`;
- one page at page size 200;
- all `workEmail` values `null` because the safe HRIS flag is enabled;
- HTTP `401` without a token;
- HTTP `400` when `updatedSince` is supplied.

The bearer token is intentionally absent from this document and from Git. The authoritative secret exists only as `GEMENI_FEED_TOKEN` in `/opt/gemhris/.env.production` on the HRIS VM. Retrieve it through the existing SSH access without displaying it, save it only in a mode-`600` temporary file, install the same value as the GEM-ENI consumer secret, and securely remove the temporary file. Never put the token in a shell argument, terminal report, application log, source file, migration, database row, test fixture, chat response, or commit. Do not rotate the HRIS token as part of this task.

## 3. Exact producer contract

Call every page of:

```http
GET http://192.168.0.60/api/v1/integrations/gemeni/employees?page=1&pageSize=200
Authorization: Bearer ${GEMENI_HRIS_TOKEN}
```

Validate the response before reconciling any row:

- `meta.companyCode` must equal the configured expected code `GEM`;
- `meta.snapshot` must be exactly `true`;
- page number, page size, total, and total pages must be internally consistent;
- every advertised page must be fetched successfully;
- combined record count must equal `meta.total`;
- duplicate `hrisId` values must reject the run;
- duplicate employee numbers must reject or safely quarantine the run;
- malformed dates, timestamps, statuses, codes, or record shapes must never be partially accepted;
- the exact employee record allowlist is:

```text
hrisId
employeeNumber
firstName
middleName
lastName
workEmail
departmentCode
positionCode
employmentStatus
dateHired
archivedAt
updatedAt
```

There are **12 record keys**. An old sentence in the Phase 2 document says eleven, but its JSON contract and enumerated fields contain the 12 keys above. The JSON contract and this list are authoritative.

The feed intentionally does not contain branch, phone, supervisor, department head, separation date, display name, payroll, attendance, benefits, identifiers, compensation, schedules, login accounts, or permissions. Do not attempt to obtain those fields from another HRIS endpoint or database connection.

## 4. Reconciliation ownership and safety

### Durable identity and initial linking

- Treat `hrisId` as the permanent integration identity.
- Employee number is mutable. Once linked, a changed employee number updates the same GEM-ENI employee rather than creating another employee.
- During initial reconciliation only, an unlinked GEM-ENI employee may be proposed for linking through one exact employee-number match.
- Never link automatically by name, email, position, or department.
- Ambiguous or conflicting matches must be skipped and listed for manual resolution.
- Provide a zero-write dry run that uses the same validation and decision path as a real run.

### HRIS-owned fields

For an HRIS-linked employee, sync only:

- employee number;
- first, middle, and last name;
- work email when non-null and unique;
- mapped department;
- mapped position;
- employment status;
- date hired.

Display the record source as HRIS and make HRIS-owned fields read-only in GEM-ENI. Server-side enforcement is mandatory; disabled form fields alone are insufficient.

### GEM-ENI-owned fields

Never overwrite these during initial or later syncs:

- branch;
- supervisor;
- department-head assignment;
- linked login/user account;
- asset custody, acknowledgments, movements, issuances, and history;
- notes, photo, and other GEM-ENI-only fields.

### Branch assignment

HRIS has no branch field. New employees receive one explicitly configured default GEM-ENI branch on first import. Later syncs must never change it.

Inspect production before enabling sync:

- if exactly one active branch exists, it may be explicitly configured as the default and the assumption must be recorded in the deployment report;
- if zero or multiple active branches exist, do not guess. Deploy with synchronization disabled and report the required branch decision;
- an invalid, inactive, or missing configured default branch must skip new employees with visible errors rather than creating incomplete records.

### Department and position mappings

Create explicit HRIS-code-to-GEM-ENI mappings. Exact-code suggestions are acceptable, but mappings must be persisted and reviewable. Do not silently create organizational data and do not guess unmatched codes.

Current HRIS production codes are:

Departments:

```text
ADMIN  Administration
FIN    Finance
OPS    Operations
SALES  Sales & Marketing
```

Positions:

```text
ACCOUNTANT  Accountant
HR-OFFICER  HR Officer
ITO         IT Officer
ITS         IT Support
OPS-SUP     Operations Supervisor
SALES-EXEC  Sales Executive
```

An unmapped or inactive code skips only the affected record, records a clear row error, and causes the run to finish with a review-required outcome rather than silently dropping the issue.

### Status mapping

Apply this mapping in GEM-ENI:

| HRIS value | GEM-ENI value | Required handling |
|---|---|---|
| `ACTIVE` | `ACTIVE` | Normal active employee |
| `INACTIVE` | `INACTIVE` | Flag for review when `archivedAt` is non-null |
| `RESIGNED` | `SEPARATED` | Trigger asset-clearance review |
| `TERMINATED` | `SEPARATED` | Trigger asset-clearance review |
| unknown | `INACTIVE` | Never guess; flag prominently for review |

The HRIS does not supply a separation date. When `RESIGNED` or `TERMINATED` is first observed for a previously non-separated employee, record the observation date as an inferred separation date and retain metadata showing it is inferred. Never derive it from `archivedAt`.

An employee with assigned assets must remain present after separation. Mark the employee separated and raise an asset-clearance/review notification; never delete the employee or custody history and never auto-return an asset.

### Full-snapshot absence

Archived and separated employees are included in the producer feed. If a previously linked employee is missing from a later complete snapshot, record a high-visibility anomaly. Do not automatically delete, archive, separate, or deactivate that employee.

### Email handling

`workEmail` is optional and currently always `null`. Preserve `null`; do not substitute personal or fabricated addresses. If exposure is enabled later, validate uniqueness across the incoming snapshot and existing GEM-ENI data. Conflicting email values must be nulled or skipped according to the safest existing employee invariant and reported explicitly; never overwrite another employee's email.

## 5. Required integration capabilities

Use schema design that fits the current Prisma model, but deliver these outcomes:

- durable unique HRIS linkage and source metadata;
- timestamps for last successful synchronization and the producer's `updatedAt`;
- explicit department and position mapping storage;
- configured default branch reference;
- sync-run history with start/end time, trigger, dry-run flag, outcome, producer metadata, and counts for created, linked, updated, unchanged, skipped, and failed rows;
- bounded row-level error/review details without secrets or excessive personal data;
- idempotent full-snapshot reconciliation;
- transaction boundaries that prevent half-applied employee updates;
- a distributed/advisory lock so manual and scheduled runs cannot overlap;
- finite network connection/read timeouts and safe retry/backoff for transient failures;
- a nightly BullMQ schedule using existing worker conventions;
- an administrator-only Run Now and Dry Run action;
- a practical administration UI for connection status, last successful run, run history, mappings, default branch, dry-run preview, row issues, and Run Now;
- audit/system provenance for configuration changes and runs, consistent with the existing audit model;
- notifications to super administrators for failed runs, unknown statuses, missing snapshot employees, archived inactive employees, inferred separations with outstanding assets, conflicts, and unmapped codes.

Add a narrowly scoped permission for integration management using the existing permission catalog and production-safe seed/update process. Ordinary employee viewers may see the HRIS source badge and permitted employee information but may not view integration configuration, secrets, or detailed operational errors.

Once production synchronization is safely enabled, hide or disable Add Employee in the normal UI and prohibit normal API creation of HRIS-sourced employees. Preserve existing unlinked/manual records until reconciliation resolves them; never bulk-delete them.

## 6. Configuration

Add documented, validated settings to the appropriate environment schemas, `.env` examples, worker/API containers, and production Compose file. Use names consistent with these unless the repository already has a stronger convention:

```dotenv
GEMENI_HRIS_SYNC_ENABLED=false
GEMENI_HRIS_BASE_URL=http://192.168.0.60
GEMENI_HRIS_EMPLOYEE_PATH=/api/v1/integrations/gemeni/employees
GEMENI_HRIS_EXPECTED_COMPANY_CODE=GEM
GEMENI_HRIS_TOKEN=<protected shared secret; never commit or print>
GEMENI_HRIS_DEFAULT_BRANCH_CODE=<explicit existing GEM-ENI branch code>
GEMENI_HRIS_SYNC_CRON=0 2 * * *
GEMENI_HRIS_SYNC_TIMEZONE=Asia/Manila
```

Keep synchronization disabled through deployment until the dry-run, mappings, default branch, and conflict review pass. The browser must never receive the producer URL token or make calls directly to HRIS; all calls are server-side.

## 7. Tests and verification

At minimum, cover:

- exact payload allowlist and schema rejection;
- full pagination and count consistency;
- company-code and snapshot rejection;
- malformed response, timeout, network failure, `401`, and upstream `5xx` handling;
- duplicate `hrisId`, employee number, and work email cases;
- exact employee-number initial match and ambiguous-match rejection;
- `hrisId`-based update after employee-number changes;
- every status mapping and unknown-status review;
- inferred separation and outstanding-asset notification;
- archived inactive review;
- missing employee in a full snapshot;
- department and position mapping failures;
- default branch applied only at creation and never overwritten later;
- supervisor, head, login link, notes, branch, and custody fields never overwritten;
- idempotent repeated snapshots;
- dry run performs zero database writes;
- overlapping-run lock;
- transaction rollback on a write failure;
- authorization for integration administration;
- token and Authorization header absent from logs, API responses, audit metadata, and error reports;
- UI read-only enforcement for HRIS-owned fields.

Run the repository's complete acceptance suite, not just new tests:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
docker compose -f docker-compose.prod.yml --env-file .env.prod config
```

Adjust only the Compose validation command if the repository's actual production filenames differ.

## 8. Production deployment procedure

Before production mutation:

1. Confirm the local and production working trees and preserve unrelated changes.
2. Record the currently deployed commit, image revisions, and container health.
3. Run the existing GEM-ENI backup script and verify the backup is non-empty.
4. Confirm the production VM can reach `192.168.0.60` on port 80.
5. Retrieve the shared token securely from the HRIS VM without displaying it.
6. Install it only in the protected GEM-ENI production environment file with mode `600`.
7. Do not run the development seed in production.

Then:

1. Commit and push only the intended integration changes.
2. Deploy using `/opt/gemeni/scripts/update-gemeni.sh` and the existing runbook.
3. Confirm migrations succeed and all production containers are healthy.
4. Keep `GEMENI_HRIS_SYNC_ENABLED=false` for the first startup.
5. Run a redacted authenticated connectivity test and a zero-write dry run.
6. Review existing-employee matches, mappings, default branch, conflicts, skipped rows, and snapshot totals.
7. Enable the sync and perform the first real run only if:
   - expected company and snapshot validation pass;
   - all 12 producer records are accounted for;
   - there are no ambiguous employee links;
   - a valid explicit default branch is configured;
   - required department/position mappings are resolved;
   - no unsafe uniqueness or custody conflict exists.
8. If any condition fails, leave synchronization disabled, keep production healthy, and report the exact manual decisions needed. Do not force the import.
9. After a successful real run, verify totals, source badges, read-only enforcement, statuses, mappings, audit/sync history, notifications, and asset-custody preservation.
10. Verify the nightly scheduler exists exactly once and does not fire duplicate jobs after restarts.

## 9. Final report

Finish with a concise evidence-backed report containing:

- implementation summary;
- commit hash and pushed branch;
- migration names;
- test/lint/typecheck/build results;
- production backup path;
- previous and deployed production revisions;
- container and smoke-test status;
- redacted producer connectivity result;
- dry-run and first-sync counts;
- selected default branch and every department/position mapping;
- unresolved conflicts or review items;
- whether scheduled synchronization is enabled;
- exact application rollback command and any migration/data rollback caveat.

Never include the bearer token, employee names, email addresses, or other personal data in the report.
