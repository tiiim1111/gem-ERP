# GEM ERP — Barcode and QR Code Strategy

Status: Accepted (Phase 0 design artifact)
Owner: Platform team
Spec reference: `asset-inventory-system-codex-master-prompt.md`, section 5 (Barcode and QR-Code Design), section 11 (Item Master), section 26 (Data Model)

This document defines how GEM ERP identifies physical things — serialized assets, consumable SKUs, lots, and storage bins — with barcodes and QR codes, how scans are captured and resolved, and how labels are produced. It is the single source of truth for code formats. Implementation phases are marked throughout; anything tagged **[Phase 3]** ships with the inventory/asset slice, **[Phase 2]** with the catalog slice, and **[Phase 4+]** later.

---

## 1. Design principles

1. **Codes are opaque to security.** A barcode or QR code never grants access. Scanning only *identifies* a record; the API still enforces authentication, permissions, and branch scope before returning anything.
2. **One code per stocking concept, not per piece.** Serialized assets get one tag per physical unit. Consumables get one barcode per SKU (plus alternates), never per individual piece. Lots and bins get their own codes.
3. **Human-readable and machine-readable together.** Every label carries the code as scannable symbology *and* printed text, so manual entry always works.
4. **Business numbers come from `sequence_counters`,** never from UUID primary keys. Codes are stable for the life of the record and are never reused.
5. **Ledger integrity is independent of scanning.** Scans are a fast input method for the same validated transactions a keyboard user would create. No scan path bypasses posting rules.

### Code character set

All internally generated codes use only `A–Z`, `0–9`, and `-` (hyphen), uppercase. This set is:

- safe in Code 128 subset B,
- unambiguous through keyboard-wedge scanners on any keyboard layout we care about,
- URL-safe without encoding,
- easy to read aloud and type manually.

Alternate barcodes captured from suppliers (UPC/EAN/etc.) are stored verbatim as scanned.

---

## 2. Serialized assets **[Phase 3: generation, labels, scanning]**

### 2.1 Asset tag format

Every physical asset instance receives a unique internal asset tag:

```text
AST-{BRANCH_CODE}-{CATEGORY_CODE}-{YEAR}-{SEQ}
```

| Segment | Rule | Example |
| --- | --- | --- |
| `AST` | Fixed literal prefix | `AST` |
| `BRANCH_CODE` | Branch short code (2–5 chars, uppercase) from `branches` | `SUB`, `MKT` |
| `CATEGORY_CODE` | Item category short code (2–5 chars) from the item's category lookup | `LAP`, `MON`, `PRN` |
| `YEAR` | 4-digit year of registration, org timezone (Asia/Manila) | `2026` |
| `SEQ` | Zero-padded 6-digit sequence | `000123` |

Examples: `AST-SUB-LAP-2026-000123`, `AST-MKT-MON-2026-000045`.

Sequence scope: one counter per `(branch, category, year)` tuple, allocated from `sequence_counters` inside the same database transaction that creates the asset (counter key e.g. `asset_tag:SUB:LAP:2026`). Counters reset per year by virtue of the year being part of the key; they never rewind within a key. Gaps are acceptable (a rolled-back transaction may burn a number); duplicates are not — the `assets.asset_tag` column has a unique index.

The asset tag is immutable after registration. If an asset moves branches, the tag keeps its original branch code — the tag records provenance, and the asset's *current* branch lives in the `assets` row. Re-tagging is not a rename; it is an audited administrative action reserved for damaged/illegible labels and reuses the existing tag on a reprinted label.

### 2.2 What goes on the asset label

Each asset label carries, per spec section 5:

1. **Code 128 barcode** encoding the asset tag literally (`AST-SUB-LAP-2026-000123`). Chosen because it is dense, supports our full character set, and is read by every commodity 1D scanner.
2. **QR code** encoding an opaque scan URL (section 4 below) — *not* the asset tag and not any record data.
3. **Human-readable text**: the asset tag, item name (truncated), and "Property of GemCor".

