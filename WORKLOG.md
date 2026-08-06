# GEM ERP — Work Log

Running change log for the GEM Cor Asset & Inventory Management system.
Every working session appends an entry here: what was done, what was decided, what is pending.
This file is the source of truth for project context — read it first before continuing work.

Spec: [asset-inventory-system-codex-master-prompt.md](./asset-inventory-system-codex-master-prompt.md) (authoritative product + engineering spec).

Entry format:

```
## YYYY-MM-DD — <short title>
**Done:** what was actually completed and verified
**Decisions:** choices made + why (assumptions the spec left open)
**Pending / Next:** what remains, known risks
```

---

## 2026-08-06 — ✅ Phase 3.5 deferrals complete (attachments, search, versions, XLSX, batch labels)

Both agents died on session limits mid-build (resumed via SendMessage, context intact). **Local commit only — no push/deploy per Tim.**

**Done (backend — verified: api build ✅, 30 suites / 392 tests ✅ (+26), typecheck api/shared/worker ✅, lint ✅, migrate status clean):**
- **Attachments §4.6** (`apps/api/src/attachments/`): multipart POST (20 MB cap, extension+MIME whitelist, sha256, UUID storage keys), list by parent, streamed download (bucket never public), soft archive. Polymorphic parents registry (10 resource types matching audit vocabulary); every op re-authorizes vs parent (any-of view/update perms + branch scope, out-of-scope = 404 no-leak). S3 via @aws-sdk/client-s3; **S3_ENABLED=false → 503 SERVICE_DISABLED envelope, unreachable → 503 STORAGE_UNAVAILABLE — never crashes** (Railway-safe). No schema change (attachments table existed since init).
- **Global search §4.7** (`apps/api/src/search/`): `GET /search?q=` across 9 entity types (assets/items/employees/suppliers/POs/GRs/WOs/transfers/stock txns), branch-scoped + per-type permission filtering (unviewable types never queried; WO technician scoping honored), bounded per type (5 default/20 max).
- **assets.version**: additive migration `20260805090000_phase35_assets_version`; PATCH matches {id, version} atomically → 409 VERSION_CONFLICT; all 13 lifecycle transitions increment version. Replaces updatedAt-derived token; web client unaffected (round-trips version opaquely).
- **inventory.approve** added to `packages/shared/src/permissions.ts` (auto-grants SUPER_ADMIN + BRANCH_ADMIN); stock-transactions approve/reject routes now use it (approval.act workaround removed); web status-maps already tolerant.
- **XLSX imports**: `xlsx.ts` (exceljs) — first sheet, dates→YYYY-MM-DD, formulas by result; format detect by extension/MIME; shared row/header validation with CSV; upload cap 2→4 MiB. Templates stay CSV.
- New specs: attachments (13), search (6), xlsx (7).

**Done (frontend — verified: web typecheck ✅, lint 0, build 45 routes ✅):**
- **Attachments panel** (`components/attachments/attachments-panel.tsx`, card + bare variants): drag-drop/picker upload with DOCUMENT_TYPE select, list, authenticated download, delete-with-confirm; DTO-exact multipart; client mirror of 20 MB cap + extension whitelist; graceful empty state on 503 SERVICE_DISABLED/404 (no retry storm); permission-gated (attachment.view/upload/archive + parent perms). Mounted on 7 parents: asset detail (new tab), item edit, employee sheet, supplier/PO/GR/WO details.
- **Global search** (`components/search/global-search.tsx` in topbar): 300 ms debounce, min 2 chars, grouped results, keyboard nav + **Ctrl/Cmd+K**, permission gating; employee hits deep-link `/employees?detail=<id>` (sheet opens from param).
- **Asset edit dialog** (bagong `asset-edit-dialog.tsx` — walang asset edit form dati): changed-fields-only PATCH + required version, 409 → toast + rehydrate; field split mirrors service (always-editable vs draft-only; cost gated).
- **XLSX imports UI**: accepts .csv/.xlsx (templates stay CSV). **Batch labels**: multi-select sa assets list (asset.print-gated, 100 cap) → 2×1/3×2 → printable sheet sa bagong tab (`postBinary` helper).

**Integration (orchestrator):** wired AttachmentsModule + SearchModule sa app.module.ts; full chain green (build 4/4, typecheck 5/5, lint 3/3, **392 api tests**, migrate status clean sa 7 migrations, seed idempotent). **Live smoke via proxy (8 steps, all passed):** login → search "laptop" (items) at "WO-2026" (5 work orders) → attachment upload sa asset → list → download **byte-identical** → soft archive (204, wala na sa list) → asset PATCH v1→v2 ok, stale v → **409 VERSION_CONFLICT** → employees .xlsx staged validate (template-derived headers, 1 row / 1 valid — exceljs parse verified live).

**Decisions:** attachment parents mounted sa 7 UI pages (backend supports 10 — transfer/stock_transaction/asset_assignment panels one-liner na lang kung kailanganin); XLSX *export* stays Phase 7; single-resource GET/PATCH responses are bare objects (house convention confirmed again in smoke).

**Pending / Next:** Phase 6 (counts + parameterized approval engine + in-app notifications) → Phase 7. **HOLD: push/deploy/password rotation (ChangeMe!123 live publicly).**

---

## 2026-08-05 (later) — ✅ Phase 5 Maintenance complete (plans, work orders, parts, worker job)

