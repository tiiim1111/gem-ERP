# Paglalagay ng umiiral na asset register sa GEM-ENI

Walkthrough para ilipat ang Excel asset register (CONTROL NO / ASSET TYPE /
DESCRIPTION / QTY / PHP / LOCATION / END-USER) papunta sa sistema.

Mga handang file para sa practice: `Desktop/gemeni-practice/`.

---

## 1. Paano nagma-map ang mga column mo

| Excel mo | GEM-ENI | Tala |
|---|---|---|
| CONTROL NO | **Asset tag** (`AST-MAIN-OFFEQ-2026-000001`) | Awtomatikong ginagawa. Ilagay ang luma mong control no sa **Notes** kung gusto mong mapanatili. |
| ASSET TYPE (Office Equipment) | **Item category** | Isang beses lang gagawin. |
| DESCRIPTION | **Item** (catalog) + **Notes** (asset) | Ang generic na produkto ay item; ang PO ref, check no., atbp. ay notes ng bawat asset. |
| UNIT (PCS) | Item **base UOM** = `PC` | Nandiyan na mula sa bootstrap. |
| QTY | **Quantity** sa Register dialog | Gagawa ng ganoong dami ng assets nang sabay. |
| PHP | **Acquisition cost** | **Bawat isa**, hindi kabuuan — tingnan ang §6. |
| USD / EUR | — | PHP lang ang sistema. |
| LOCATION (WAREHOUSE/ADMIN/HOUSE) | **Storage location** | Gawin itong storage locations sa ilalim ng warehouse mo. |
| END-USER | **Employee** + asset **assignment** | Dapat may employee record muna bago ma-assign. |
| REF PO / DATE OF PO / SUPPLIER | **Supplier** + notes | Para sa mga lumang asset, notes na lang. Ang mga bagong bili ay dapat dumaan sa Procurement. |

---

## 2. Ang pagkakasunod-sunod (may pinagsunod-sunurang dependency)

Hindi pwedeng magsimula sa assets — hindi ka papayagan ng sistema:

```
Branch ─► Warehouse ─► Storage locations (WAREHOUSE / ADMIN / HOUSE)
   │
   ├─► Item category (Office Equipment)
   │         │
   │         └─► Items (bawat natatanging produkto)
   │                    │
   └─► Employees ───────┴─► ASSETS ─► Assign sa end-user
```

Ganito ang gagawin sa app, sunod-sunod.

---

## 3. Mga gagawin nang isang beses (§Branches, §Lookups)

**Branch.** Branches → New. Kung iisa lang ang opisina ninyo, isa lang ang
gawin — hal. code `MAIN`, name "GemCor - Main Office". (Ang code na ito ang
nasa `branchCode` column ng employees CSV.)

**Warehouse.** Buksan ang branch → Add warehouse, hal. code `MAIN-WH1`.

**Storage locations.** Sa loob ng warehouse, gumawa ng tatlo na tugma sa
LOCATION column mo:

| Code | Name | Type |
|---|---|---|
| `ADMIN` | Admin Office | Room |
| `CONFERENCE` | Conference Room | Room |
| `WAREHOUSE` | Warehouse / Stockroom | Zone |
| `HOUSE` | Staff House | Area |

Nakahati sa dalawang grupo ang Type dropdown: **Rooms & areas** (Room, Office,
Area) para sa opisina, at **Warehouse** (Zone, Aisle, Rack, Shelf, Bin,
Receiving, Staging) para sa bodega. Opsyonal ang field — pwedeng Unspecified.

Kaya ring palalimin ang location (**Parent location** sa dialog): `ADMIN` →
"Accounting Desk" → atbp., kung kailangan ng mas detalyado mamaya.

**Department at Position.** Kailangan ito ng employees import. Lookups →
Departments: gumawa ng `ADMIN`. Positions: gumawa ng `STAFF`. (Dagdagan mo
ayon sa totoong istruktura ninyo.)

**Item category.** Lookups → Categories → New: code `OFFEQ`, name "Office
Equipment". Ito ang lalabas sa asset tag.

---

## 4. Employees at items

Dalawang paraan — pareho lang ang kinalalabasan:

- **Isa-isa sa app** (mas mainam kapag natututo pa lang, o kaunti lang ang
  ilalagay): Employees → New, at Items → New. Nakalista sa ibaba ang eksaktong
  field.
- **Bulk import** (Imports module): CSV/XLSX, mabilis kapag marami.

Walang asset import — **isa-isang ire-register ang mga asset** (§5).

### Employees

1. Imports → **Employees** → Download template (para makita ang eksaktong format)
2. Gamitin ang `Desktop/gemeni-practice/1-employees.csv` — nandoon na ang pitong
   end-user mula sa sheet mo
3. Upload → **Validate** → tingnan ang preview → **Commit**

Blangko ang `employeeNumber` kaya awtomatiko itong bibigyan ng `EMP-000001`
pataas. Siguraduhing tugma ang `branchCode` (`MAIN`), `departmentCode`
(`ADMIN`), at `positionCode` (`STAFF`) sa ginawa mo sa §3.

