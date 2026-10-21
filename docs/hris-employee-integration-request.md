# Employee Data Integration — Request to the HRIS Team

**From:** GEM-ENI (Asset & Inventory Management System), GEM Investment Corp.
**To:** HRIS team / vendor
**Status:** Request for discussion — nothing is built on our side yet.

---

## 1. What we need, in one paragraph

GEM-ENI is our asset and inventory system. Every company asset — laptops, tools,
furniture, CCTV equipment — is tagged and assigned to a **custodian**, who is an
employee. Right now we maintain that employee list by hand inside GEM-ENI, which
means the same person is encoded twice and the two lists drift apart.

We would like to stop maintaining employees in GEM-ENI and instead **read them
from the HRIS**, which is already the system of record. We need **read-only**
access to a **limited set of employee fields** — enough to identify a person,
know which branch and department they belong to, and know whether they are still
employed.

**We are not asking to write anything back to the HRIS.**

---

## 2. Scope

### In scope

- Employee master records — identity, assignment (branch / department / position),
  employment status and dates.

### Explicitly out of scope — please do not include these

We do not want this data, and would prefer the integration be built so that it
cannot reach us:

- Login accounts, usernames, passwords, password hashes, security questions
- Roles, permissions or any HRIS access rights
- Salary, pay rate, payroll, deductions, loans, bank or ATM details
- Attendance, timekeeping, leave balances, overtime, shift schedules
- Performance reviews, disciplinary records, case files
- Government IDs — SSS, PhilHealth, Pag-IBIG, TIN
- Date of birth, civil status, dependents, home address, personal contact
  numbers, emergency contacts
- Medical or HMO records

GEM-ENI keeps its own separate login accounts and permissions. Those stay with
us and are not part of this request.

---

## 3. How we would like to receive the data

In order of preference. Any one of these works — we are flexible, and option 3
is a perfectly acceptable starting point if it is faster for you.

### Option 1 — Read-only REST endpoint (preferred)

One endpoint we can call, returning JSON:

```
GET /api/employees?updatedSince=2026-10-01T00:00:00Z&page=1&pageSize=200
```

This is our preference because it lets us pull changes on a schedule without
anyone exporting anything by hand.

### Option 2 — Read-only database view

A dedicated view (for example `vw_gemeni_employees`) exposing only the columns
in section 4, plus a read-only database user that can see nothing else. We
connect directly on the internal network.

We prefer a **view** over direct table access so that you keep control of what
we can see, and so that internal schema changes do not break us.

### Option 3 — Scheduled file drop

A CSV or JSON file written nightly to an agreed folder or SFTP path, containing
the full current employee list. Simple and robust; the trade-off is that changes
reach us the next day rather than within the hour.

---

## 4. Fields requested

**Legend:** **Required** = GEM-ENI cannot create the record without it.
*Optional* = we will use it if available, and leave the field blank if not.

