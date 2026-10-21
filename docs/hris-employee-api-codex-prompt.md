# Codex prompt — build the HRIS employee feed for GEM-ENI

Paste everything below the line into Codex, running in the **HRIS codebase**.
It is deliberately self-contained: Codex has no access to the GEM-ENI repo, so
the full contract is spelled out rather than referenced.

Companion document: `docs/hris-employee-integration-request.md` explains the
*why* and is the one to show HR or compliance if sign-off is needed.

---

You are working in the HRIS codebase. Build a **read-only employee feed** that
another internal system will consume.

Do not start writing code yet. **Phase 1 is discovery, and I need its report
before the endpoint is designed.** Work through the phases in order.

## Context

The consumer is **GEM-ENI**, our asset and inventory system. It tags every
company asset (laptops, tools, CCTV equipment, furniture) and assigns each one
to a **custodian** — an employee. Today that employee list is encoded by hand in
GEM-ENI, duplicating the HRIS and drifting from it.

GEM-ENI needs to read employees from the HRIS, which is the system of record. It
will pull on a schedule over the internal network. It will **never write back**.

GEM-ENI keeps its own separate login accounts, roles and permissions. Those are
out of scope entirely.

## Hard constraints — these are not negotiable

1. **Read-only.** The feed must not insert, update or delete any HRIS data. No
   migrations that alter existing tables. If you need to store integration
   state (an API token, a request log), use a new table and say so.
2. **Explicit field allowlist, never `SELECT *`.** Name every column you select,
   so that a future column added to the employee table cannot leak through this
   endpoint by accident. This matters more than it looks: the failure mode is
   silent.
3. **Never expose these, in any field, including inside a catch-all or
   debug payload:** credentials of any kind (passwords, hashes, tokens,
   security questions), roles or HRIS permissions, salary / pay rate / payroll /
   deductions / loans / bank or ATM details, attendance / timekeeping / leave
   balances / shift schedules, performance reviews or disciplinary records,
   government IDs (SSS, PhilHealth, Pag-IBIG, TIN), date of birth, civil status,
   dependents, home address, personal (non-work) contact numbers, emergency
   contacts, medical or HMO records.
4. **Internal network only.** Do not add any public route, reverse-proxy rule or
   firewall change that would expose this to the internet.
5. **Do not change existing HRIS behaviour.** No refactoring of existing modules,
   no changes to existing endpoints, no dependency upgrades. Add new code
   alongside what is there, following the conventions already in the codebase —
   match the existing framework, routing style, error shape, logging and test
   layout rather than introducing your own.

## Phase 1 — Discover and report (do this first, before designing anything)

Inspect the codebase and the database, then write your findings to
`docs/gemeni-feed-discovery.md`. I need **real values from the live schema**, not
assumptions, because GEM-ENI's import rules depend on them.

Run actual queries. For each item, include the query you ran and its result.

**1.1 The employee table**

Its name, and every column with type and nullability. Flag which columns are
unique or primary keys. Note any soft-delete or archive column.

**1.2 Employment status — the real values**

```sql
SELECT status, COUNT(*) FROM <employee_table> GROUP BY status ORDER BY 2 DESC;
```

Use the actual column name. I need **every** value in use, with counts —
including the edge cases (probationary, on leave, AWOL, floating,
end-of-contract, retired, resigned, terminated). If status lives in a lookup
table or an enum type, list all defined values too, not only the ones currently
in use.

GEM-ENI has exactly four states: `ACTIVE`, `INACTIVE`, `SUSPENDED`, `SEPARATED`.
**Propose a mapping** from each HRIS value to one of those four, and say which
ones you are unsure about. Do not implement the mapping — GEM-ENI maps on its
side. I just need your proposal to check it against.

**1.3 Branch / site, department and position**

For each of these three, report: the table, whether a **stable code** column
exists (not just a name), and the full current list of code + name. For
departments, say whether they are scoped per branch.

If there is no stable code column — only names, or only surrogate integer ids —
**say so plainly.** That changes the design on my side and I would rather know
now. Do not invent codes.

Also report whether a department head is recorded, and how.

**1.4 Data quality checks**

GEM-ENI enforces uniqueness on employee number and work email, so these
decide whether an import succeeds:

```sql
-- Duplicate or shared work emails
SELECT work_email, COUNT(*) FROM <employee_table>
WHERE work_email IS NOT NULL AND work_email <> ''
GROUP BY work_email HAVING COUNT(*) > 1;

-- Duplicate employee numbers
SELECT employee_number, COUNT(*) FROM <employee_table>
GROUP BY employee_number HAVING COUNT(*) > 1;

-- How many are missing the fields GEM-ENI requires
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE employee_number IS NULL OR employee_number = '') AS no_number,
  COUNT(*) FILTER (WHERE <branch_fk> IS NULL) AS no_branch,
  COUNT(*) FILTER (WHERE work_email IS NULL OR work_email = '') AS no_email
FROM <employee_table>;
```