The 1D barcode and the QR code deliberately encode different things: the Code 128 is for operators inside GEM ERP scan screens (fast keyboard-wedge identification by tag), the QR is for camera scans that may start outside the app (resolves through the scan endpoint with full auth).

### 2.3 Manufacturer serial numbers

The manufacturer serial number is stored on `assets.serial_number` and is searchable/scannable as a *lookup* input (scan resolution order, section 6.3), but it is never our identity: two vendors can collide, serials can be missing, and serials are not under our control. The internal asset tag is always the canonical identifier.

---

## 3. Consumables and bulk non-consumables

### 3.1 SKU-level barcodes — never per-piece **[Phase 2: mapping; Phase 3: scan workflows]**

Consumables are identified at the SKU level. We do not generate a barcode per individual piece. Scanning a consumable barcode identifies the SKU; the operator then enters or confirms the **quantity** being received, issued, returned, transferred, or counted.

Internal primary SKU barcode format:

```text
SKU-{CATEGORY_CODE}-{SEQ}
```

Example: `SKU-PPR-000042` (6-digit sequence per category, from `sequence_counters`, key e.g. `sku:PPR`). The internal SKU code is generated at item creation **[Phase 2]** and stored on `items`.

### 3.2 Alternate barcode mappings **[Phase 2]**

One SKU may carry many barcodes. The `item_barcodes` table maps any number of alternates to an item:

- **Types**: `INTERNAL` (our SKU code), `UPC`, `EAN`, `SUPPLIER`, `PACKAGING` (case/inner-pack codes), `OTHER`.
- Each mapping records the barcode value (verbatim), type, optional UOM it represents (e.g. a case barcode maps to `BOX`), optional supplier link, and active flag.
- **Uniqueness**: an *active* barcode value may map to at most one item. Deactivated mappings are retained for history but freed for reassignment (enforced with a partial unique index on `(barcode) WHERE is_active` via raw SQL in the Prisma migration, since Prisma cannot declare partial indexes in the schema DSL).
- Scanning any active alternate resolves to the same SKU. If the mapping carries a UOM, the scan pre-fills that entry unit (e.g. scanning the case barcode defaults the line to `1 BOX`).

Bulk non-consumables follow this same SKU workflow when quantity-tracked. When individual custody/condition history is required, they are registered as serialized assets and use asset tags (section 2) instead — the tracking method on the item decides, per spec section 4.

### 3.3 Lot barcodes **[Phase 3]**

Lot-controlled consumables get one code per lot/batch:

```text
LOT-{SKU_CODE}-{DATE}-{SEQ}
```

- `SKU_CODE`: the item's internal SKU code *without* the `SKU-` prefix (e.g. `PPR-000042`), keeping the full lot code parseable: everything between `LOT-` and the final two segments is the SKU reference.
- `DATE`: receipt date as `YYYYMMDD`, org timezone.
- `SEQ`: 3-digit sequence per `(sku, date)` from `sequence_counters`.

Example: `LOT-PPR-000042-20260723-001`.

Lot codes are generated at goods receipt (or opening balance) when the item is lot-tracked. The supplier's own lot/batch number is captured on `inventory_lots` as a separate searchable field; our internal lot code is canonical. Lot labels carry a Code 128 of the lot code plus printed text: lot code, item name, supplier lot number, and expiry date when present.

Scanning a lot barcode identifies SKU **and** lot in one read, so lot-controlled issues/counts skip the lot-picking step.

### 3.4 Bin and storage-location labels **[Phase 3]**

Warehouses, shelves, and bins get location labels:

```text
BIN-{BRANCH_CODE}-{WAREHOUSE_CODE}-{LOCATION_CODE}
```

Example: `BIN-SUB-WH1-A-03-B2` (the location code segment may itself contain hyphens for zone/aisle/rack/shelf; parsing is prefix-plus-lookup, not positional). The code is derived from the org-structure codes created in Phase 1 and stored on `storage_locations`; labels are printable from the location admin screens once label generation ships in Phase 3.