| # | Field | Type | Need | Why we need it |
|---|---|---|---|---|
| 1 | `hris_id` | string / int | **Required** | The HRIS primary key. This is how we match a record on every later sync, so it must never change for a given person and never be reused. |
| 2 | `employee_number` | string | **Required** | The human-readable ID. Shown on asset acknowledgement forms and custody reports that employees sign. Must be unique. |
| 3 | `first_name` | string | **Required** | Identifying the custodian. |
| 4 | `last_name` | string | **Required** | Identifying the custodian. |
| 5 | `middle_name` | string | *Optional* | Used on printed acknowledgement forms. |
| 6 | `display_name` / preferred name | string | *Optional* | If your system holds a preferred or nickname form, we show it in dropdowns. Otherwise we build it from first + last name. |
| 7 | `work_email` | string | *Optional* | For asset acknowledgement notices. **Must be unique or empty** — see section 6.4. Please send work email only, never personal email. |
| 8 | `work_phone` / local / extension | string | *Optional* | So whoever is chasing an asset can reach the custodian. Work number only. |
| 9 | `branch_code` | string | **Required** | Which site or office the employee belongs to. GEM-ENI scopes who can see which assets by branch, so we cannot place an employee without it. See section 5. |
| 10 | `department_code` | string | *Optional, strongly preferred* | Used for department-level asset reporting and for routing approvals. See section 5. |
| 11 | `position_code` / job title | string | *Optional, strongly preferred* | Some approval rules are defined by position rather than by named person. See section 5. |
| 12 | `employment_status` | string | **Required** | Whether the person is still employed. Drives whether they can be given new assets. See section 6.3 for the values we need. |
| 13 | `date_hired` | date | *Optional* | Reference only, shown on the employee record. |
| 14 | `date_separated` | date | **Required when separated** | This is what triggers asset clearance on our side. Without it we cannot tell when to chase a returning employee's assets. |
| 15 | `supervisor_employee_number` | string | *Optional* | We escalate unreturned assets to the supervisor. Please send the supervisor's **employee number**, not their HRIS internal id or name. |
| 16 | `updated_at` | timestamp | **Required** | So we can pull only what changed instead of the whole list every time. See section 6.2. |

### Two optional extras, if easy for you

| Field | Why |
|---|---|
| `is_department_head` or a department → head mapping | GEM-ENI can route approvals to a department head. Today we set that by hand. |
| `photo_url` | Nice for the UI, not needed. **Skip this if it means copying image files to us** — not worth the privacy exposure. |

---

## 5. Reference data we need to map (please read — this is the usual sticking point)

GEM-ENI already has its own **branches**, **departments** and **positions**, and
they are wired into things the HRIS knows nothing about: asset tag numbers
contain the branch code, and approval rules point at specific departments and
positions.

So we cannot simply replace our lists with yours. We need to **map** them.

What we are asking for is a one-time list, which we will sit down with you to
match against ours:

1. **Branches / sites** — code, name, and whether active.
2. **Departments** — code, name, and which branch each belongs to (if your
   departments are per-branch).
3. **Positions / job titles** — code and name.

Two requests about these codes:

- **Please send codes, not just names.** Names get edited ("IT" → "I.T. Dept." →
  "Information Technology") and every rename would look to us like a brand-new
  department. A stable code does not have that problem.
- **Please tell us when a code is added, renamed or retired.** If the HRIS starts
  sending a branch code we have never seen, we cannot guess where to file that
  employee, and the sync for that person will stop until someone maps it.

If your codes are not stable, say so now and we will hold the mapping on our
side instead — it just means a little manual upkeep for us.

---

## 6. Behaviour we depend on

These are the few behavioural guarantees that decide whether the integration is
reliable or a recurring source of bad data. Please confirm each one, or tell us
which you cannot meet so we can design around it.

### 6.1 Never hard-delete, and never reuse an identifier

If a record simply disappears from the feed, we cannot tell "this person left the
company" apart from "the export broke today". Those need very different
responses from us.

Please instead keep the record and mark it — separated, inactive, archived,
whatever your system uses. If a record really must be removed, an explicit
deleted flag or a separate list of removed ids works just as well.

Likewise, please never reuse an `employee_number` or `hris_id` for a different
person. We attach asset custody history to these, and a reused number would
silently attribute one person's assets to another.

### 6.2 An `updated_at` we can filter on

So we can ask "what changed since my last successful sync" instead of pulling
everything. If this is not available, we will pull the full list nightly — which
works, just less efficiently.

If `updated_at` **also** moves when a related row changes (department renamed,
supervisor reassigned), please tell us, because that is actually helpful.

### 6.3 Status values, spelled out

GEM-ENI has exactly four states: **ACTIVE**, **INACTIVE**, **SUSPENDED**,
**SEPARATED**.

Please send us the **full list of HRIS status values** you actually use —
including the ones you consider edge cases (probationary, on leave, AWOL,
floating, end-of-contract, retired, resigned, terminated). We will map each one
to our four, and we would rather do that mapping once, with you, than guess.