Adjust the column names to the real schema and adapt the syntax if this is not
Postgres. Also answer: **are employee numbers ever reused or re-issued** to a
different person? Check the schema and the code, and say how you determined it.

**1.5 Change tracking**

Is there an `updated_at` / `last_modified` column on the employee table, and is
it reliably maintained (by a trigger, by the ORM, or not at all)? Does it move
when a *related* row changes — a department rename, a supervisor reassignment?

If there is no reliable change timestamp, say so; the feed will serve full
snapshots instead and that is acceptable.

**1.6 Separation and deletion**

How does the HRIS represent someone who has left — a status value, a separation
date, a soft-delete flag, or row deletion? **Are employee rows ever hard-deleted?**
If so, by what code path.

This one matters: if a record simply disappears from the feed, GEM-ENI cannot
tell "this person left" from "the export broke today", and those need very
different responses.

**1.7 Stack and conventions**

Language, framework, database, how existing endpoints are authenticated, how
config and secrets are supplied (env vars, config file, vault), and how tests
are written and run. The feed must follow these, not introduce new patterns.

**1.8 Scale**

Total employee count, and roughly how many records change per day.

**Stop here and give me the report.** If anything in Phase 2 conflicts with what
you found — a field that does not exist, a code column that is missing — flag the
conflict rather than working around it silently.

## Phase 2 — Build the endpoint

### Route

```
GET /integrations/gemeni/employees
```

Namespaced under `integrations/` so it is obvious this is not part of the HRIS
application API. If the codebase has an established convention for internal
integration routes, follow that instead and tell me what you used.

### Query parameters

| Parameter | Type | Default | Behaviour |
|---|---|---|---|
| `updatedSince` | ISO 8601 UTC timestamp | none | Return only records whose change timestamp is **greater than or equal to** this value. Omitted means a full snapshot. Reject a malformed value with 400 rather than ignoring it. |
| `page` | integer, 1-based | `1` | |
| `pageSize` | integer | `200` | Cap at `500`. A larger value is clamped, not rejected. |

If `updatedSince` cannot be supported (Phase 1.5 found no reliable timestamp),
accept the parameter and ignore it — but say so in the response `meta` as
`"incrementalSupported": false`, so GEM-ENI knows it is receiving a full
snapshot rather than silently missing changes.

### Ordering — important for correctness

Order by **change timestamp, then by the primary key** as a tiebreaker:

```sql
ORDER BY updated_at ASC, hris_id ASC
```

Not by timestamp alone. Many rows share a timestamp (a bulk update, an import),
and without a stable tiebreaker the database may return them in a different
order between page requests — which silently **drops and duplicates records**
across page boundaries. This is the single most likely way for this feed to lose
data quietly, so please do not skip it.

### Response shape

Exactly this. GEM-ENI is built against it.

```json
{
  "data": [
    {
      "hrisId": "7f3a9c1e-0b2d-4f6a-9c11-5d8e2a4b6c90",
      "employeeNumber": "GC-2024-0117",
      "firstName": "Maria",
      "middleName": "Santos",
      "lastName": "Dela Cruz",
      "displayName": "Maria Dela Cruz",
      "workEmail": "mdelacruz@gemcor.ph",
      "workPhone": "+63 2 8123 4567 loc 204",
      "branchCode": "MNL",
      "departmentCode": "ITD",
      "positionCode": "SYSAD",
      "employmentStatus": "ACTIVE",
      "dateHired": "2024-03-04",
      "dateSeparated": null,
      "supervisorEmployeeNumber": "GC-2019-0042",
      "isDepartmentHead": false,
      "updatedAt": "2026-10-20T06:12:44Z"
    }
  ],
  "meta": {
    "page": 1,
    "pageSize": 200,
    "total": 418,
    "totalPages": 3,
    "generatedAt": "2026-10-21T01:30:00Z",
    "incrementalSupported": true
  }
}
```

### Field rules

- **`hrisId`** — the HRIS primary key, as a string. This is the match key on
  every later sync, so it must be stable for a person's lifetime and never
  reused. If the real key is an integer, serialise it as a string.
- **`employmentStatus`** — send the **raw HRIS value**, unchanged. Do not map it
  to GEM-ENI's four states; GEM-ENI maps on its side using your Phase 1.2
  proposal. A raw value we do not recognise is safer than a wrong guess baked
  into the feed.
- **Absent values are `null`**, never `""`, `"N/A"`, `"-"` or `0`. GEM-ENI
  treats an empty string as a real value and will try to store it.