Scanning a bin label in a transaction screen sets or confirms the source/destination location; in count mode it scopes the count to that bin.

---

## 4. Scan token design (QR payload) **[Phase 3]**

### 4.1 Token

- Column `scan_token` on `assets`: an opaque random token, generated with `crypto.randomBytes(16)` and encoded as Crockford base32 (26 chars, uppercase, no padding) — dense enough for a small QR, no ambiguous characters.
- Unique index on `assets.scan_token`.
- Generated at asset registration in the same transaction as the tag; never derived from any record data.
- Stable for the life of the asset. Rotation (regenerate + reprint) is an audited admin action for compromised/illegible labels; the old token stops resolving immediately.

### 4.2 QR content

The QR encodes a URL, not a bare token, so any phone camera app lands somewhere sensible:

```text
{APP_BASE_URL}/scan/{token}
```

e.g. `https://gemerp.gemcor.example/scan/8N6QV2J9K3M4P5R6S7T8W9X0YZ`. `APP_BASE_URL` comes from validated environment config. The QR contains **no** asset data, no branch, no employee, no cost — only the opaque URL.

QR error correction level M; module size chosen per label size (section 8).

### 4.3 Resolution flow

1. Phone camera or in-app scanner opens `apps/web` route `/scan/[token]`.
2. Unauthenticated users are sent through login first (standard session flow); the scan URL is preserved as the post-login redirect. Nothing about the asset is revealed pre-auth.
3. The web app calls `GET /api/v1/scan/:token` **[Phase 3 — this endpoint is not part of the Phase 1 API surface]**.
4. The API resolves the token to its asset, then enforces the caller's permissions (`asset.view`) and branch scope exactly as `GET /assets/:id` would. Success returns the resolved resource type + id + summary; the web app navigates to the asset detail page.
5. Unknown/rotated tokens return 404 with error code `SCAN_TOKEN_NOT_FOUND`; authorization failures return the standard 403 envelope. Responses are identical in shape and timing whether the token never existed or the caller lacks access — the endpoint must not become an oracle for probing valid tokens.
6. Scan resolutions of protected records are audit-logged (actor, token → resource, branch, timestamp).

The endpoint is designed so later phases can resolve other code families (lot, bin) through the same route if we ever put QR codes on those labels; Phase 3 scope is assets only.

---

## 5. UOM entry rules **[Phase 2: conversions; Phase 3: enforcement in transactions]**

Scanning identifies *what*; the operator supplies *how much* and *in which unit*.

- Every item has a **base UOM** (e.g. `PIECE`) plus optional purchasing/issuance units with conversions defined in `uom_conversions` (e.g. `1 BOX = 10 PACK`, `1 PACK = 100 PIECE`).
- Every stock transaction line stores **both**:
  - `entered_uom` + `entered_quantity` — exactly what the operator keyed or confirmed (`2 BOX`), and
  - `base_quantity` — the normalized amount in base UOM (`2000 PIECE`), computed server-side at validation time from the conversion chain in effect.
- The ledger and all balance math use `base_quantity` only. The entered pair is preserved for display, documents, and audit.
- Conversion factors are resolved and frozen per line at posting; later edits to a conversion never retroactively change posted lines.
- Zero and negative quantities are rejected. Fractional quantities are allowed only if the entered UOM permits decimals (flag on `units_of_measure`).
- A packaging barcode with a UOM mapping (section 3.2) pre-fills `entered_uom`; the operator can override before confirming.

---

## 6. Scanner input handling **[Phase 3]**

### 6.1 Keyboard-wedge scanners (USB/Bluetooth HID)

These scanners type the code and send a terminator (Enter, sometimes Tab). Handling:

- **Scan screens** (receiving, issue, transfer, return, count, asset lookup) keep a dedicated, always-focused scan input. Enter/Tab submits the code for resolution; focus returns to the input after each resolution so rapid-scan runs hands-free.
- A shared `useScanInput` hook in `apps/web` distinguishes scans from human typing by inter-keystroke timing (burst of characters each < ~35 ms apart, minimum length 4, terminated by Enter/Tab). On scan-first screens this also lets us capture scans even when focus drifted to another control, without hijacking normal typing.
- No global app-wide wedge listener outside scan screens — a scan into a random form must not trigger hidden behavior.
- IME/keyboard-layout quirks are avoided by our restricted internal charset (section 1); scanners should be configured for USB-HID "keyboard" mode with Enter suffix — documented in the ops runbook.

### 6.2 Camera scanning (mobile/tablet)

- In-app camera scanning uses `getUserMedia` through a maintained browser scanning library (`@zxing/browser`), reading both Code 128 and QR. Where the native `BarcodeDetector` API is available it is preferred and the library is the fallback; both paths emit into the same scan-resolution pipeline as wedge input.
- Requires a secure context (HTTPS) — already guaranteed by our deployment posture; local dev uses `localhost`, which is a secure context.
- Continuous-scan mode with a target reticle for rapid-scan workflows; single-shot mode for form fields.
- All camera decoding is client-side; no frames leave the browser.

### 6.3 Scan resolution order (server-side)

`POST`-side helpers and the shared lookup used by scan screens resolve a raw scanned string in this order:

1. Prefix match `AST-` → asset by `asset_tag`.
2. Prefix match `LOT-` → lot by internal lot code (also yields the SKU).
3. Prefix match `BIN-` → storage location by bin code.
4. Prefix match `SKU-` → item by internal SKU code.
5. Otherwise → `item_barcodes` active mapping (UPC/EAN/supplier/packaging).
6. Otherwise → `assets.serial_number` exact match (manufacturer serial fallback).
7. No match → typed "unknown code" result; the UI offers manual search and, with permission, capture-as-alternate-barcode for the item currently being received.

The scanned URL form (`…/scan/{token}`) is recognized by pattern and routed through token resolution (section 4.3). Every resolution is branch-scoped: a code that resolves to a record outside the caller's branches behaves exactly like an authorization failure on the record itself.

### 6.4 Duplicate-scan protection

Layered, because double-reads happen at trigger level, UI level, and network level:

1. **Debounce (client)**: within a rapid-scan session, an identical code read within 1.5 s of the previous read is ignored with a distinct "duplicate" beep/flash — this absorbs trigger bounce and accidental re-aims.
2. **Session semantics (client + server)**:
   - *Serialized flows*: an asset tag can appear at most once per document. A second scan of the same tag highlights the existing line instead of adding one; server-side validation rejects duplicate asset lines on the document regardless of what the client sent.
   - *Quantity flows*: re-scanning a SKU increments its existing line (configurable per screen: increment vs. select-line), so duplicates are visible, not silent.
   - *Count mode*: each asset tag is counted once per session (re-scan flags "already counted"); SKU scans accumulate with per-scan history retained for recount review.
3. **Posting idempotency (server)**: posting-sensitive endpoints accept an idempotency key (spec section 27), so a double-submitted receipt/issue cannot create duplicate stock movement even if every client-side guard fails.
4. **Feedback**: distinct audible + visual signals for success, duplicate, and error (unknown code / not permitted), so operators can run heads-down. Sounds are short generated tones (Web Audio), no audio assets, with a mute toggle; visual state changes never rely on color alone.

---

## 7. Manual entry fallback **[Phase 3]**

Scanning is an accelerator, never a requirement:

- Every scan input accepts typed or pasted codes and submits through the identical resolution pipeline (section 6.3), so behavior is bit-for-bit the same as a scan.
- Scan screens include a "search instead" affordance opening permission-aware search by tag, serial, SKU, name, or barcode fragment for when the label is damaged or missing.
- Global search (spec section 25) already covers asset tag, serial number, SKU, and barcode, so any code printed on a label can be found from anywhere in the app.
- Documents render codes as human-readable text precisely so this fallback always has something to type.

---