A status we do not recognise will be treated as INACTIVE and flagged for review,
rather than guessed at.

### 6.4 Work email must be unique or empty

GEM-ENI enforces a unique work email. If two employees share one, or a shared
mailbox (`admin@…`, `frontdesk@…`) is stored as a person's work email, that
record will be rejected on import.

If shared or duplicate emails exist in the HRIS today, it is cleaner to **send
the field empty** for those people than to send a value we cannot accept.

### 6.5 Pagination and a sane page size

If you are building the endpoint in option 1, please page the results (we
suggest 200 per page) and include the total count. We expect a few hundred
employees, so this is about keeping the call predictable rather than about
volume.

### 6.6 A note on timing, not a requirement

Nightly is fine. We do not need real-time. The one case where sooner is better
is a **separation** — the faster we know, the faster we can chase the laptop
before the person's last day. If there is an easy way to push or flag
separations promptly, we are interested; if not, nightly is genuinely fine.

---

## 7. Access and security

Whatever option we land on, we would like:

- **Internal network only.** GEM-ENI runs on our own on-premise Linux server.
  Nothing needs to be exposed to the internet.
- **Its own credential.** A dedicated API key, token or database user for
  GEM-ENI — not a shared or personal account — so it can be rotated or revoked
  without affecting anyone else.
- **Read-only, least privilege.** The credential should be able to read the
  fields in section 4 and nothing else.
- **A contact and a heads-up on changes.** One person we can reach when the sync
  breaks, and advance notice before the schema or endpoint changes.

On our side: the data lands in GEM-ENI's own Postgres database on the on-premise
server, is used only for asset custody, and is visible only to users who already
have permission to view employees.

---

## 8. Data privacy

The fields in section 4 are deliberately the minimum we can run on, and section
2 lists what we have asked you *not* to send. Under the Data Privacy Act we both
benefit from keeping it that way — the less personal data crosses between
systems, the smaller the exposure for everyone.

If our HR or compliance side needs to sign off on this transfer, we are happy to
route it through them before anything is built. Please tell us if you need that
in writing.

---

## 9. Questions we need answered before we build

1. Which delivery option in section 3 do you prefer?
2. What is the HRIS product and version, and what database does it run on?
3. Can you give us a **sample payload or export** — even 3–5 fake records — with
   the real field names and real status values? This is the single most useful
   thing you can send us, and it tells us more than any amount of discussion.
4. Do stable **codes** exist for branch, department and position (section 5)?
5. What is the complete list of employment status values (section 6.3)?
6. Are there any duplicate or shared `work_email` values today (section 6.4)?
7. Are employee numbers ever reused or re-issued (section 6.1)?
8. Who is our technical contact, and who approves this access?
9. Roughly how many employee records are we talking about?

---

## 10. For reference: what we build on our side

So the boundary is clear, and so nobody waits on anybody unnecessarily.

- A scheduled sync job inside GEM-ENI that pulls from whichever source we agree
  on and matches records by `hris_id`.
- A mapping table from HRIS branch / department / position codes to ours.
- Employee records become **read-only** in the GEM-ENI interface, with the HRIS
  named as the source of record. Our "Add employee" screen is removed.
- A sync report showing what was created, updated, skipped and why — so an
  unmapped department or a rejected email is visible rather than silent.
- Existing GEM-ENI employees are matched to HRIS records by employee number, and
  anything that does not match is listed for a person to resolve. Nothing is
  deleted automatically.

### One thing we will not do automatically

If the HRIS tells us an employee has separated but GEM-ENI still shows assets in
that person's custody, we will **mark them separated and raise a clearance item**
— we will not remove the employee record.

That record is what ties the missing laptop to a name. Deleting it to match the
HRIS would erase the accountability trail precisely when we need it most. So
separated employees stay visible in GEM-ENI until their assets are returned or
written off.

---

**Prepared by:** GEM-ENI technical team
**Document:** `docs/hris-employee-integration-request.md`
