# Codex prompt — Phase 2 go-ahead, with decisions

Paste everything below the line into the same Codex session that produced
`docs/gemeni-feed-discovery.md`.

This answers the six blocking questions, drops the fields the HRIS cannot
honestly supply, and adds two requirements the discovery report itself
surfaced. The revised payload contract in section 3 **replaces** the one in the
original prompt.

---

Discovery accepted. It was thorough, and refusing to infer `branchCode`,
`workEmail` and `dateSeparated` was the right call — each of those would have
looked fine in testing and failed only once real asset custody depended on it.

Here are the decisions. Proceed to Phase 2 with the revised contract below.

## 1. Decisions on your six questions

### 1.1 and 1.2 — `email` and `contact_number`

**`workPhone`: dropped from the feed.** Do not expose `contact_number` at all.
GEM-ENI uses it only to chase an unreturned asset, and at 12 employees that is
not worth taking unclassified personal contact data across a system boundary.
Remove the field from the contract.

**`workEmail`: conditional, and you do not need to wait for me.** Implement it
so that the behaviour is driven by one config flag, defaulting to the safe side:

- Add a config value, for example `GEMENI_FEED_EMAIL_IS_WORK` (boolean,
  **default `false`**).
- When `false`, `workEmail` is always `null`.
- When `true`, `workEmail` is `employees.email`.

That way HR's answer becomes a config change rather than a code change, and the
default leaks nothing. GEM-ENI's work email is optional — a `null` costs us only
asset-acknowledgement emails, which is survivable.

Note in the handover that the flag exists and what it controls.

### 1.3 — No branch entity

**`branchCode`: dropped from the feed entirely.** Do not send it, do not send
`null` for it, and do not substitute the company code.

Branch is not an HR attribute in GEM-ENI. It drives asset tag numbers and
controls which users can see which assets, so it is ours to own. GEM-ENI will
assign each synced employee to a configured default branch on first import, keep
the field editable by hand afterwards, and **never overwrite it on later syncs**.
Nothing is required from the HRIS for this.

### 1.4 — Supervisor, department head, separation date

**`supervisorEmployeeNumber`: dropped.** No reporting line exists in the HRIS,
and GEM-ENI's field is optional. We lose supervisor escalation on unreturned
assets, which we accept.

**`isDepartmentHead`: dropped.** GEM-ENI routes some approvals to a department
head and will keep setting that by hand. Approval routing should not change
because an HR record changed.

**`dateSeparated`: dropped for now, and please do not derive it from
`archived_at`** — you are right that an administrative archive is not a confirmed
separation.

Two things instead:

1. **GEM-ENI will infer it.** When the feed first reports `RESIGNED` or
   `TERMINATED` for someone previously active, GEM-ENI records the date it
   observed the change and marks it as inferred, so the asset-clearance workflow
   still fires. Nothing needed from you.
2. **A suggestion, not a request:** a real `separation_date` column belongs in
   the HRIS regardless of this integration — HR will want it for tenure and
   turnover reporting, and today that date is not recorded anywhere. If you add
   it later, expose it here and GEM-ENI will prefer it over the inferred date.
   Do not add it as part of this task; the hard constraint against altering
   existing tables stands.

### 1.5 — Route

**Follow the HRIS convention:** `/api/v1/integrations/gemeni/employees`. Do not
special-case the global prefix.

### 1.6 — Incremental vs. full snapshot

**Full snapshot. Drop `updatedSince` from Phase 2.**

Twelve rows, no database-level change capture, and a direct SQL update can
bypass `updated_at` entirely. Incremental sync would buy nothing measurable and
would introduce a silent-drift failure mode that is genuinely hard to detect.
GEM-ENI will pull the whole list and reconcile.

Accordingly:

- Remove the `updatedSince` parameter. Reject it with 400 if supplied, rather
  than accepting and ignoring it — an ignored filter is how a consumer ends up
  believing it has incremental sync when it does not.
- `meta.snapshot` is always `true`. Keep the field; it is what tells GEM-ENI the
  response is a complete list and that anything absent from it is genuinely gone.
- **Keep the pagination and the `ORDER BY updated_at, id` tiebreaker anyway.**
  Cheap now, and it means the feed still behaves when the company grows past one
  page.
- Keep `updatedAt` as a per-record field. Useful for display and for diagnosing
  "why did this record change".

## 2. Two requirements your report surfaced

### 2.1 Filter by company — mandatory, and please do not skip this

Your report shows employee numbers are unique only on
`(company_id, employee_number)`, and that `companies` is a real multi-tenant
table with one row today.

GEM-ENI enforces a **global** unique constraint on employee number. So if a
second company is ever added to the HRIS, this feed would both pull in people
who are not ours and collide on employee numbers — and the symptom would appear
in GEM-ENI, far from the cause.

Therefore:

- The feed must filter to a **single company, supplied by configuration** (for
  example `GEMENI_FEED_COMPANY_CODE`, set to `GEM`), not hardcoded and not
  "whatever company exists".
- If the configured company code does not resolve to exactly one row, **fail
  on startup** with a clear message rather than serving an empty or mixed list.