## 8. Label generation and printing **[Phase 3]**

### 8.1 Approach

- **Server-side PDF generation** in `apps/api` (with heavy batch jobs delegated to `apps/worker` via BullMQ): symbologies rendered with `bwip-js` (Code 128 + QR, pure JS, no native deps), composed into PDFs with `pdf-lib`. No client-side rendering for print output — PDFs give deterministic physical dimensions across printers, which browser-printed HTML does not.
- Endpoints return the PDF (`application/pdf`) for browser print dialogs or download; large batch runs (e.g. "labels for all assets received on this GR") are queued and delivered via the notifications/exports flow.
- Label generation is permission-gated (print permissions per spec section 8) and audit-logged, since labels can be requested for any in-scope record.

### 8.2 Supported label sizes (initial set)

| Size | Target | Contents |
| --- | --- | --- |
| 50.8 × 25.4 mm (2" × 1") thermal | Asset tags, lot labels | Code 128 + QR (assets) or Code 128 (lots) + text |
| 76.2 × 50.8 mm (3" × 2") thermal | Large assets, bin labels | Larger symbology + location/asset text |
| 25.4 × 25.4 mm (1" × 1") thermal | QR-only asset tag for small equipment | QR + tag text |
| A4 sheet, 65-up (38.1 × 21.2 mm) | Laser-printed batch runs without a thermal printer | Code 128 + text |
| A4 sheet, 24-up (63.5 × 33.9 mm) | Batch asset/lot labels | Code 128 + QR + text |

Sizes are defined as layout templates (dimensions, margins, symbology placement, font floor of 6 pt for readability) so adding a stock format is a template addition, not new code paths. Sheet templates support a start-offset so partially used sheets are not wasted.

### 8.3 Preview and reprint

- Every printable label has an on-screen preview (rendered from the same server-side PDF) before printing, per spec section 5.
- Reprint is always available from the record (asset, lot, location, item) with the print permission; reprints reuse the existing code/token — reprinting never mutates identity.

---

## 9. Data model touchpoints (summary)

| Table | Barcode-relevant columns | Phase |
| --- | --- | --- |
| `items` | internal SKU code (unique) | 2 |
| `item_barcodes` | barcode value, type, UOM, supplier, active flag; partial unique index on active values | 2 |
| `assets` | `asset_tag` (unique), `serial_number` (indexed), `scan_token` (unique) | 3 |
| `inventory_lots` | internal lot code (unique), supplier lot number, expiry | 3 |
| `storage_locations` | derived bin code (unique per warehouse) | 1 (codes) / 3 (labels) |
| `sequence_counters` | counter rows for `asset_tag:*`, `sku:*`, `lot:*` keys | 1 (table) / 2–3 (keys) |

All identity codes get unique indexes; all scannable lookup fields (serial number, alternate barcodes) get plain indexes, per spec section 29.

---

## 10. Phase landing map

| Capability | Phase |
| --- | --- |
| `sequence_counters` table, branch/warehouse/location codes | **Phase 1** (already in foundation scope) |
| Internal SKU code generation; `item_barcodes` alternate mappings (UPC/EAN/supplier/packaging); UOM conversion definitions | **Phase 2** |
| Asset tag generation + `scan_token`; lot code generation; Code 128/QR rendering; label PDF templates, preview, printing; `GET /api/v1/scan/:token` + `/scan/[token]` web route; wedge + camera scan input; scan resolution pipeline; duplicate-scan protection; rapid-scan receiving/issue/return/transfer/count modes; manual-entry fallback; UOM dual storage on transaction lines | **Phase 3** |
| Serialized asset + lot creation during PO receiving reuses Phase 3 generators; label batch print from goods receipts | **Phase 4** |
| Barcode-assisted physical counts with blind-count option | **Phase 6** (engine and scan plumbing from Phase 3) |

Nothing in Phase 1 or 2 renders a barcode; those phases only lay down the identity columns, counters, and mappings that Phase 3 generation depends on, so no throwaway work is created.