Both agents died early on session limits, resumed via SendMessage (context intact). **Local commit only — no push/deploy per Tim.**

**Done (backend — verified: api build ✅, 27 suites / 366 tests ✅ (+130), root typecheck+lint ✅, migration `20260805063000_…` clean, seed idempotent 2×):**
- **Plans §6.1**: CRUD (`MPL-{SEQ5}`, version-guarded PATCH), activate/deactivate, `PUT :id/assets` covered-set replace (branch-scope + not-RETIRED/DISPOSED/LOST guards); frequency interval/meter/cron with pure next-due math in `maintenance-schedule.ts`.
- **Work orders §6.2**: `WO-{YYYY}-{SEQ5}`, created on OPEN; assign (user/employee/team/vendor), schedule, start (asset → UNDER_MAINTENANCE via assets `assertTransition`, pre-WO status snapshotted), hold/resume (typed reasons), complete (explicit outcome AVAILABLE|ASSIGNED|DAMAGED|RETIRED, required-checklist + reason + `asset.retire` guards, labor/external cost, downtime default = actual span, plan nextDueAt re-anchor, meter baseline), verify (verifier ≠ completer → 409 SELF_APPROVAL_FORBIDDEN), cancel (reverts asset to pre-WO status; blocked by posted un-reversed parts). **Technician scoping**: view-only callers hard-filtered to own assignments (list + detail 404 no-leak).
- **Parts issues**: `POST :id/parts-issues` creates AND posts a MAINTENANCE_ISSUE stock txn through `StockPostingService.postWithinTx` in ONE transaction, optional Idempotency-Key with replay; serialized items rejected; costs roll into WO. **Meter readings**: `GET/POST /assets/:id/meter-readings` (monotonic per meter type).
- **Worker** (`apps/worker`): hourly `generate-due-work-orders` — calendar + meter due plans, per-(plan,asset) advisory lock ⇒ exactly one open WO, re-run safe; DATABASE_URL optional (warn+skip keeps deployed worker alive). Maintenance-due notifications deferred to Phase 6.

**Done (frontend — verified green: web typecheck, lint 0, build all routes):**

**Done (frontend — verified green: web typecheck, lint 0, build all routes):**
- Routes: `/maintenance/plans` (list/new/detail/edit), `/maintenance/work-orders` (list + board views, detail). `components/maintenance/`: badges, plans-page, plan-editor (interval/meter/cron frequency, checklist editor, version-guarded PATCH), plan-detail (activate/deactivate, covered-assets via `PUT :id/assets`), work-orders-page (**"Assigned to me" defaults ON for technicians**), WO create dialog, WO detail (stepper, per-status×permission×assignee actions, checklist tick-off, parts with stock-issue links, gated costs, downtime), dialogs (assign/schedule/hold-with-reason/complete-with-outcome+final-condition, AddParts with UOM/lot + INSUFFICIENT_STOCK inline).
- Integrations: asset detail "Maintenance" tab (WO history, downtime/cost totals, meter readings + record dialog), dashboard MaintenanceTiles, app-shell Maintenance nav section.
- Lib: endpoints (+~300: plans/WOs full action surface + meter readings), types (+~340 with tolerant read helpers), status-maps (WO machine mirror, hold reasons, completion outcomes, permission any-of lists).
- Aligned byte-for-byte with backend DTOs mid-flight (forbidNonWhitelisted); error mapping per house pattern (VERSION_CONFLICT/INVALID_STATE_TRANSITION → toast+refetch).

**Integration (orchestrator):** wired `MaintenanceModule` into `app.module.ts` + `seedPhase5Maintenance` into `seed.ts`; full chain green (build 4/4, typecheck 5/5, lint 3/3, api tests 366, migrate status clean, full seed idempotent). **Live smoke through the proxy (all passed):** login → plans/WOs listed → WO create OPEN → assign ASSIGNED → start IN_PROGRESS + asset UNDER_MAINTENANCE → parts issue posted (paper 172→171, **idempotent replay: still 171**) → complete COMPLETED + asset back AVAILABLE (partsCost ₱235 auto from Phase 4 lastPurchaseCost, labor ₱350, total ₱585, downtime captured) → self-verify blocked 409 SELF_APPROVAL_FORBIDDEN → cancel path reverts asset (validated on cleanup WOs). Smoke artifacts left in dev data: WO-2026-00004..7 (3 canceled + 1 completed on the monitor/laptop).

**Decisions:** WOs create directly on OPEN (no draft step; DRAFT stays unused enum like PO REJECTED); plan coverage = asset set only; cron plans need explicit nextDueAt (no cron parser dep); worker mirrors status consts (apps can't import apps/api); asset side-effects via exported pure `assertTransition` in the WO transaction (lifecycle service opens own txns, can't compose); parts POST gated by `inventory.issue` (system-mediated posting like GR); plans list has no type filter; plan WO history client-filtered from most-recent-100; overdue tile sums per-status dueBefore counts.

**Environment note:** another project (v-hive) now occupies port 3000 locally, so the GEM-ENI web dev server runs on **http://localhost:3002** (API unchanged on 3001). Left both running.

**Pending / Next:** Phase 3.5 next (attachments §4.6, global search §4.7, assets.version, inventory.approve permission, XLSX, batch labels UI), then 6 → 7. Known gaps queued: GR-linked stock-txn direct reverse bypasses GR/PO bookkeeping; maintenance-due notifications await Phase 6. **HOLD until Tim's go: git push, Vercel/Railway deploys, seed-password rotation (ChangeMe!123 live publicly).**