- **`workEmail`** — if Phase 1.4 found duplicates or shared mailboxes
  (`admin@…`, `frontdesk@…`), send `null` for those records rather than a value
  GEM-ENI must reject. List the affected employee numbers in the Phase 4 report
  so they can be cleaned up at the source.
- **`supervisorEmployeeNumber`** — the supervisor's **employee number**, not
  their internal id and not their name. `null` if none.
- **`branchCode` / `departmentCode` / `positionCode`** — the **stable codes** from
  Phase 1.3. If no code column exists, send the surrogate id as a string and say
  so in the report; do not substitute the name, and do not invent a code.
- **Include separated employees.** Do not filter them out. GEM-ENI needs to know
  about a separation in order to chase the assets that person still holds — it is
  one of the main reasons for this feed.

### Timestamps and dates — be strict here

- `updatedAt` and `generatedAt`: ISO 8601 **with an explicit UTC offset** —
  `2026-10-21T01:30:00Z`. Not a bare local-time string, and not Asia/Manila
  local time without an offset. GEM-ENI stores UTC and renders Asia/Manila; an
  ambiguous timestamp here surfaces as records appearing hours off, or as an
  incremental sync skipping a window.
- `dateHired` and `dateSeparated`: date only, `YYYY-MM-DD`, no time component
  and no timezone.
- If the HRIS stores timestamps in local time without a zone, **convert to UTC
  explicitly** in the query or serialiser, and state in the report that you did.

### Authentication

- `Authorization: Bearer <token>`.
- The token comes from configuration or an environment variable — never
  hardcoded, never committed. Follow how the codebase already supplies secrets
  (Phase 1.7).
- Compare in **constant time**, so the comparison itself cannot be used to
  recover the token a character at a time.
- Reject a missing, malformed or wrong token with **401** and a generic body.
  Do not reveal whether the token merely expired, and do not echo the supplied
  token back in the response or the logs.

### Errors

Follow the codebase's existing error shape. At minimum: 400 for a malformed
parameter, 401 for auth failure, 500 for an unexpected error — never a 200 with
an error body, because GEM-ENI's sync job treats 200 as success and would record
an empty page as "no changes today".

### Logging

Log each request with the caller, the parameters and the row count. Do not log
the response body or the bearer token.

## Phase 3 — Verify, and show me the evidence

Do not report this as done without the following. For each, include the actual
command and its output.

1. **Tests**, written in the codebase's existing style and framework:
   - pagination returns every record exactly once across pages, with **no
     duplicates and no gaps**, including when many rows share one `updated_at`
     (seed that case deliberately — it is the bug the tiebreaker sort prevents)
   - `updatedSince` filters correctly, and is inclusive at the boundary
   - `pageSize` above the cap is clamped, not rejected
   - a missing / malformed / wrong token each return 401
   - a malformed `updatedSince` returns 400
   - separated employees **are** included
   - absent optional fields serialise as `null`, not `""`
2. **The allowlist actually holds.** Add a test that fails if the response
   contains any key outside the agreed field list. This is what stops a future
   column from leaking silently, so it is worth doing properly rather than
   asserting a couple of fields.
3. **A real call against real data** — one page, with the token, output included.
   Redact personal data in what you paste back: keep the field *names* and the
   shapes, replace names and emails with placeholders. I need the structure, not
   the people.
4. **Confirm read-only.** State what the endpoint executes, and show that no
   write path is reachable from it.
5. Confirm the existing HRIS test suite still passes, unchanged.

## Phase 4 — Report back

Write `docs/gemeni-feed-handover.md` containing:

1. The exact route, and how to authenticate (how the token is configured and
   rotated — not the token itself).
2. The **final field list as built**, flagging any deviation from the contract
   above and why.
3. The **status value mapping proposal** from Phase 1.2.
4. The **full branch / department / position code lists** from Phase 1.3. GEM-ENI
   needs these to build its mapping table before the first sync, so this is a
   blocker, not a nice-to-have.
5. **Known data-quality issues** from Phase 1.4 — duplicate emails, missing
   branches, missing employee numbers — with the affected employee numbers, so
   they can be fixed at the source rather than worked around downstream.
6. Whether `updatedSince` is supported, and if so whether a related-row change
   (department rename, supervisor reassignment) moves `updatedAt`.
7. Whether employee rows are ever hard-deleted, and how a separation appears in
   the feed.
8. The recommended polling interval and any rate limit.
9. Anything you had to assume, and anything you think will break first.

## If something is ambiguous

Ask, or state the assumption prominently in the report — do not guess silently.
Specifically: do **not** invent a code column that does not exist, do **not**
map status values inside the feed, and do **not** drop separated employees to
make the payload tidier. Each of those would look fine in testing and fail only
once real asset custody depends on it.