### Items

1. Imports → **Items** → Download template
2. Gamitin ang `2-items.csv` — isang row kada natatanging produkto (hindi kada
   pisikal na unit)
3. Validate → Commit

Mahalagang detalye: **`SERIALIZED_ASSET` + `SERIAL`** ang lahat. Ito lang ang
klase ng item na pwedeng gawan ng asset instance — tatanggihan ka ng sistema
kung iba.

Pansinin na **15 items lang** para sa 20 row ng Excel — ang limang CCTV row at
ang tatlong UPS ay iisang produkto lang na maraming unit.

---

## 5. Pag-register ng assets (isa-isa, pero may shortcut)

Assets → **Register**. Para sa bawat row ng
`3-asset-register-worksheet.csv`:

| Field | Ilalagay |
|---|---|
| Item | Ang catalog item |
| Branch / Warehouse | `MAIN` / `MAIN-WH1` |
| Storage location | `WAREHOUSE`, `ADMIN`, o `HOUSE` |
| Quantity | Dami ng unit — **5 para sa CCTV, 3 para sa UPS** |
| Acquisition cost | Halaga **bawat isa** |
| Condition | hal. Good |
| Notes | Luma mong control no, PO ref, check no. |

**Ang shortcut:** ang `Quantity` ay gumagawa ng maraming asset nang sabay, na
tig-iisa ang asset tag. Ang limang CCTV row mo ay **isang** registration lang.

### Laging Draft ang bagong rehistro

Hindi ito pinipili — **lahat ng bagong asset ay Draft**. Tatlong estado ang
dadaanan:

```
Register ──► DRAFT ──Activate──► AVAILABLE ──Assign──► ASSIGNED
```

Para maka-**Activate**, kailangang kumpleto ang tatlo: **warehouse**,
**condition**, at **serial number** (kung SERIAL-tracked ang item). Kung kulang,
sasabihin mismo ng error kung alin ang kulang.

Walang serial number ang Excel mo, kaya ito ang praktikal na daan:

1. I-register lahat bilang Draft ngayon (mabilis — walang hinahanap)
2. Maglakad-lakad na dala ang listahan, basahin ang serial sa likod ng bawat
   device, **Edit** ang asset at ilagay ito
3. **Activate** → nagiging Available

Ito mismo ang dahilan kung bakit may serial requirement — ang serial ang tanging
paraan para patunayan na *itong* pisikal na device ang nasa record. Pwede mo
ring laktawan ang hakbang 2 kung talagang walang serial ang isang item
(hal. coffee maker) — gawin na lang itong `BULK_NON_CONSUMABLE`.

---

## 6. Pag-assign sa end-user

Buksan ang asset → **Assign** → piliin ang employee + expected return date kung
meron. Magiging **Assigned** ito, at makikita sa kasaysayan kung kanino,
kailan, at sino ang nag-assign.

Ang mga walang END-USER sa sheet mo (aircon, coffee maker, label maker) ay
iiwan lang na **Available** — nasa warehouse, walang hawak.

---

## 7. Mga kailangan mong desisyunan

Tatlong bagay na hindi ko masasagot para sa'yo:

1. **₱12,500 para sa 5 memory card — kabuuan ba o bawat isa?** Inakala kong
   kabuuan (₱2,500 bawat isa). Ganoon din ang **UPS ₱4,350 × 3**. Ang
   acquisition cost sa sistema ay **bawat asset**, kaya kung kabuuan pala ang
   nakalagay sa Excel mo, hatiin mo muna.
2. **"Air conditioner, 2 Toner"** — "2 Tons" ba ang ibig sabihin (kapasidad)?
   Inayos ko sa items CSV bilang "2TR"; itama mo kung mali.
3. **`HOUSE` location** — staff house ba ito o ibang branch? Kung hiwalay na
   lugar na may sariling imbentaryo, mas tamang gawin itong **branch** kaysa
   storage location.

---

## 8. Mungkahi sa pag-practice

Huwag mo munang ilagay lahat ng 20. Subukan muna ang **tatlong magkakaibang
klase** para masubukan ang buong daloy:

| Subukan | Bakit |
|---|---|
| Printer Brother → assign kay Charlene | Pinakasimpleng daloy: isang unit, may end-user |
| CCTV TP-Link qty 5 | Masusubukan ang maramihang registration sa isang entry |
| Aircon (walang end-user) | Mananatiling Available — makikita mo ang pagkakaiba |

Pagkatapos: tingnan ang **Assets** list, i-print ang **QR labels** (Assets →
piliin → Print labels), at subukan ang **Scan** page gamit ang cellphone —
doon mo makikita kung bakit sulit ang lahat ng pag-eencode.

Kapag kuntento ka na sa daloy, pwede mong burahin ang mga nasubukan
(Archive) at ilagay nang tama ang buong listahan.