---

## 2026-08-05 — ✅ Phase 4 Procurement complete (suppliers, POs, receiving, history)

Two parallel builder agents (strict file ownership) + orchestrator integration. **No pushes/deploys this phase per Tim — local commit only.**

**Done (backend — verified: api build ✅, 21 suites / 236 tests ✅, root typecheck+lint ✅):**
- **Suppliers §5.1**: CRUD + contacts (single-primary enforced), activate/deactivate/archive (archive blocked by open POs → 409 IN_USE), `/suppliers/:id/history` rollup, codes `SUP-{SEQ5}`, categories from `SUPPLIER_CATEGORY` lookups.
- **Purchase orders §5.2**: `PO-{YYYY}-{SEQ5}`; draft PATCH requires `version` (409 VERSION_CONFLICT); submit auto-approves when no PURCHASE_ORDER workflow exists (Phase 6 replaces); approve/reject (self-approval → 409 SELF_APPROVAL_FORBIDDEN; reject → back to DRAFT, no resting REJECTED); cancel blocked once receipts exist; close-short writes `canceledQuantity`. All money math in `Prisma.Decimal`; costs gated by `procurement.po.view_cost`.
- **Goods receipts §5.3**: drafts against APPROVED/PARTIALLY_RECEIVED POs (`GR-{YYYY}-{SEQ5}`); `POST :id/post` requires Idempotency-Key, ONE transaction: PO row lock → outstanding check (409 OVER_RECEIPT hard block) → SERIAL lines become Assets (real tag sequences, register→activate history, acquisitionCost from PO line) → non-serial lines post PURCHASE_RECEIPT via existing `StockPostingService.postWithinTx` (zero duplicated ledger logic) → PO receivedQuantity + status + `item.lastPurchaseCost`. Replay returns original result. Reverse: stock reversed via engine, assets voided if untouched, PO outstanding restored.
- **Supplier returns §5.4** (API only): CRUD + submit/approve/post (RETURN_TO_SUPPLIER stock txn, INSUFFICIENT_STOCK guarded). **Purchase history §5.4**: PO-line-grained, ordered/received/outstanding/canceled/returned, costs gated.
- Migration `20260805003652_…` additive: `version` cols, `goods_receipts.idempotency_key` (unique), `goods_receipt_lines.serial_numbers`, supplier-return location/stock-txn links. Seed `seed-phase4-procurement.ts`: 3 suppliers, 3 POs (received/partial/pending-approval), posted GR + 2 serialized laptops, partial lot receipt; idempotent (verified 2×).

**Done (frontend — verified green: web build 29/29 pages, lint 0, web typecheck clean):**
- **Suppliers**: `/suppliers` list (+ filters) and detail under `apps/web/src/components/suppliers/` — form dialog (code immutable, never sent on PATCH), contacts CRUD, activate/deactivate/archive, purchase summary from `/suppliers/:id/history`.
- **Purchase Orders**: `/procurement/purchase-orders` list/new/detail/edit — supplier picker, branch-scoped destination warehouse, UOM via `lib/uom.ts`, cost columns permission-gated, PATCH with `version` (VERSION_CONFLICT toast + rehydrate), status stepper + actions per `docs/status-transitions.md` §3 (submit/approve/reject/cancel/close vs close-short; SELF_APPROVAL_FORBIDDEN banner).
- **Receiving**: `[id]/receive` — per-line outstanding defaults, SERIAL count-matched inputs with paste-multiple, LOT multi-row allocations (sum + expiry validation), per-line destination location, save-draft-then-post reusing ONE draft + stable Idempotency-Key (no duplicate stock), over-receipt/409 details inline. Receipt detail at `/procurement/receipts/[id]` with post/cancel/reverse.
- **Purchase History** `/procurement/history` (filters; no CSV — exports are Phase 7 by contract), **dashboard ProcurementTiles** (Open POs / Awaiting receipt), **nav**: Procurement section + Suppliers entry.
- Lib: `endpoints.ts` full §5.1–5.4 surface; `types.ts` supplier/PO/GR/history types; `status-maps.ts` PO+GR action/permission maps; `badges.tsx`, `supplier-picker.tsx`.

**Integration (orchestrator):** wired `ProcurementModule` into `app.module.ts` + `seedPhase4Procurement` into `seed.ts`; full chain green (build 4/4, typecheck 5/5, lint 3/3, api tests 236, `prisma migrate status` clean, full seed idempotent). **Live smoke through the proxy (12 steps, all passed):** login → suppliers list → PO create (10 REAM paper + 2 SERIAL drills, ₱17,350 totals correct) → submit auto-APPROVED → GR draft → post POSTED → **idempotent replay confirmed live** (RCV bucket exactly 30 = 20 seed + 10 smoke, no double-post) → PO FULLY_RECEIVED (10/10, 2/2) → 2 assets created (AST-SUB-TLS-2026-000002/3, AVAILABLE) → purchase-history rows correct.

**Decisions:** GR numbers `GR-` per api-outline §1.9; over-receipt hard block (tolerance % = future); reject returns PO to DRAFT (per status-transitions §3); supplier-returns UI + supplier documents deferred (endpoints/attachments-module respectively); no purchase-history export until Phase 7; supplier-return routes reuse `inventory.*` permissions (no `procurement.return.*` in shared catalog); single-resource POST/GET responses are bare objects (lists use `{data, meta}`) — matches existing convention.