- Return the resolved code as `meta.companyCode`. GEM-ENI will assert it on every
  sync and refuse the payload if it is not the expected one.
- Add a test proving a second company's employees are excluded. Insert a second
  company and an employee under it in the test fixture — this is exactly the case
  that will not exist in production until the day it does.

### 2.2 Expose `archivedAt`

Your report notes that archiving forces `status = 'INACTIVE'`, which means
GEM-ENI cannot distinguish "inactive" from "archived" by status alone — and they
are different situations for someone holding a company laptop.

Add `archivedAt` to the payload: the raw timestamp, or `null`. It is a lifecycle
timestamp, not personal data, so it is within scope.

GEM-ENI will treat `INACTIVE` + non-null `archivedAt` as "probably gone, needs a
human to confirm" and raise it for review rather than guessing.

**Confirm you include archived rows.** Your report correctly spotted that the
existing list and CSV export filter `archived_at IS NULL`. The feed must not
apply that filter. If an archived employee silently vanished from the feed,
GEM-ENI would read it as "this person no longer exists" while their assets are
still out.

## 3. Revised payload contract

This replaces the contract in the original prompt. Field order is not
significant; the key set is.

```json
{
  "data": [
    {
      "hrisId": "7f3a9c1e-0b2d-4f6a-9c11-5d8e2a4b6c90",
      "employeeNumber": "GC-2024-0117",
      "firstName": "Maria",
      "middleName": "Santos",
      "lastName": "Dela Cruz",
      "workEmail": null,
      "departmentCode": "ADMIN",
      "positionCode": "ITO",
      "employmentStatus": "ACTIVE",
      "dateHired": "2024-03-04",
      "archivedAt": null,
      "updatedAt": "2026-10-20T06:12:44Z"
    }
  ],
  "meta": {
    "companyCode": "GEM",
    "snapshot": true,
    "page": 1,
    "pageSize": 200,
    "total": 12,
    "totalPages": 1,
    "generatedAt": "2026-10-21T01:30:00Z"
  }
}
```

**Exactly twelve record keys**, as the JSON above lists them. Nothing else, including nothing from
`attendance_records`, `employee_benefits`, `employee_compensations`,
`employee_identifiers`, `employee_work_schedules` or `payroll_items` — your
foreign-key query shows all six are one join away from this table, which is
precisely why the allowlist test in Phase 3 matters.

Also absent on purpose, because your schema has no column for them:
`displayName` (GEM-ENI builds it from first and last name), `branchCode`,
`workPhone`, `supervisorEmployeeNumber`, `isDepartmentHead`, `dateSeparated`.

**Never expose**, although they sit on the same row: `birth_date`, `address`,
`contact_number`, `remarks`, `employment_type_id`, `company_id`, `version`.

Unchanged from the original prompt: raw `employmentStatus` values (GEM-ENI owns
the mapping), `null` rather than `""`, dates as `YYYY-MM-DD`, timestamps as
ISO 8601 with an explicit `Z` via `.toISOString()` and never a bare database
timestamp, bearer token from config compared in constant time, 401 on auth
failure, the existing `{ error: { code, message } }` error shape, and never a
200 with an error body.

## 4. Status mapping — accepted, for the record

GEM-ENI will apply this. You do not implement it; it is here so the handover
records what the consumer does with your raw values.

| Raw HRIS | GEM-ENI | Note |
|---|---|---|
| `ACTIVE` | `ACTIVE` | |
| `INACTIVE` | `INACTIVE` | Flagged for review when `archivedAt` is set |
| `RESIGNED` | `SEPARATED` | Triggers asset clearance |
| `TERMINATED` | `SEPARATED` | Triggers asset clearance |
| anything unrecognised | `INACTIVE` | Flagged, never guessed |

GEM-ENI's `SUSPENDED` has no HRIS source and stays available for manual use.

Noted and accepted: `employee_number` is mutable via `PATCH /employees/:id`, so
GEM-ENI matches on `hrisId` and treats a changed employee number as an update to
an existing person, not a new one. Your conclusion there was correct.

## 5. Phase 3 and 4 still apply

The verification and handover requirements from the original prompt stand, with
these adjustments:

- Drop the `updatedSince` filtering tests; add one proving a supplied
  `updatedSince` returns **400**.
- Add the second-company exclusion test from section 2.1.
- Add a test that archived employees **are** included.
- The allowlist test should assert the exact twelve-key set, not a subset.
- In the handover, drop the branch / department-head / separation-date items —
  they are resolved above. Keep the department and position code lists; GEM-ENI
  needs them to build its mapping table before the first sync.
- Add to the handover: the names of the two new config values
  (`GEMENI_FEED_COMPANY_CODE`, `GEMENI_FEED_EMAIL_IS_WORK`), their defaults, and
  how the bearer token is rotated.

One thing worth saying plainly: your discovery changed our design on three
points rather than just filling in blanks. That is what it was for. If Phase 2
turns up something that makes any of the above wrong, say so rather than
building to a contract you can see is mistaken.