**Pending / Next:** Phase 5 (Maintenance) next, then 3.5 → 6 → 7. Known gap noted by builder: reversing a GR-linked stock txn directly via `/stock-transactions/:id/reverse` bypasses GR/PO bookkeeping (needs inventory-dir change; queued for a later phase). **HOLD until Tim's go: git push, Vercel/Railway deploys, seed-password rotation (ChangeMe!123 live publicly — rotate at next deploy).**

---

## 2026-08-04 (rebrand) — GEM-ENI branding + logo

Tim uploaded `gem_logo.png` (green infinity + leaf) and renamed the app **GEM-ENI** (GEM ERP and Inventory):
- Logo at `apps/web/public/gem-logo.png`; shown in the sidebar header and login page; favicon generated (256×256 square, via the hoisted `sharp`) replacing the old icon.svg.
- "GEM ERP" → "GEM-ENI" across web UI strings, page metadata, Swagger title, asset-label sheet title; README/user_access titles. Company name GemCor and package names (@gemerp/*) unchanged.
- Post-edit fixes rode along earlier this session: immutable-code edit bug fixed across lookup/category/item/employee forms (code/sku/employeeNumber omitted on update, inputs read-only in edit mode).
- Deployed to BOTH platforms; verified live: GEM-ENI on the login page, logo asset 200, API readiness ok.

---

## 2026-08-04 (later) — 🚀 DEPLOYED TO PRODUCTION: gem-erp.vercel.app

Tim upgraded Railway to Hobby (free plan can no longer provision). Deployment executed end-to-end via CLIs (railway + vercel, device-flow logins by Tim):

- **Railway** (`gem-erp` project): `api` service (Dockerfile deploy), Postgres, Redis. Vars: DATABASE_URL/REDIS_URL references, NODE_ENV=production, API_PORT+PORT=3001, SESSION_COOKIE_SECURE=true, S3_ENABLED=false, WEB_ORIGIN=https://gem-erp.vercel.app. Domain: api-production-2935.up.railway.app (port 3001). Healthcheck /api/v1/health/ready.
- **Vercel** (`gem-erp` project, created via API with rootDirectory=apps/web): API_PROXY_TARGET=<railway domain>; deployment protection (ssoProtection) DISABLED — it blocks public access by default on team projects. Production: **https://gem-erp.vercel.app**.
- **Deploy debugging trail (4 failed healthchecks → root causes):**
  1. Prisma engine mismatch (generated debian-openssl-1.1.x, runtime needs 3.0.x) → `binaryTargets = ["native", "debian-openssl-3.0.x"]` + openssl installed in the Docker BUILD stage (detection needs it).
  2. `EXPOSE 3001` + `PORT=3001` var for Railway routing/probes.
  3. API now binds dual-stack (`app.listen(port, '::')`) — Railway probes over IPv6.
  4. **The actual killer:** health check's raw-socket Redis PING never authenticated; Railway Redis requires AUTH → "unexpected response" → readiness 503 (redis fatal in production) → healthcheck fail. checkRedis now sends `AUTH <user> <pass>` from REDIS_URL before PING.
- **Prod DB migrated + seeded** via `railway ssh` into the api container (Postgres has no public endpoint; SSH key registered). Full dataset live.
- **Production smoke test (all pass):** login page 200; login via Vercel proxy→Railway 200; session (142 perms); items 12 / assets 8 / low-stock 2; rogue origin 403.
- Note: both platforms deploy via CLI for now (`railway up`, `vercel deploy --prod`) — projects are not git-connected; can wire auto-deploy-on-push later from the dashboards.

**Next:** rotate the seed passwords with Tim (public internet!), then share the URL + accounts with the team. Local dev unchanged.

---

## 2026-08-04 — Item-create root cause; same-origin proxy; hosting decision: Vercel + Railway

**Item create "Validation failed" — the REAL root cause (3rd round):** the new 4xx-details logging pinpointed it instantly: the form sent `uomConversions` in the item body, which the create/update DTOs reject (whitelist) — so **every** UI item-create failed regardless of input. (Earlier suspects — empty-string Ids, standardCost format — were real hardening but not the culprit; their error bodies were coincidentally the same size. Lesson logged: observability beats byte-archaeology.) Fix: form no longer sends `uomConversions`; conversions sync via the dedicated `/uom-conversions` endpoints (create/update/delete diff) after item save, non-fatal on partial failure. Verified E2E via proxy: item + conversion + detail all OK.

**Same-origin proxy architecture** (fixes Tim's localhost-vs-intranet cookie issue permanently): web now defaults to a RELATIVE API base (`/api/v1`) with a Next rewrite proxying to the API (`API_PROXY_TARGET`, default localhost:3001). Middleware excludes `/api` from the auth redirect. CSRF guard additionally accepts proxied same-origin requests (x-forwarded-host match or `Sec-Fetch-Site: same-origin`). Any hostname now works with zero rebuilds; cookies always first-party.

**Intranet setup removed** (Tim's call): PS scripts deleted, WEB_ORIGIN back to localhost, a one-click removal .bat left on the Desktop for the old portproxy/firewall entries.

**Hosting exploration → decision:**
- Cloudflare quick tunnel worked (verified live end-to-end over HTTPS) **but** both the Starlink and Tenda/ISP DNS resolvers refuse to resolve `*.trycloudflare.com` (1.1.1.1/8.8.8.8 resolve fine — ISP-level filtering). Router DNS override didn't stick. Named-tunnel-with-own-domain would fix it, but Tim chose managed hosting instead.
- **Decision: Vercel (web) + Railway (API + Postgres + Redis).** The proxy architecture makes this clean (single origin via Vercel rewrite). Prepared: `apps/api/Dockerfile` (multi-stage, runs `migrate deploy` on boot), `.dockerignore`, `apps/web/vercel.json` (workspace-aware build), `S3_ENABLED=false` toggle so production readiness doesn't demand MinIO before Phase 3.5 attachments, and `docs/deploy-vercel-railway.md` (click-by-click + env tables + security notes: rotate seed passwords once public).

Verified: 185/185 tests, api/web builds, typecheck/lint green. Pushing everything (deployment platforms pull from GitHub).

---

## 2026-07-30 (evening) — Office-testing bug: "Validation failed" on item create (NOT yet pushed)

Reported from live office testing (Mac + Android users on the LAN):
1. **Blank optional dropdowns → 400.** Forms submit `""` for unselected optional references; API `@IsUUID` rejects empty strings. Fixed centrally in `apps/web/src/lib/api.ts`: request bodies are sanitized — keys ending in `Id` with `""` become `null` (passes `@IsOptional`, preserves clear-on-PATCH semantics). Covers all forms.
2. **`standardCost` rejections** (matched the exact 189-byte error body from the logs). Form money pattern was laxer than the API's (`\d+` vs `\d{1,12}`) and didn't tolerate pasted `1,500.00`/spaces. Item form now: zod `preprocess` strips commas/whitespace on both cost fields, pattern aligned to the API's 12-digit cap.
3. Hardening while in there: SKU input auto-normalizes as you type (uppercase, spaces→`-`), zod enforces the API's SKU pattern with a friendly message, and blank SKU + blank category (auto-gen impossible) is caught inline.
4. **Observability:** exception filter now logs every 4xx envelope's field-level details (field + message only — never submitted values). Diagnosing this class of report is now one grep instead of byte-size archaeology.

Verified: 185/185 tests, builds green, live check confirms the new log line fires with exact field names. Debug artifacts removed from dev DB.

---

## 2026-07-30 (later still) — Intranet access for office testing (NOT yet pushed)

Tim wants officemates to test over the office LAN:
- `WEB_ORIGIN` now accepts a comma-separated list (zod transform); first entry is the primary origin used for generated links (QR scan URLs). CORS + CSRF guard accept all listed origins. `.env` set to `http://192.168.0.109:3000,http://localhost:3000` (192.168.0.109 = office Wi-Fi IP; the machine's many ZeroTier adapters were ignored).
- Web rebuilt with `NEXT_PUBLIC_API_URL=http://192.168.0.109:3001` via `apps/web/.env.local` (gitignored). Everyone — Tim included — should browse via `http://192.168.0.109:3000` (localhost page + IP API would be cross-site → Lax cookie not sent).
- `scripts/intranet-setup.ps1` (committed): Windows-admin script — netsh portproxy on the Wi-Fi IP only (3000/3001 → WSL via loopback) + private-profile firewall rules; `-Remove` undoes everything. Tim must run it as admin (cannot elevate from WSL).
- Verified: 185/185 tests, builds green; CORS allow-origin echoes LAN origin; CSRF accepts LAN + localhost, rejects others (403). QR labels now encode the LAN scan URL → phone-scannable in the office.
- Caveats noted to Tim: dev-only exposure (seed creds), machine must stay on with Docker Desktop running, DHCP may change the IP (script has a note), remove the forwarding after testing.

---

## 2026-07-30 (later) — Bug fixes from Tim's testing (NOT yet pushed)

Tim reported two bugs; both fixed and verified locally, **held from push at Tim's request** pending his browser re-test:
1. **Stock ledger "Validation failed"** — page sent `sort=occurredAt:desc`; API accepts `postedAt|createdAt`. Fixed to `postedAt:desc`. Related: removed phantom `INTER_BRANCH_TRANSFER` enum value from `@gemerp/shared` (Prisma truth: `_OUT`/`_IN`), fixed ledger type filter + labels.
2. **Transfer line UOM dropdown empty** — line editors read scalar `item.baseUomId`/`item.uomConversions` which the items list payload doesn't carry (nested `baseUom` objects only; conversions are global). New shared helper `apps/web/src/lib/uom.ts`: choices from nested UOM objects + global catalog, multi-hop (BOX→PACK→PC) conversion preview via graph walk. Both transaction wizard and transfer editor rewired (wizard had the same latent bug).

Verified: build/typecheck/lint green, 185/185 tests, ledger query 200 with the page's exact params, UOM sources live (6 UOMs, 3 global conversions). Web restarted on the fixed build.

Round 2 (same session, from Tim's live testing — still unpushed):
3. **"Insufficient stock" on issue despite 45 on hand** — seed typo: MKT opening balances pointed at `MKT-WH1:S-01` which doesn't exist (S-01 is a SUB-SR1 location) → 40 reams landed in a NULL-location bucket; Tim's issue line pointed at ISS (empty). Engine behaved correctly. Fixed the seed (`S-01`→`A-01`), repaired the dev DB (moved seed txn lines + ledger rows + buckets to MKT-WH1:A-01 — seed rows only), and enriched the INSUFFICIENT_STOCK detail to hint that stock may sit in a different location. Backlog (Phase 3.5): show per-location availability in the location picker.
4. **Ledger page quantities all 0 + Type/Transaction columns empty** — field drift: API sends `quantityDelta` and a nested `transaction` object; page read flat `baseQuantity`/`transactionType`/`transactionNumber`. Also the transaction-detail ledger table expected nested item/lot/location but detail entries carry scalar ids — now joined to their document line via `transactionLineId`. Tim's transactions were correct all along (receipt +5, issue −3, balances right) — display only.

---

## 2026-07-30 — Phase 3 delivered: stock ledger, transfers, serialized assets, scanning

**Done:**
- Built by three parallel builder agents (inventory/ledger, assets/scan, frontend) against the `docs/api-outline.md` §4 contract; interrupted once by session limits and resumed with context intact; integrated, verified, and hardened by the orchestrator.
- **Stock ledger engine** (`apps/api/src/inventory`): all spec-§13 transaction types; draft→submit→(auto-)approve→post workflow; posting in a single DB transaction with advisory locks + conditional decrements — **concurrency proven live**: two racing 5-unit issues for the last 5 on hand → exactly one POSTED, one 409 INSUFFICIENT_STOCK, ledger reconciled to zero; `Idempotency-Key` required on post/reverse with replay returning the original result (verified: no duplicate movement); reversal creates negating entries, original never edited; lots with expiry validation (LOT_EXPIRED + permissioned override) and FEFO ordering; balances as projections (onHand/available/reserved/inTransit); low-stock report driven by per-warehouse reorder settings.
- **Transfers** (`apps/api/src/transfers`): location/intra-branch immediate moves + INTER_BRANCH documents TRF-{YYYY}-{SEQ} with dispatch (source leg + in-transit) → receive (per-line accepted/short/damaged) → close; both-end branch access enforced; seeded TRF-2026-00001 in transit SUB→MKT.
- **Serialized assets** (`apps/api/src/assets`): registration (single/bulk) with atomic AST-{BRANCH}-{CAT}-{YYYY}-{SEQ6} tags; full lifecycle state machine per docs/status-transitions.md (11 statuses × 23 events walked in tests — every illegal transition 409); assign/acknowledge/return with condition capture; damage/loss/recover; retire/dispose/reverse-disposal; custody + movement + status + condition history; employee custody endpoints (assets, acknowledgments with overdue).
- **Labels + scanning** (`apps/api/src/scan`): Code128 + QR labels (SVG/PNG, two sizes, batch sheet) — QR carries only an opaque scan URL; scan tokens never serialized in API responses; `/scan/:token` returns summary + permitted actions; unknown/wrong-branch tokens get identical 404 (no oracle).
- **Frontend**: transaction wizard (per-type fields, lot select-or-create, live UOM preview, per-line INSUFFICIENT_STOCK rendering), balances/ledger/lots/low-stock browsers, transfer screens incl. receive with exception quantities, asset list/detail with status-driven action dialogs + label print, `/scan` page (keyboard-wedge + native BarcodeDetector camera + manual fallback, duplicate-scan guard), dashboard tiles (low stock, assets by status, in-transit, my acknowledgments). 12 new routes (25 total).
- **Integration fix (mine):** issue lines without a storage location hit the location-bucket balance and failed with a misleading "available 0". `prepareLines` now defaults receipts to the warehouse's default receiving location and auto-resolves outbound lines to the single stocked location (explicit-location error when stock sits in several; accurate warehouse-level INSUFFICIENT_STOCK when none) — spec §6 default-locations behavior.
- **Verification:** build 4/4, typecheck 5/5, lint 3/3, **185/185 unit tests**; migration `phase3_stock_txn_idempotency_and_versions` applied; seed integrated + idempotent (re-run clean). Live smoke: overdraw 999 → 409 with available 30; issue 5 auto-location → POSTED, 30→25; replay → unchanged; reverse → 30 restored; label SVG renders; scan token resolves with permitted actions; transfers show in-transit; security checks (employee@ valid-body create → 403, dispose → 403; warehouse@ sees SUB only; bogus scan token opaque 404).

**Decisions / debt (tracked in implementation-plan Phase 3.5):**
- Deferred: attachments (§4.6), global search (§4.7), XLSX, draft-line editing UI, batch-label UI. Approval routing for controlled actions arrives with Phase 6 (self-approval already blocked). `assets.version` column + `inventory.approve` permission string to add in the next migration/catalog batch.

**Pending / Next:**
- Phase 3.5 cleanup ride-along, then Phase 4: suppliers, purchase orders + approvals, partial receiving (serialized receipts create asset instances), purchase history.

---

## 2026-07-28 — Phase 2 delivered: employees, lookups, item master, imports

**Done:**
- Built via two parallel builder agents (backend + frontend) against the `docs/api-outline.md` §3 contract, then integrated and verified.
- **Backend** (`apps/api`): EmployeesModule (CRUD, filters, branch-scoped, EMP-{SEQ} auto-numbering, optimistic `version` checks → 409 VERSION_CONFLICT, activate/deactivate/separate/archive — separation returns outstanding custody and blocks archive until clean, notes gated on `employee.view_notes`); LookupsModule (departments + head assignment, positions, brands, manufacturers, item categories/subcategories, UOMs + global/item conversions, generic `/lookups/:type` for 11 spec-§10 lists, IN_USE delete protection); ItemsModule (SKU-{CAT}-{SEQ} auto-gen, §4 category×tracking validation, tracking immutable once stock/assets exist, barcode mapping unique-while-active → DUPLICATE_CODE, per-warehouse settings with branch access, `resolve-barcode` for scanner flows, cost fields gated on `item.view_cost`); ImportsModule (CSV template → multipart validate with row-level machine-coded errors → staged commit strict/partial, `import_stagings` table, audit-logged). New SequencesModule; fixed latent Phase 1 bug (AuditService dropped `actorUserId` → NULL actors).
- **Migration** `phase2_versions_uom_globals_import_stagings`: version columns on employees/items, global UOM conversions (nullable item_id + partial unique index), import_stagings.
- **Frontend** (`apps/web`): Employees (table/filters/dialogs, separation flow, custody section that hides on 404 until Phase 3), Lookups admin (8 tabs + generic lists engine), Items (full-page form: basics/units/flags/costs/barcodes/warehouse-settings grid), 4-step CSV Import wizard, nav + dashboard tiles, new Tabs + Combobox UI-kit components.
- **Seed**: 4 departments (ADMIN head wired), 5 positions, 8 employees (EMP-000001–8, one linked to employee@gemcor.dev), 6 UOMs + conversions, 7 categories + subcats, brands/manufacturers, 12 items covering every category × tracking method (incl. LOT+expiry), 14 barcodes, 8 warehouse settings (5 low-stock examples), 41 lookup values.
- **Verification**: build 4/4, typecheck 5/5, lint 3/3, **91/91 tests** (from 35). Live smoke: employees/items/lookups/conversions listed; SKU + bin barcode resolution; full import E2E (validate caught bad branch ref → partial commit imported 1 row → record searchable); web routes guard-redirect. Security spot-checks: cost fields hidden from warehouse custodian, notes hidden from auditor, employee branch scoping (auditor 5 vs superadmin 8), import template 403 for employee role, cross-branch warehouse-settings PUT 403.
- Added `user_access.md` (dev accounts cheat sheet — Tim request) + README link.
- `docs/implementation-plan.md`: Phase 2 marked ✅ Delivered.

**Decisions:**
- Imports are CSV-only for now; XLSX deferred to Phase 8 polish (commented in code). Supplier import type arrives with Phase 4.
- An adversarial review workflow was attempted but hit session limits; replaced with targeted manual security spot-checks (all passed). Deeper review can ride along with Phase 3.

**Pending / Next:**
- Phase 3: stock-ledger engine, receiving/issue/return/transfer/adjustment/reversal, serialized asset instances + lifecycle, barcode/QR generation + scanning, low-stock detection.

---

## 2026-07-27 (later) — Real branches, parameterized approvers, notifications on hold

Tim's answers to the kickoff questions, applied:

**Done:**
- **Real branches** (replaces MNL/CEB/DVO placeholders): `SUB` "GemCor - Subic" (2 warehouses) and `MKT` "GemCor - Makati" (1 warehouse). Seed, README, all docs, and web form example updated; org name normalized to "GemCor". Non-superadmin seed users scoped to SUB; branch admin gets SUB+MKT (assumption — flip if Makati is the main office). Dev DB reseeded and placeholder branch rows surgically removed (avoided full `migrate reset`); verified via API: superadmin sees both, auditor sees SUB only.
- **Parameterized approvals** (Tim's requirement): approval steps now resolve approvers by `ROLE` | `POSITION` | `DEPT_HEAD` | `USER`. Schema migration `approval_approver_types_and_dept_head`: `approval_steps.approver_type` enum + `approver_position_id` FK; `departments.head_employee_id` FK (resolves DEPT_HEAD at request time). Behavior lands in Phase 6; requirement recorded in `docs/implementation-plan.md`.
- **Notifications external channels on hold** per Tim — Phase 6 ships in-app only, service interface stays channel-ready.
- Re-verified: build 4/4, typecheck 5/5, lint 3/3, 35/35 tests, live API smoke test.

**Pending / Next:**
- Confirm with Tim: which branch is the "main"/HQ branch (affects default seed scoping only).
- Phase 6 must implement approver resolution for all four types + admin UI.

---

## 2026-07-27 — Phase 1 verified end-to-end and pushed

**Done:**
- Generation complete: `apps/api` (75 files — auth, users, roles/permissions, org structure, audit, health, RBAC guards), `apps/web` (69 files — login, dashboard, users/roles/branches/audit pages, UI kit), `apps/worker`, `docs/erd.md`. The final workflow run hit a model usage limit right at the end, but the code was fully written; verified and repaired manually instead of regenerating.
- **Full verification chain green:**
  - `pnpm install` clean (argon2/sharp/esbuild native builds OK).
  - `prisma validate` + `generate` OK; initial migration `init` created and applied to live Postgres (66 tables).
  - Seed OK: org, 3 branches + warehouses/locations, 142 permissions, 7 roles, 7 dev users, audit entry. Idempotent (re-run verified).
  - `pnpm build` / `typecheck` / `lint` / `test` all pass — 35 unit tests (RBAC guard, branch scope, effective permissions, auth lockout/session hashing).
  - **Live smoke test:** API boot → health/ready (postgres+redis+minio up); superadmin login sets `gemerp_session` cookie; `/auth/me` returns 142 perms; branches list OK; wrong password → 401 `INVALID_CREDENTIALS` envelope; unauthenticated → 401; **branch isolation proven** (auditor sees only MNL); **RBAC proven** (employee create-user → 403 FORBIDDEN); audit log captured the failed-login event; Swagger 200. Web: `/login` 200, unauthenticated `/` → 307 redirect to login. Worker: Redis connect + 4 queues registered.
- **Integration fixes made during verification:**
  - `packages/shared/tsconfig.json`: wrong preset path (`tsconfig.base.json` → `tsconfig/library.json`).
  - nestjs preset: `isolatedModules` off (TS1272 vs decorator metadata); `incremental` off (stale `.tsbuildinfo` outside `dist` caused partial emits after a failed build — root cause of an API boot failure).
  - Removed duplicate `id` property from request interfaces (conflicts with pino-http's augmentation).
  - Root `db:*` scripts pointed at nonexistent script names in `@gemerp/database` — fixed (`migrate:deploy` for `db:migrate`, added `db:migrate:dev`, `db:studio`).
  - Added dependency-free `.env` loading for Prisma CLI + seed (`packages/database/src/load-env.ts`, modern `prisma.config.ts`, deprecation warning gone). All root `pnpm db:*` commands now work without exporting env vars.
  - Lint cleanup (unused imports, regex escape).
- Committed and pushed everything to `origin/main`.

**Decisions:**
- Did not regenerate the interrupted API/web agents — their output was structurally complete; compiler-driven repair was cheaper and safer.
- Docs consistency review agent never ran (usage limits); spot-checks of permission strings/role codes across docs ↔ shared package ↔ seeded DB all matched. A deeper pass can ride along with Phase 2.

**Pending / Next:**
- Phase 2 per `docs/implementation-plan.md`: employees, lookup configuration, item master, UOM conversions, barcode mapping, import templates.
- E2E (Playwright) suite not started — spec Phase 8 hardening; add progressively from Phase 2.
- Docker Desktop must be running before `docker compose up -d` (it shuts down with Windows).

---

## 2026-07-24 — Resume generation, infra prep, first push

**Done:**
- Resumed the generation workflow after yesterday's session limit cut off 5 of 14 agents (API, web, worker, ERD doc, consistency review). Backbone (docs, root tooling, shared package, 66-table Prisma schema) completed yesterday and replayed from cache; removed partial `apps/api` / `apps/web` stubs before re-running.
- Docker Desktop WSL integration enabled (by Tim). Verified docker 27 + compose v2 work in this distro.
- **Port conflict fix:** host port 5432 is occupied by `devotion-app-postgres` (another local project). GEM ERP Postgres now maps to host **5433** (`docker-compose.yml`, `DATABASE_URL` in `.env.example`, README troubleshooting updated). Inside the compose network it remains 5432.
- Created `.env` from `.env.example`; started `docker compose up -d` (postgres/redis/minio + bucket init).
- Verified GitHub push auth via Windows Git Credential Manager; pushed initial commit to `origin/main`.

**Decisions:**
- Keep both projects' databases side by side rather than stopping devotion-app's Postgres.

**Pending / Next:**
- Wait for API/web/worker/ERD/review agents → then verify (install, typecheck, build, unit tests), generate initial Prisma migration, migrate + seed against live Postgres, boot API + smoke test, push everything.

---

## 2026-07-23 — Project kickoff: Phase 0 design + Phase 1 foundation scaffold

**Done:**
- Read and adopted `asset-inventory-system-codex-master-prompt.md` as the authoritative spec.
- Environment check: Node v22.23.1 ✓, pnpm 9.15.9 (enabled via corepack) ✓, git 2.43.0 ✓.
  - ⚠️ Docker NOT available in this WSL distro — Docker Desktop WSL integration must be enabled to run Postgres/Redis/MinIO locally.
  - ⚠️ `gh` CLI not installed — pushing via git + Windows Git Credential Manager.
- Initialized git repository, remote: https://github.com/tiiim1111/gem-ERP
- (This session, see below) Phase 0 design docs under `docs/`, Phase 1 monorepo scaffold.

**Decisions:**
- Follow the spec's phased plan: Phase 0 (design docs) + Phase 1 (foundation) in this session. No Phase 2+ features yet — spec §34 forbids marking phases complete without passing verification.
- Monorepo: pnpm workspaces + Turborepo. Package scope `@gemerp/*`.
- Ports: web 3000, api 3001. API prefix `/api/v1`, Swagger at `/api/docs`.
- Auth: server-side cookie sessions (`gemerp_session`, HTTP-only, SameSite=Lax), argon2id password hashing, sessions persisted in `user_sessions` (token stored hashed).
- Default org timezone Asia/Manila, currency PHP, storage in UTC.
- Seed branches: MNL (Manila HQ), CEB (Cebu), DVO (Davao). Dev-only seed credentials documented in README — must never be used in production.

**Pending / Next:**
- Docker not verifiable in this environment — user must enable Docker Desktop WSL integration, then run migrations + seed (see README setup guide).
- Phase 2 (employees, lookups, item master) not started.
- Integration/E2E tests require a running Postgres — deferred until Docker is available.
