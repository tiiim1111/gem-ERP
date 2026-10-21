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

## 2026-10-21 — 📋 HRIS employee integration: request document (hindi pa code)

Tim: "balak ko lahat ng related sa Employees module ipupullout nalang yung data sa database nung HRIS... Employees lang ha, di damay yung User, Roles... gawan mo ko ng prompt ng mga gusto mong i-request dun sa HRIS na mga data."

**Ginawa:** `docs/hris-employee-integration-request.md` — para sa HRIS team, English at self-contained (hindi nila kailangang alam ang GEM-ENI). Kasama: scope (in/out), tatlong delivery option, 16 na field na may dahilan bawat isa, reference-data mapping, behavioural contract, security, privacy, 9 na tanong, at ang hangganan ng trabaho ng bawat panig.

**Sinuyod muna ang totoong dependency bago humingi ng data** — kung hindi, kulang o sobra ang hihingin:

- `Employee` ay may **7 relation** na `onDelete: Restrict`: `assetsInCustody`, `assetAssignments`, `assetMovements` (from/to), `assetAcknowledgments`, `stockTransactions`, `workOrdersAssigned`. Hindi basta mawawala ang employee record.
- `separate()` ay **hindi humaharang** pero nagbabalik ng `outstandingAssets`; ang `archive()` ay kailangang clear na ang custody. Kaya hindi pwedeng basta i-archive ang separated na may hawak pang asset — nasa doc ito bilang eksplisitong "hindi namin gagawin".
- **Branch-scoped** ang employees (`assertBranchAccess`), at `branchId` ay **required** — kaya kailangan talaga ang branch per employee.
- Hindi pwedeng palitan ng HRIS ang Branch/Department/Position: nasa **asset tag** ang branch code (`AST-{BRANCH}-…`), at ang `Department.headEmployeeId` + `ApprovalStep.approverPositionId` ay nakaturo sa kanila. **Mapping** ang kailangan, hindi replacement — ito ang pinakamalaking panganib na masira ang system.
- `employeeNumber` at `workEmail` ay **`@unique`** — kaya may buong seksyon sa doc tungkol sa duplicate/shared email (`admin@…`), dahil ito ang tipikal na dahilan ng failed import.
- `EmployeeStatus` ay apat lang: ACTIVE/INACTIVE/SUSPENDED/SEPARATED — hinihingi ang **buong listahan** ng HRIS statuses para isang beses lang i-map, hindi hulaan.
- GEM-ENI-local at **hindi** dapat galing sa HRIS: `userId` (login link — eksplisitong sinabi ni Tim na huwag idamay), `notes` (restricted-visibility), `version`, `archivedAt`.
- May **repeatable-job infrastructure na** ang worker (BullMQ), kaya kasya ang nightly sync nang walang bagong infra.

**Codex pala ang katapat sa HRIS, hindi tao** (Tim: "ibato na natin mismo kay Codex"). Kaya ginawan ko ng hiwalay na build prompt: `docs/hris-employee-api-codex-prompt.md`. Self-contained — wala si Codex sa repo natin.

Iba ang hugis sa request document: hindi "pakisabi kung ano ang meron kayo" kundi **4-phase build instruction**, dahil kayang tingnan mismo ni Codex ang HRIS schema at sagutin ang 9 na tanong ko nang mag-isa:

1. **Discovery bago code** — may mga **aktwal na SQL** na dapat patakbuhin at i-report: `GROUP BY status` (totoong values + counts, hindi hula), duplicate `work_email`/`employee_number`, missing required fields, branch/dept/position code lists. Dito nakukuha ang dalawang bagay na humahadlang sa build natin.
2. **Build** — eksaktong contract, tugma sa `Paginated` envelope natin (`{data, meta}`) kaya kaunti lang ang mapping sa gilid natin.
3. **Verify with evidence** — kasama ang test na **pumapalya kapag may key na wala sa allowlist**, para hindi tahimik na makalusot ang bagong column sa HRIS table.
4. **Handover report** — ang mapping data na kailangan natin bago ang unang sync.

**Mga desisyong teknikal sa contract (may dahilan, hindi arbitrary):**
- **`ORDER BY updated_at, hris_id`** — hindi timestamp lang. Maraming row ang pareho ng timestamp (bulk update/import), at kapag walang stable tiebreaker ay **nagda-drop at nagdo-doble** ang records sa page boundaries. Ito ang pinaka-malamang na paraan na tahimik na mawalan ng data ang feed.
- **Raw status value ang ipapadala, hindi mapped** — tayo ang magma-map gamit ang proposal nila. Mas mabuti ang hindi kilalang raw value kaysa maling hula na naka-bake na sa feed.
- **Field allowlist, hindi denylist** (`SELECT` na pinangalanan, kailanman hindi `SELECT *`) — denylist ang gamit sa request doc para sa tao, pero sa agent na gumagawa ng code, allowlist ang tunay na garantiya.
- **Explicit UTC offset** (`...Z`) sa timestamps, `YYYY-MM-DD` sa dates — UTC ang storage natin, Asia/Manila ang display; dumaan na tayo sa timezone bug dati.
- **`null`, hindi `""`** sa walang laman — tunay na value ang `""` para sa GEM-ENI at susubukan nitong i-store.
- **Kasama ang separated employees** — isa ito sa pangunahing dahilan ng feed; huwag i-filter para lang maging malinis ang payload.
- **Walang 200 na may error body** — success ang 200 para sa sync job natin, kaya ang empty page ay maitatala bilang "walang pagbabago ngayon".

**Pending / Next:**
- **Hindi pa tinanggal ang "Add employee"** — sinadya. Kung tatanggalin ngayon, wala siyang paraan magdagdag ng employee habang wala pa ang feed. Dapat huli itong hakbang, pagkatapos gumana ang sync. Nakapitch kay Tim.
- Hinihintay ang sagot ng HRIS team sa 9 na tanong — lalo na ang **sample payload** at ang listahan ng status values; doon nakasalalay ang hugis ng sync.
- Hindi pa rin nakansela ang Railway Hobby subscription (kay Tim ito).

---

## 2026-10-15 (hapon) — 🐛 Subcategory blangko pa rin sa item edit + unang test tooling ng `apps/web`

Tim: "nacheck mo ba lahat ng fields sa items/? yung subcategory di talaga nagfefetch ng data kahit kakasave lang."

**Ibang bug pala ito, hindi dugtong ng nested-id fix kaninang umaga.** Tatlong bagay na sabay:

1. Uncontrolled `<select>` ang `CreatableSelect` — `registration` lang ang ibinibigay, walang `value` prop, kaya diretso sa DOM element isinusulat ng react-hook-form ang value.
2. `enabled: !!categoryId` ang `subcategoriesQuery`, at ang `categoryId` ay galing sa **kaparehong** `form.reset(itemToFormValues(item))`. Kaya sa sandaling isulat ang `subcategoryId`, placeholder pa lang ang tanging `<option>`.
3. **Tahimik na binabato ng browser ang value na walang katugmang `<option>`**, at wala nang muling nag-aapply pagdating ng listahan. RHF state tama pa (kaya hindi nawawala sa pag-save), pero blangko ang nakikita — kahit sa item na kakasave lang.

**Fix — `withSaved()`:** ipinapasok ang sariling naka-save na relation ng item sa bawat lookup list, kaya laging may katugmang `<option>` sa unang paint, anuman ang pagkakasunod ng pagdating ng mga request. Sakop nito ang category, subcategory, brand, manufacturer, at ang tatlong UOM field + dalawang dulo ng bawat conversion row. Bonus: nananatiling nakikita ang lookup na wala sa listahan (deactivated, o lampas sa `pageSize: 100`) kaysa tahimik na magblangko.

**Isang detalye na muntik nang makalusot:** ginawa kong `categoryId && categoryId === savedCategoryId` ang guard sa unang pasada — mali, dahil `''` pa ang `categoryId` sa commit na unang nakakita ng item, at **doon** kailangan nang nasa DOM ang option (bago tumakbo ang `reset()` sa passive effect, hindi pagkatapos). Naging `!categoryId || categoryId === savedCategoryId`. Nananatili ang pag-clear kapag ibang category ang pinili.

**Latent din pala ang karera sa Category/Brand/Manufacturer/UOM** — nagkataon lang na nauunang dumating ang maliliit nilang lookup request. Pinatunayan ito ng test: nagbablangko rin ang Category kapag ang item ang nauna.

**Bagong test tooling sa `apps/web`** (vitest + jsdom + @testing-library/react; `pnpm test` sa turbo, 4 na test). Dahil ito sa **pangatlong** bug ng ganitong uri na nakalampas: walang browser at walang test ang `apps/web`, kaya hindi nakikita ng `tsc`/eslint ang value na binabato ng browser sa runtime.

**Verification — pinatunayan talaga, hindi inangkin:**
- Dalawang beses akong nahuli ng sariling test: (a) `getByRole('option', {name})` ay **hindi** nagre-resolve ng `<option>` sa loob ng collapsed `<select>` sa jsdom → DOM option values na lang ang ini-assert; (b) mas masama — **pumasa ang 3 test dahil lang sa seeded option**, hindi pa dumarating ang listahan bago ang assertion. Hungkag na verification iyon. May `LIST_ONLY_SUBCATEGORY`/`LIST_ONLY_UOM` na lang ngayon na nasa fetched list lamang, at hinihintay ng `waitForListsToLand()` ang aktwal na pagdating — iyon ang sandaling nagbablangko ang luma.
- **Ni-revert ko ang fix at pinatakbo ang mga test: lahat ng apat pumalya**, eksaktong blangkong `item-subcategory` ang lumabas. Ibinalik ang fix → pumasa lahat.
- `pnpm test`: **510 API + 4 web = 514 passed**. web typecheck/lint/build ✅.
- Ibinalik ko ang formatting churn ng prettier sa `item-form.tsx` (95 file sa `apps/web` ang hindi pa prettier-compliant, kaya puro ingay lang iyon) — 76 linya na lang ang diff, puro fix.

**Sinuyod ang buong `apps/web` para sa parehong hugis** (uncontrolled select na `register(...Id)` + lookup list na galing sa query). Dalawa pa ang nakita:

- **`employee-form-dialog.tsx` — tunay na bug, pareho.** `enabled: open` ang branches/departments/positions, kaya sa **unang bukas** ng dialog ay kasabay ng `reset()` ang pag-umpisa ng tatlong list → nagbablangko ang **Branch (required!)**, Department at Position. Gumagana sa pangalawang bukas dahil cached na — kaya pala mukhang pabago-bago. May test; **pumapalya ito kung wala ang ayos**.
- **`conversions-tab.tsx` — makitid pero tunay.** Sa click handler ang `openEdit` reset, at maaaring tumama habang pending pa ang `uomsQuery`. Hinarang gamit ang parehong helper; sineseed ang `fromUom`/`toUom` ng row (ginagawa na pala ito ng table sa pamamagitan ng `fallback` argument ng `uomLabel` — kumpirmasyon na alam na ang isyu para sa display pero hindi para sa form).
- **Safe:** `location-dialog.tsx` (prop ang `locations`, nakaload na bago pa makabukas ang dialog), `supplier-form-dialog.tsx` (`taxId` ay `Input`, hindi lookup select). Controlled na ang `businessCategory`/`trackingMethod`/checkboxes ng item form (`value=` + `onChange`), kaya hindi apektado; text/money input ay anumang string ang tanggap.

Inilabas ang helper sa **`apps/web/src/lib/lookup-options.ts`** (`withSaved`), generic sa hugis ng input para hindi maluwagan ang `code: string` na kailangan ng UOM quick-add context.

**Pending / Next:**
- Wala pang sagot si Tim kung dagdagan pa ng test ang iba pang form.
- Hindi pa rin nakansela ang Railway Hobby subscription (kay Tim ito).

---

## 2026-10-15 — 🐛 Item edit: blangko ang Category, UOM, Brand at conversions

Tim: "upon clicking item, di nafefetch lahat ng info particularly sa Category, UOM."

**Root cause — mismatch sa hugis.** Ang `ITEM_LIST_SELECT` ay gumagamit ng Prisma **`select`**, kaya **nested object lang** ang ibinabalik (`category: {id,code,name}`, `baseUom: {…}`) at **walang flat `categoryId`/`baseUomId`**. Pero ang `toDefaults()` ng item form ay nagbabasa ng `item?.categoryId`, `item?.baseUomId` — laging `undefined`, kaya blangko ang pitong dropdown tuwing mag-e-edit. Ganoon din ang mga conversion row: ibinibigay ang `fromUom: {id,code}` pero hinahanap ang `fromUomId`.

**Bakit hindi nahuli ng TypeScript:** optional na nakadeklara ang mga flat ID (`categoryId?`), at ang `baseUomId: string` ay nakadeklarang **required** gayong hindi naman ito kailanman ipinapadala — kaya tahimik na pumapasa ang maling pagbabasa.

**Hindi apektado** (may nested fallback na): `items-page.tsx` (`if (item.category) …`), `purchase-order-editor.tsx` (`item?.purchaseUom?.id ?? item?.purchaseUomId ?? …`). **Hindi rin apektado ang conversion math**: ang `/uom-conversions` ay gumagamit ng **`include`**, hindi `select`, kaya kasama ang flat IDs doon.

**Fix:** nested-muna ang pagbabasa sa pitong relation field at sa dalawang conversion field; ginawang `baseUomId?: string | null` ang `Item` at `ItemRef` (**agad nitong nahuli ang isang hindi pagkakatugma sa `receive-page.tsx`** na naitama rin), at may komento na nagsasabing nested muna ang tamang pagkakasunod.

**Verification:** sa totoong API — kumpirmadong `undefined` ang `det.categoryId`/`baseUomId`/`brandId`, at pagkatapos ng ayos ay **lahat ng anim na field ay nare-resolve**; gumawa rin ng item-specific na conversion at kumpirmadong `undefined` ang flat `fromUomId` pero tama ang nested. web typecheck/lint/build ✅.

**Posibleng pinsala sa data:** `min(1)` ang `baseUomId` kaya **hinaharangan** ang pag-save — pero **plain `z.string()`** ang `categoryId`/`subcategoryId`/`brandId`/`manufacturerId`, kaya kung nakapag-save si Tim matapos muling piliin ang Base UOM, **tahimik na na-null** ang apat na yun. Binigyan siya ng query para hanapin ang mga item na nawalan ng category.

---

## 2026-10-14 (gabi 10) — Ipinantay ang dalawang hanay ng label (top-to-top, bottom-to-bottom)

Tim: "Pwede mo ipantay top to top, bottom to bottom para lang malinis tignan sa pagkakaprint?"

**Ang pagkakamali sa geometry:** magkaibang banda ang dalawang hanay. Sa 2×1, ang QR ay y 60–240 pero ang barcode ay nagsisimula sa y 30 at ang huling linya ay natatapos sa ~222 — kaya mas mataas magsimula ang kanan at mas mababa matapos ang kaliwa.

**Ginawa:** iisang banda na ang dalawa, at **naka-center sa stock** — 2×1: y 60–240 (60px margin sa itaas at ibaba); 3×2: y 150–450. Inilipat ang barcode sa parehong `y` ng QR at pinaikli (48px mula 70 sa 2×1), tapos inilaki ang body text (22px mula 20) at hinati ang natitirang taas sa apat na linya para dumapo ang huling linya sa paa ng QR.

Resulta sa karaniwang label ni Tim (1-linyang pangalan + 2-linyang ownership): **2×1 → QR 60–240, barcode top 60, huling text bottom ~240 — eksakto.** 3×2 → ~440 laban sa 450, nasa loob ng isang descender.

**Verification:** **510 tests** ✅ (+2: bagong `it.each` sa parehong sukat na nagbabantay na pantay ang simula ng barcode at QR, at ang huling baseline ay dumadapo sa paa ng QR sa loob ng isang descender). Buong typecheck/lint ✅.

**Tala:** ang mga posisyon ay **naayos, hindi dinamiko** — pare-pareho ang istraktura ng bawat label sa isang print sheet. Ang label na may 1-linyang ownership ay magkakaroon ng kaunting puwang sa ibaba; sinadya ito, dahil ang pabago-bagong posisyon ay mas magugulo sa isang sheet kaysa sa kaunting puwang.

---

## 2026-10-14 (gabi 9) — Label layout: word wrap at mas masikip na spacing

Tim, pagkatapos ng org-name change: lumalampas sa gilid ang "Property of GEM Investment Co" — "Macocompress ba natin yung spacing? Tapos 2 lines ang Asset name pati property?"

**Root cause:** ang item name lang ang may `truncate()`; **walang anumang limitasyon ang ownership line**, kaya ini-render ito nang buo at tumatakbo palabas ng label stock. Hindi ito lumabas noon dahil mas maikli ang "Property of GemCor".

**Ginawa:**
- **`wrapLines()`** — greedy word wrap na may hangganang bilang ng linya; kapag may natirang teksto, ellipsis sa huling linya (ang lumalampas ay naipi-print sa wala, kaya ang pagputol ang ligtas na pagpalya). Kinakaya ang salitang mas mahaba pa sa linya.
- **`layoutText()`** — isang top-down na layout na ginagamit ng **parehong** renderer, kaya ang naka-wrap na item name ay **nagtutulak pababa** sa ownership line imbes na magpatong.
- **Hinigpitan ang spacing**: 2x1 ay 120/154/190/216 (dati 140/190/240 na may tatlong linya lang); mas maliit na font para sa katawan (20px) kaysa sa tag (24px) para may silid sa apat na linya.
- **Budget ng lapad**: 30 chars (2x1) at 27 (3x2), kinuwenta mula sa **PNG bitmap font** (`6 × scale` kada char) dahil mas malapad ito kaysa sa proporsyonal na font ng SVG — kung kasya sa PNG, kasya sa SVG.

**Verification:** **508 tests** ✅ (+4: wrap ng mahabang pangalan, ellipsis kapag ubos na ang dalawang linya, **bawat linya ay nasa loob ng budget**, at ang naka-wrap na pangalan ay nagtutulak pababa sa susunod na block). Sinilip ang totoong render sa parehong sukat — tama ang posisyon at naghahati na ang mahabang pangalan ng kompanya. Buong typecheck/lint ✅.

---

## 2026-10-14 (gabi 8) — Ang ownership line sa label ay galing na sa organization record

Tim: "Baka instead na GemCor, pwede natin palitan ng GEM Investment Corp. May way ba sa frontend?" Sagot: wala — `PROPERTY_LINE` ay hardcoded sa `label-render.ts`, at walang organization settings UI (branches lang ang may CRUD). Binigay ang dalawang opsyon; **pinili ni Tim ang B** (kunin sa database) kaysa sa pagpapalit lang ng nakasulat na teksto.

**Ginawa:** `LabelData` ay may bagong opsyonal na `propertyLine`; ang dating constant ay naging `DEFAULT_PROPERTY_LINE` na fallback na lang, at may `propertyLineOf()` helper (nagfo-fallback din kapag puro espasyo). Parehong gumagamit nito ang SVG at PNG renderer. Sa `LabelService.loadLabelData()`, isang query sa `organization` kada batch → `Property of {name}`; kung walang organization row, babalik sa fallback.

**Verification:** **504 tests** ✅ (+2: sinusunod ang ibinigay na linya; nagfo-fallback kapag blangko). Live sa totoong container: nag-render ng label → **"Property of GemCor"** → pinalitan ang `organizations.name` → nag-render ulit → **"Property of GEM Investment Corp."** nang walang rebuild o restart. Buong typecheck/lint ✅.

**Paano palitan:** `UPDATE organizations SET name = '...'` o `seed:prod` na may `ORG_NAME` — pareho silang gumagana dahil ang database na ang pinagmumulan.

---

## 2026-10-14 (gabi 7) — Actions dropdown sa asset detail

Tim: masikip ang header ng asset detail — "pasok mo nalang sa dropdown/Action button? para malinis lang tignan". Lehitimo: ang `visibleActions` ay umaabot ng sampu o higit pa (Reserve, Assign, Report damage/loss, Send to inspection/maintenance, Retire, Dispose…), at nabubulok ang mismong detalye ng asset sa ilalim ng hanay ng mga button.

**Ginawa:** tatlo na lang ang nakikita — `← All assets`, `Edit`, at **`Actions ▾`**. Nasa loob ng dropdown ang Acknowledgment form at lahat ng lifecycle action (destructive ay pula via `destructive` prop ng `DropdownMenuItem`). **Naiwang nakikita ang "Acknowledge receipt"** — prompt ito na nakatutok sa isang tao at lumalabas lang sa kanya, kaya hindi dapat nakatago.

**Dagdag na refactor:** ang `PrintDocumentButton` ay button lang, kaya hindi magamit sa loob ng menu. Hinati sa **`usePrintDocument()` hook** (fetch + popup fallback + error handling) at manipis na button wrapper sa ibabaw nito — walang nabagong behavior sa limang ibang gumagamit (PO, GR, transfer, work order, count sheet). Tinawag ang hook **bago ang loading/error returns** para stable ang hook order.

**Verification:** web typecheck ✅, lint ✅, build ✅.

**Nakabinbin:** tanong ni Tim kung mapapalitan ang "Property of GemCor" sa labels. Nahanap: hardcoded bilang `PROPERTY_LINE` sa `label-render.ts:27`, at **walang organization settings UI** (branches lang ang may CRUD). Naibigay sa kanya ang dalawang opsyon; hinihintay ang pili.

---

## 2026-10-14 (gabi 6) — Nabuksan ang "Serial number required" para sa kasangkapang walang serial

Habang ini-encode ni Tim ang mga upuan (BLK + SERIAL), nakita kong tatamaan niya ang pader sa Activate: `requiresSerialNumber` ay awtomatikong `true` para sa SERIAL tracking, at **disabled + readOnly ang checkbox sa UI**. Hinihingi ng `assertActivatable()` ang serial bawat unit bago maging Available — pero walang manufacturer serial ang upuan at mesa.

Kaya na ito ng API (`update-item.dto.ts:146` ay may `requiresSerialNumber?`), hindi lang nabuksan sa form. Ngayon: nae-edit na ito kapag SERIAL ang tracking (disabled pa rin kung hindi), at sinasabi ng helper text kung kailan ito aalisin — "untick for things with no manufacturer serial — furniture, fixtures". Nananatili ang default na `true` kapag pinili ang Serial; pinipili lang ni Tim kung aalisin.

Mahalaga: **hindi ito nagbabawas ng per-unit tracking** — may sariling asset tag, custody, at QR pa rin ang bawat upuan. Ang serial lang ang hindi hinihingi sa activation.

**Verification:** web typecheck ✅, lint ✅, build ✅.

---

## 2026-10-14 (gabi 5) — 🐛 Register assets: "Cannot read properties of undefined (reading 'slice')"

Tim: pumuputok ang Register assets dialog sa quantity **8**.

**Root cause — mismatch sa response shape, hindi sa logic.** Ang `POST /assets` ay nagbabalik ng **dalawang magkaibang hugis** (`assets.controller.ts:88`): ang asset mismo kapag isa lang, at `{ assets, count }` kapag maramihan. Ang client ay gumagawa ng `Array.isArray(created) ? created : [created]` — kaya ang bulk response ay nababalot bilang **isang** "asset", pumapasok sa single-asset branch, at tumatawag ng `assetTag()` dito. Sa `types.ts:975`: `asset.assetTag ?? asset.tag ?? asset.id.slice(0, 8)` → walang `id` ang wrapper → **`undefined.slice`**.

Hindi ito nahuli ng TypeScript dahil **nagsisinungaling ang return type**: nakadeklara ang `registerAsset` na `Promise<Asset | Asset[]>` samantalang `Asset | {assets, count}` talaga ang ibinabalik.

**Mahalaga:** **matagumpay ang registration sa server** — nalilikha ang mga asset; sa pag-format lang ng success message pumuputok ang client. Kaya ang bawat failed na pagtatangka ni Tim ay **nag-iwan ng totoong draft assets**. Naituro sa kanya na tingnan ang Assets list para sa dobleng entry.

**Fix:** (1) itinama ang return type at nagdagdag ng `registeredAssets()` normalizer sa `endpoints.ts` na kayang hawakan ang lahat ng tatlong hugis; (2) ginagamit na ito ng dialog; (3) pinatibay ang `assetTag()` — `asset?.id?.slice(0, 8) ?? '—'`, para kahit anong hugis ay hindi na magpapaputok habang nagfo-format ng mensahe.

**Verification:** pinatakbo ang totoong API sa loob ng container at ini-inspeksyon ang mismong response — **quantity=1 → `id,assetTag,…`; quantity=3 → `assets,count`**, eksaktong tugma sa diagnosis. Sinubukan ang normalizer laban sa parehong totoong hugis (at sa array) — tama ang count at tag sa lahat. web typecheck/lint/build ✅.

**Aral:** ang endpoint na nagbabalik ng magkaibang hugis ayon sa input ay kailangang may normalizer sa client boundary — huwag hayaang manghula ang bawat call site.

---

## 2026-10-14 (gabi 4) — 🐛 Quick-add: nagti-trigger ng submit sa Item form ang pag-save ng lookup

Tim: pagka-save ng bagong category/UOM sa modal, **nagti-trigger din ang save ng Create Item** — lumalabas ang validation errors sa mga blangkong field.

**Root cause:** may sariling `<form>` ang `QuickAddLookupDialog`, at ito ay nire-render mula sa LOOB ng form ng Item. Naka-`createPortal` ang Dialog, kaya tama ang DOM (hiwalay na ang inner form sa `document.body`) — **pero pinapadaloy ng React ang synthetic events paakyat sa COMPONENT tree, hindi sa DOM tree**. Kaya umaabot pa rin sa `onSubmit` ng item form ang submit ng modal. Klasikong portal gotcha.

**Fix:** `event.stopPropagation()` (kasama ang `preventDefault`) sa submit handler ng dialog. Tugma ito sa umiiral nang pattern ng repo — ganito rin ang ginagawa ng `dialog.tsx`, `sheet.tsx`, at `combobox.tsx` para sa Escape. Napanatili ang `<form>` kaya gumagana pa rin ang Enter-to-submit sa loob ng modal.

**Dagdag na linis:** tinatawag ang `form.register('code')` sa loob mismo ng `onChange` (re-register kada keystroke) — iniahon sa isang `codeRegistration` const.

**Sinuri rin:** ang quick-add lang ang may nested `<form>`; ang `ConfirmDialog` sa item form ay buttons lang, walang form, kaya walang parehong sakit.

**Verification:** web typecheck ✅, lint ✅, build ✅. **Hindi pa na-click-through** — walang browser tooling at walang frontend test setup ang `apps/web` (walang jest/vitest). Inalok kay Tim ang pagdagdag nito kung gusto niyang mahuli nang awtomatiko ang ganitong klase ng bug.

---

## 2026-10-14 (gabi 3) — SKU: tinanggal ang prefix, tapos pinalitan ng business category; quick-add sa lookups

Tatlong magkakasunod na hiling ni Tim sa SKU, tapos ang "Add new" sa dropdowns.

**1. Branch sa SKU — hindi itinuloy (validated).** Mungkahi ni Tim: `BRANCH-CAT-SEQ`. Tinanggihan ko ito nang may dahilan: **walang `branchId` ang Item** — iisang catalog entry na ginagamit ng lahat ng branch. Ang `StockBalance` ay `(item, warehouse, location, lot)`, at ang transfers ay paglilipat ng parehong item sa pagitan ng branch. Ang branch sa SKU ay magsisinungaling o magpipilit ng dobleng catalog kada branch. Tanggap ni Tim; **nasa asset tag na ang branch** (`AST-{BRANCH}-{CAT}-{YYYY}-{SEQ6}`), na siyang tamang lugar nito.

**2. Tinanggal ang `SKU-` prefix** → `{CAT}-{SEQ5}`. Pinanatili ang pangalan ng sequence counter (`SKU-{CAT}`) para **hindi mag-reset sa 1** ang numbering. Verified live: `LAP-00003`.

**3. Business-category prefix** → `{BIZ}-{CAT}-{SEQ5}`. Hiling ni Tim ang `AST/CON/BLK`; **pinalitan ang AST ng SRL** dahil sa `scan.service.ts:122` — anumang `AST-` ay dinadala muna sa asset-tag lookup. Hindi naman ito nasisira (dumadaloy pababa sa SKU resolution), pero magkapareho ang simula ng item SKU at asset tag sa lahat ng listahan at report. Pumili si Tim ng `SRL`. May `GEN` fallback kung may madagdag na bagong business category. Verified live: **SRL-LAP-00003, CON-OFC-00004, BLK-FUR-00002**. Tala: nababago ang `businessCategory` hangga't walang stock/asset pero permanente ang SKU — naituro kay Tim ang makitid na bintanang ito.

**4. Quick-add sa lookup dropdowns** (`components/lookups/quick-add-lookup.tsx`): `CreatableSelect` + `QuickAddLookupDialog`. Dahil hindi makapaglagay ng button ang `<select>`, isang sentinel na option (`__add_new__`) ang hinaharang ng change handler at ibinabalik ang dating halaga bago buksan ang modal — kaya walang naitatalang basurang halaga. Pagkatapos mag-save: ini-invalidate ang query ng listahang yun at **awtomatikong pinipili ang bagong halaga**; buo ang form state dahil nasa parehong page lang. Naka-gate sa `lookup.manage` (itinatago ang option kung wala) at sa parent category para sa subcategory. **Espesyal ang UOM**: may opsyonal na conversion factor papunta sa base UOM — ang bagong unit na walang conversion ay hindi makakapag-compute ng quantity; kung pumalya ang conversion, nananatili pa rin ang unit at may babala.

Naka-wire sa pitong dropdown ng Item form: Category, Subcategory, Brand, Manufacturer, at tatlong UOM.

**Verification:** api build ✅, **502 tests** ✅ (+2 bago: walang AST collision, GEN fallback), web typecheck/lint/build ✅, kumpirmadong nasa bundle ang bagong UI. **Hindi pa na-click-through** — walang browser tooling dito, kailangan ng biswal na pagsubok ni Tim.

---

## 2026-10-14 (gabi 2) — 🐛 Na-stuck ang update script sa "Waiting" — hindi na-reload ang proxy config

Tim: na-stuck sa `[3/4] Waiting for the app to answer...`. Nasilip ko ang prod: **502 ulit**.

**Root cause (gap sa script ko, hindi sa nginx config):** sa output niya, `web` ay **Started** (bagong IP) pero `proxy` ay **Running** — hindi ni-recreate. Na-pull nga ang bagong `gemeni.conf`, pero **binabasa lang ng nginx ang config sa startup**, at **hindi nakikita ng Compose na nagbago ang LAMAN ng isang bind-mounted na file** (hindi nagbago ang container spec). Kaya luma pa rin ang config sa memory — ang mismong `resolver` fix na dapat sana ang umaayos nito ay hindi kailanman na-load. Umiikot lang ang health loop ko hanggang 3 minuto.

**Fix:** `restart proxy` pagkatapos ng `up -d --build`, **tuwing update**. Isang segundong downtime, kapalit ang katiyakan na tugma ang na-deploy na config sa file sa disk. Pinaghiwalay din ang failure hint (`logs web` vs `logs proxy`) para malaman agad kung alin ang sira.

**Verification — ginaya ang eksaktong pagkasira:** nilagay ang LUMANG config (`git show a1870d0^`), binuhay ang stack (200 ✅) → ipinalit ang bagong config sa disk (gaya ng git pull) → pinilit lumipat ng IP ang web (squatter container) → **502 ✅ naulit ang bug**. Pinatakbo ang inayos na script → **200** ✅. Tapos pinilit ulit lumipat ng IP nang hindi ginagalaw ang proxy → **200 pa rin** ✅, patunay na aktwal nang naka-load ang resolver config.

**Aral:** ang `docker compose up -d` ay hindi nagre-reload ng config na naka-bind-mount. Anumang serbisyong nagbabasa ng config file sa startup ay kailangang tahasang i-restart tuwing deploy.

---

## 2026-10-14 (gabi) — `update-gemeni.sh`: isang command na pang-update ng prod

Tim: "Pahingi ng pang update sa prod if may changes."

**Nasilip muna ang prod:** live na ang bagong brand panel (a4ad386), pero **kulang pa ng 4 na commit** — kasama ang `a1870d0` (ang permanenteng 502 fix). Ibig sabihin `restart proxy` lang ang ginawa niya noon, kaya luma pa ang nginx config doon at **babalik sana ang 502 sa susunod niyang rebuild**. Ang script ay nagpu-pull bago mag-build, kaya naaayos ito sa parehong takbo.

**Bago:** `scripts/update-gemeni.sh` — git pull (`--ff-only`), **ipinapakita kung anong commit ang ide-deploy**, build + up, **naghihintay hanggang sumagot ang app sa pamamagitan ng proxy** (hanggang 3 min, may malinaw na error at `ps` kung bigo), tapos status + ang URL mula mismo sa `.env.prod`. Overrides: `REPO_DIR`, `ENV_FILE`, `SKIP_PULL=1`.

**Verification:** `bash -n` ✅, tapos **totoong pinatakbo laban sa test stack** — nag-build, nagsimula, "Up after 2 check(s)", tamang status table, at tamang URL sa dulo; pagkatapos kumpirmadong HTTP 200 at bagong UI ang sinisilbi. Na-update ang day-2 table ng guide para ituro ang script.

---

## 2026-10-14 (later) — Locations per branch: sinuri, may meron na; dinagdagan ng room types

Tim: gusto ng per-branch locations (ADMIN, CONFERENCE, WAREHOUSE) at humingi ng pitch muna — "make sure na di masisira ang system".

**Natuklasan sa pagsusuri:**
- **Meron na**: `Branch → Warehouse → StorageLocation`, at ang StorageLocation ay may **`parentId` (nesting)** at **`barcode`** (para sa scan).
- **Hadlang sa literal na hinihingi**: `StorageLocation.warehouseId` ay NOT NULL. Ang paggawa nitong nullable ay sisira sa inventory engine — ang `StockBalance` ay naka-key sa **(item, warehouse, storage_location, lot)**, at warehouse-scoped din ang ledger entries, transaction lines, at reservations. Magkakaroon ng balance na walang warehouse at mawawalan ng target ang location resolution ng posting engine. Hindi sulit para sa isang bagay na pangalan lang.
- **`locationType` ay free-form string sa server** (uppercase, max 30) — ang UI dropdown lang ang naglilimita sa 7 warehouse-ish na halaga.

**Pitch (tinanggap ni Tim):** gamitin ang kasalukuyang modelo — isang "site" warehouse kada branch, ang mga kwarto ay storage locations — at dagdagan lang ang UI type list. **Walang schema change, walang migration.**

**Ginawa:** `LOCATION_KINDS` → `LOCATION_KIND_GROUPS` sa `location-dialog.tsx`, naka-`<optgroup>`: **Rooms & areas** (ROOM/OFFICE/AREA) at **Warehouse** (dating 7). Isang file lang ang nagalaw. Na-update din ang §3 ng encoding guide.

**Verification:** web typecheck ✅, lint ✅, build ✅, at kumpirmadong nasa built bundle ang bagong optgroups.

**Hindi ginawa (sinadya):** ang pagpapalit ng salitang "Warehouse" → "Site" sa UI. Tatama ito sa inventory, transfers, counts, at reports — hiwalay na usapan kung makakalito pa rin pagkatapos subukan.

---

## 2026-10-14 — 📋 Guide: paglalagay ng totoong asset register sa sistema

Nagpadala si Tim ng screenshot ng totoong Excel asset register ng GemCor (20 row ng office equipment: aircon, printers, laptops, CCTV, server, UPS — may PHP values, LOCATION, at END-USER) at humingi ng guide para makapag-practice.

**Sinuri muna sa code bago sumulat:**
- Import types: **employees, items, lookups lang — WALANG asset import**, kaya isa-isa ang assets.
- `POST /assets` (register-asset.dto) ay may **`quantity` + `serialNumbers[]`** — maramihang asset sa isang entry. Nasa UI ito (`asset-register-dialog.tsx`).
- `registerAssets()` ay **tumatanggi sa item na hindi `trackingMethod = SERIAL`** — kaya dapat SERIALIZED_ASSET + SERIAL ang items.
- `assertActivatable()`: ang serial ay kailangan **lang kapag AVAILABLE ang initial status**; ang DRAFT ay walang hinihingi. Ito ang susi sa praktikal na daloy dahil walang serial ang Excel ni Tim.

**Ginawa:**
- `docs/encoding-asset-register.md` — column mapping (CONTROL NO → auto asset tag, LOCATION → storage location, END-USER → employee assignment), ang dependency chain (branch → warehouse → locations → category → employees → items → assets → assign), bulk import steps, register-with-quantity shortcut, **Draft-ngayon-serial-mamaya** na daloy, at 3-row na practice plan.
- `Desktop/gemeni-practice/` (hindi naka-commit — totoong pangalan at halaga): `1-employees.csv` (7 end-user), `2-items.csv` (15 item — pinagsama ang 5 CCTV row at 3 UPS), `3-asset-register-worksheet.csv` (checklist kada row). **Na-verify na byte-exact ang headers** laban sa `IMPORT_TYPES`.

**Nilinaw kay Tim ang tatlong hindi ko masasagot:** kabuuan ba o bawat isa ang ₱12,500 sa 5 memory card (at ₱4,350 sa 3 UPS) — per-unit ang acquisition cost sa sistema; "2 Toner" ba ay "2 Tons"; at kung ang `HOUSE` ay dapat storage location o hiwalay na branch.

---

## 2026-10-13 (later) — 🐛 502 Bad Gateway sa prod: naka-cache na upstream IP ng nginx

Tim pagkatapos ng unang deploy na may proxy: "nag bad gateway pre after this?"

**Diagnosis:** nasilip ko mula sa laptop — `http://192.168.0.50/login` → **502 na may nginx error page** (buhay ang nginx), port 3000 sarado mula sa LAN (tama — localhost-only na ito ngayon). Ang container status niya ang nagturo sa sagot: **`proxy` Up 13 minutes, `web` Up 5 minutes** — na-recreate ang web matapos mag-start ang nginx. Malusog ang web logs ("Ready in 382ms"), sagana ang RAM at disk.

**Root cause:** sa static na `upstream { server web:3000; }` block, **minsan lang nagre-resolve ng DNS ang nginx — sa startup**. Bawat `up -d --build` ay nagbibigay ng bagong IP sa web container; patuloy na kinakausap ng nginx ang patay na IP → 502 hanggang i-restart nang manu-mano ang proxy. Hindi ito lumabas sa unang pagsubok ko dahil sabay silang binuhay noon.

**Fix:** tinanggal ang `upstream` block; `resolver 127.0.0.11 valid=10s ipv6=off;` (embedded DNS ng Docker) + variable sa proxy_pass (`set $gemeni_web "http://web:3000"; proxy_pass $gemeni_web$request_uri;`). Ang variable ang pumupwersa ng per-request resolution; kailangan ang tahasang `$request_uri` dahil hindi na awtomatikong idinudugtong ng nginx ang URI kapag may variable ang proxy_pass. Kapalit: nawala ang upstream keepalive — tinanggap ko ito, mas mahalaga ang tama kaysa sa micro-optimization sa LAN app.

**Verification (tunay na sinubukan ang pagpalya):** binuhay ang stack (proxy 200 ✅) → **pinilit lumipat ng IP ang web** (`rm -sf web`, pinaupo ang isang squatter container sa lumang `172.21.0.8`, binalik ang web → nakakuha ng `172.21.0.9`) → **200 pa rin ang proxy nang hindi ito ginagalaw** (3 sunod-sunod na request). Dating 502 ito. Dahil nagbago ang URI handling, pinatakbo ang bagong `smoke-proxy.mjs`: static page, POST + JSON body, **query string (`?pageSize=3` → eksaktong 3 rows**, patunay na hindi nalalaglag ang query), path params, multipart upload, byte-identical binary download, PDF — lahat pumasa. Naging `healthy` ang proxy healthcheck.

Dinagdagan ng **502 row** ang troubleshooting table ng guide (mabilis na ayos + permanenteng ayos).

---

## 2026-10-13 — Login brand panel: centered hero, mas malaking logo/title, bagong pangalan

Tim: "Ganda na ng login page, pwede mo center yung mga contents tas lakihan si logo at Title? yung GemCor sa baba palitan mo ng Green Energy Machineries ERP & Inventory Systems. Tapos the rest nasa left side nalang."

- **Hero centered at naka-stack** (dating magkatabi ang logo at wordmark): logo `h-24 → sm:h-28 → lg:h-36` (dating `h-12/h-16`), "GEM-ENI" `text-4xl → lg:text-5xl` (dating `text-2xl/3xl`).
- **"GemCor" → "Green Energy Machineries ERP & Inventory Systems"**. Tinanggal ang dating `<h1>ERP & Inventory Management</h1>` — doble na ito sa bagong pangalan.
- **Ang natitira ay nasa kaliwa pa rin**: left-aligned ang highlights list, pero ang block ay naka-center kaya pantay ang kaliwang gilid nito sa ilalim ng hero. Ang footer notice ay ginawang centered para tumugma sa hero.

**Verification:** web typecheck ✅, lint ✅, build ✅. Sinilip ang totoong render sa `next start`: nandoon ang bagong pangalan, **wala nang "GemCor"** at **wala nang dobleng "ERP & Inventory Management"** sa brand panel, at tama ang bagong laki ng logo/title.

**Tala:** hindi pa na-deploy ni Tim ang mga nauna — noong huling check (2026-09-22) ay luma pa ang tumatakbo sa 192.168.0.50 (port 3000 bukas, 80 sarado, lumang login page). Isang `git pull` + rebuild ang kukuha ng UI pass, ng nginx proxy, at nito.

---

## 2026-09-17 (gabi 5) — 🔀 nginx reverse proxy: walang port number sa URL

Tim: "paano natin sya gawin na nakaproxy na at wala ng port number tsaka laging nakarun using pm2." Tinanong ko ang runtime (pm2 ay ibang process manager — ilalabas nito ang 3 apps sa Docker; ang auto-restart at auto-boot ay ginagawa na ng Docker). Pinili niya ang **Docker + nginx proxy**, walang pm2.

**Bago:**
- **`deploy/nginx/gemeni.conf`** + `proxy` service (nginx:1.27-alpine) sa compose, naka-mount read-only. Isang upstream lang (`web:3000`) dahil ang Next.js na mismo ang nagfo-forward ng `/api/v1`. Mahahalagang setting: **`client_max_body_size 25m`** (ang 1 MB default ay magtatanggi ng attachments — 413), **`X-Forwarded-Host`/`Proto`** (ginagamit ng CSRF guard ng API — mali ito = walang makaka-login), **`proxy_buffering off`** (dumidiretso ang streamed downloads/PDF), 300s timeouts para sa mabibigat na report queries, gzip.
- **Topology binago:** `proxy` lang ang nakalabas sa LAN (`${HTTP_PORT:-80}:80`); ang `web` ay `127.0.0.1:3000` na lang — hindi abot mula sa ibang PC pero gumagana pa rin ang lahat ng diagnostic curl sa server mismo.
- `.env.prod.example`: `WEB_PORT` → **`HTTP_PORT=80`**, at `WEB_ORIGIN` na walang port.

**Verification (totoong stack, proxy sa 8090):** 7 services up, `proxy` healthy → **buong smoke sa pamamagitan ng nginx** lahat pumasa: login (cookie at CSRF nakadaan sa proxy), dashboard, attachment upload+download byte-identical, export job end-to-end, PO PDF. Dagdag na pagsubok sa laki: **5 MB upload = 201** (dating imposible sa 1 MB default ng nginx).

**Nadiskubre habang nagte-test — pre-existing na bug, inayos:** ang upload na lampas sa 20 MB cap ng API ay lumalabas na **"Unhandled exception … Request aborted" → 500** sa log. Hindi ito kagagawan ng nginx. Ang `AllExceptionsFilter` ay walang alam sa multipart failures, kaya ang pagkakamali ng client ay naitatala bilang server fault. Dinagdagan ng `asUploadFailure()` (MulterError `LIMIT_FILE_SIZE` → 413 PAYLOAD_TOO_LARGE, ibang MulterError → 400, `"Request aborted"` → 413 na may malinaw na mensahe). Verified live: **wala nang "Unhandled exception" sa log**. Tala: ang browser ay nakakakuha pa rin ng generic failure sa ganitong kaso dahil sinisira na ng multer ang socket bago makasagot ang Express — pero **hindi ito naaabot ng totoong users**: may sariling 20 MB check ang `attachments-panel.tsx` bago pa mag-upload.

**Guide:** bagong architecture diagram na may nginx, §7 firewall → port 80, §10 pinalitan ng "Ang proxy (nginx)" (ano ang ginagawa nito, paano mag-HTTPS), dagdag na troubleshooting rows para sa 413 at para sa nginx-vs-web na paghihiwalay (`curl http://localhost/login` vs `curl http://localhost:3000/login`).

**Verification:** api build ✅, **499 tests** ✅, lint ✅.

---

## 2026-09-17 (gabi 4) — 🎨 UI pass: sidebar, login page, splash, skeletons

Apat na hiling ni Tim: (1) rework ang side nav at scrollbar — professional at minimalist; (2) redesign ang login — blue na bg, logo+pangalan sa kaliwa, sign-in box sa kanan; (3) `user@gemcor.ph` ang email placeholder; (4) splash screen, skeletons, at loaders para interactive ang pakiramdam.

**1. Sidebar** (`app-shell.tsx`, `globals.css`): bagong `.nav-scroll` — hairline na 6px scrollbar na lumalabas lang kapag naka-hover/focus (ang default na makapal at maputing scrollbar ang mukhang magaspang sa madilim na rail; hinahayaan ang overlay-scrollbar na platforms sa native nila). Mas magaan na rows: 13px na text, `space-y-px`, inactive icons na naka-55% opacity, at **active marker na maliit na primary-blue tick sa rail** imbes na buong bukol na background sa bawat row. Section headers: 10px, 0.12em tracking, 45% opacity. Dinagdagan ng `border-r` ang aside at ginawang `bg-background/85 backdrop-blur` ang topbar.

**2. Login** (`(auth)/layout.tsx`, `login/page.tsx`, `globals.css`): split layout — kaliwa ay `.auth-brand` (radial highlights sa ibabaw ng diagonal gradient: `hsl(221 83% 40%)` → `hsl(224 62% 17%)`, may lalim kahit walang image asset) na may logo, GEM-ENI, GemCor, "ERP & Inventory Management", tatlong highlight, at audit-log notice sa ibaba; kanan ay ang sign-in box sa light background. Nagsa-stack sa phone (nagiging banner ang brand panel, nakatago ang highlights). Nasa layout ito, hindi sa page, kaya makukuha rin ng future auth pages.

**3. Placeholder** → `user@gemcor.ph` (ito lang ang natitirang `gemcor.dev` sa web).

**4. Splash + loaders**: bagong `AppSplash` (logo, wordmark, indeterminate sweep bar) na gumagamit ng parehong blue ng login — kaya tuloy-tuloy ang daloy mula sign-in papasok sa app imbes na kumislap na blangkong page. Ginagamit sa Suspense fallback ng dashboard layout at sa session check (dating maliit na spinner). **Ni-upgrade ang `Skeleton` mismo** ng sweeping shimmer (`motion-reduce` → pulse) — **awtomatikong nakikinabang ang lahat ng existing skeleton sa buong app**. Bagong `TableSkeleton` at `PageSkeleton`, at `(dashboard)/loading.tsx` para sa route transitions — may istraktura nang dinadatnan ang navigation.

**Verification:** web typecheck ✅, lint 0 ✅, build 41/41 pages ✅. Sinilip ang totoong render sa `next start`: nandoon ang `auth-brand` markup, ang tatlong highlight, at ang audit notice; kumpirmadong na-compile ang `.auth-brand` gradient, ang `.nav-scroll` rules, at ang `progress-sweep`/`shimmer` animations; nasa client bundle ang `user@gemcor.ph`. (Walang browser tooling dito — kailangan ng biswal na tingin ni Tim.)

---

## 2026-09-17 (gabi 3) — 🧹 Production bootstrap: walang demo data, walang hardcoded credentials

Tim: "Clear na natin data sa prod. Then gawin natin superadmin@gemcor.ph ang username ng superadmin, remove lahat ng mga hardcoded na values sa prod." Follow-up: "Except pala nung lookups, retain mo lang."

**Nasuri muna:** kaya nang gawin sa UI ang branches, warehouses, at storage locations (`branch-form-dialog.tsx`, `warehouse-dialog.tsx`, `location-dialog.tsx` + POST endpoints sa org controllers), kaya hindi na kailangang mag-seed ng imbentong org structure.

**Bago:**
- **`packages/database/src/baseline.ts`** — ang tunay na *structural* na bahagi, ginagamit ng dev seed AT ng production bootstrap para hindi mag-drift: organization, permission catalog, system roles, lookup vocabulary (§10 + SUPPLIER_CATEGORY/RETURN_REASON), UOMs + conversions, `hashPassword`.
- **`packages/database/src/seed-production.ts`** (`pnpm db:seed:prod`) — **walang anumang hardcoded na email o password**. `SUPERADMIN_EMAIL` ang tanging required; kung walang `SUPERADMIN_PASSWORD`, gagawa ng 24-char na random, ipi-print nang **isang beses**, at itatakda ang `mustChangePassword=true`. Optional overrides: `SUPERADMIN_NAME`, `ORG_CODE/NAME/TIMEZONE/CURRENCY`. Idempotent; hindi binabago ang password ng account na umiiral na (safe re-run para mag-sync ng bagong permissions pagkatapos ng upgrade).
- **Retained ang lookups at UOMs** per Tim — kailangan ng app para may laman ang mga dropdown, at nae-edit naman sa Lookups page.

**Refactor:** inalis sa `seed.ts` ang mga kopyang `hashPassword`, `permissionParts`, `seedPermissions`, `seedRoles`, `seedUomsAndConversions`, `seedLookupValues`, `LOOKUP_VALUES`, `UOMS`, `GLOBAL_CONVERSIONS` — mula sa `baseline.ts` na ang lahat. Nanatiling dev-only ang demo data.

**Verification sa totoong container, fresh na database:** bootstrap tumakbo (143 permissions, 7 roles, 51 lookup values, 6 UOMs, 1 super admin) → login gamit ang naka-print na password ✅ → `mustChangePassword: true` ✅ → **branches 0, items 0, employees 0, assets 0, suppliers 0, users 1** ✅ → lookups kompleto (asset-conditions 5, transaction-reasons 5, maintenance-types 5, document-types 6, supplier-categories 5) ✅. Regression: gumagana pa rin ang dev seed (buong Phase 3–6 demo data) ✅. typecheck 7/7, lint 4/4 ✅. (Tala: kebab-case slug ang lookups route — `/lookups/asset-conditions`, hindi ang raw category name.)

**Guide §6 binago:** production bootstrap na ang itinuturo, may babala na dev-only ang `seed` na walang `:prod`. Ang dating "minimal seed" note ay pinalitan ng runbook sa paglilinis ng database na may demo data na.

---

## 2026-09-17 (gabi 2) — 🐛 REAL BUG: production sapilitang nag-fo-force ng Secure cookie

Tim sa on-prem server: "pag tama ang uname and pw, walang nangyayari. pag mali nadedetect na mali."

**Diagnosis (ang maling password na na-detect ang susi):** kung tama ang error sa maling password, gumagana ang buong request pipeline — ang cookie lang ang naiiba kapag successful. Hiningi ko ang runtime data, hindi ang laman ng file:
- `printenv SESSION_COOKIE_SECURE` sa container → **`false`** (tama ang config ni Tim)
- pero ang totoong response header → **`Secure`** pa rin! ← ang bug

**Root cause (`app-config.service.ts`):** `return this.env.SESSION_COOKIE_SECURE || this.isProduction;` — may `NODE_ENV=production` ang compose, kaya **sapilitang naka-on ang Secure kahit tahasang naka-false**. Tama ito noong Vercel/Railway lang (HTTPS palagi); nakamamatay ito sa HTTP LAN: tahimik na binabasura ng browser ang Secure cookie sa `http://` → wala nang session ang middleware → balik sa /login nang walang error = "walang nangyayari".

**Fix:**
1. Ang env var na lang ang awtoridad — `return this.env.SESSION_COOKIE_SECURE;`. Ang tahasang config ay hindi dapat tahimik na binabaligtad.
2. Bagong **bootstrap sanity check** sa `main.ts`: kapag `secure=true` pero `http://` ang WEB_ORIGIN → **error log**: "NOBODY WILL BE ABLE TO SIGN IN"; kapag `secure=false` pero `https://` → warning. Sana ay nahuli nito agad ito.
3. Bagong `app-config.service.spec.ts` (3 tests, mocked loadEnv dahil naka-cache ito) — regression guard laban sa pagbabalik ng `|| isProduction`.

**Verification:** 41 suites / **499 tests** ✅ (dating 496, +3), build/typecheck/lint ✅. Sa totoong Docker stack na `NODE_ENV=production` + `SESSION_COOKIE_SECURE=false` + http: **`set-cookie: gemerp_session=...; Path=/; HttpOnly; SameSite=Lax` — wala nang `Secure`** ✅. Pinatunayan ding pumuputok ang bagong error log kapag `secure=true` + http. Buong smoke muli: lahat pumasa.

**Napansin din sa `.env.prod` ni Tim:** (a) `WEB_ORIGIN=http://192.168.1.50:3000` pero ang totoong IP ay **192.168.0.50** (kinopya ang halimbawa) — sisira sa QR scan URLs; (b) **hindi pa napapalitan ang tatlong password** (`CHANGEME_generate_a_long_random_value` pa rin). Naituro na sa kanya, kasama ang gotcha na ang `POSTGRES_PASSWORD` ay binabasa lang sa unang init ng database kaya kailangan ng `down -v` para magkabisa.

---

## 2026-09-17 (gabi) — fix: nawala ang MinIO sa Docker Hub → lumipat sa quay.io

Sa unang `docker compose up` ni Tim sa on-prem server: `pull access denied for minio/minio, repository does not exist or may require 'docker login'`. Ang postgres/redis ay "Interrupted" lang (kinansela ng compose nang pumalya ang minio), kaya mukhang server-side ang problema.

**Diagnosis:** hindi server ni Tim. Sinubukan ko dito — **parehong error** sa `minio/minio:latest` at `minio/mc:latest`, habang **maayos** ang `postgres:16-alpine` at `redis:7-alpine`. Tumigil ang Docker Hub mirror ng MinIO sa public pulls; ang opisyal nilang registry ay **quay.io**. (Gumana ang dating test ko dahil naka-cache na ang image mula sa dev compose — hindi ito fresh pull.)

**Fix:** `quay.io/minio/minio` at `quay.io/minio/mc` sa **tatlong lugar** — `docker-compose.prod.yml`, `docker-compose.yml` (dev — tatamaan din ang bagong dev machine), at `scripts/backup-gemeni.sh`. **Pinned** ang minio server sa `RELEASE.2025-09-07T16-13-09Z` — ang floating tag na biglang nawawala ang mismong sanhi nito; naiwang `latest` ang `mc` (ephemeral CLI, mababa ang risk). Dinagdagan ng troubleshooting row ang guide §11.

**Verification:** buong prod stack muli — 6 services healthy, nagawa ang bucket, seed, at **lahat ng smoke steps pumasa** (attachment upload/download byte-identical, export job queue→worker→MinIO→download, PO PDF). Nilinis ang test stack; hindi ginalaw ang dev containers.

---

## 2026-09-17 (later) — ☁️→🏢 Tinanggal ang cloud deployment; on-premise na lang

Tim: "Remove na natin yung railway na yan, focus tayo sa pag run prod natin sa server."
Tinanong ko ang saklaw (masisira ang Vercel kapag wala nang API) — sagot: **burahin pareho**.

**Bago bumura — backup:** walang public endpoint ang Railway Postgres, kaya `railway ssh --service Postgres -- pg_dump | gzip | base64` → dinecode locally. Nasa **`/home/tim-sinag/gemeni-backups/railway-prod-20260917.sql`** (419 KB, 71 tables). Laman: halos pawang seed data pero may sariling data si Tim (13 items imbes na 12, dagdag na stock transactions), kaya mabuting naitabi.

**Tinanggal:**
- Railway project `gem-erp` (api, worker, Postgres, Redis) — `railway delete`; scheduled ng Railway, 404 na agad ang api domain. **Hindi pa naka-cancel ang Hobby plan ($5/buwan) — si Tim ang gagawa niyan sa dashboard.**
- Vercel project `gem-erp` — `vercel project rm`; 404 na ang gem-erp.vercel.app.
- Repo: `railway.json`, `apps/web/vercel.json`, `docs/deploy-vercel-railway.md`, `.vercel/` (local link artifact), at ang lokal na `user_access_prod.md` (patay na ang mga password — burado ang database na kinaroroonan nila).

**Inayos, hindi tinanggal (tama pa rin ang behavior, platform-neutral na ang comments):**
- `main.ts` dual-stack bind `'::'` — kailangan pa rin sa container networks.
- `health.service.ts` Redis AUTH bago PING — **mas kailangan pa nga ngayon**: may `requirepass` ang on-prem Redis natin.
- `user_access.md` at `docs/deploy-on-premise.md` — inalis ang mga patay na URL, on-prem na ang itinuturo.

**Verification pagkatapos linisin:** build 5/5 ✅, typecheck 7/7 ✅, lint 4/4 ✅, **496 tests ✅** — walang nasira sa pagtanggal ng cloud config (deployment-platform files lang sila, hindi bahagi ng app).

**Pending:** i-cancel ni Tim ang Railway Hobby subscription; i-setup ang on-prem server gamit ang `docs/deploy-on-premise.md`.

---

## 2026-09-17 — 🏢 On-premise deployment stack (Docker Compose) — tested end-to-end

Tim: "deploy natin to sa on premise linux server namin, bigyan mo ko ng guide."

**Bago (lahat tested locally sa totoong Docker, hindi lang isinulat):**
- **`apps/web/Dockerfile`** (wala pa dati — Vercel lang ang nagbi-build ng web). Mahalagang detalye: **build ARG ang `API_PROXY_TARGET`, hindi runtime env** — binabaked ng Next.js ang rewrite destination sa `.next/routes-manifest.json` habang nagbi-build, kaya walang epekto kung runtime lang. Default `http://api:3001` (compose service name, hindi nagbabago kahit anong deployment). Verified sa loob ng image: `destination: "http://api:3001/api/v1/:path*"`.
- **`docker-compose.prod.yml`** — buong stack: postgres + redis (requirepass + appendonly) + minio + minio-init + api + worker + web. `web` lang ang may nakalabas na host port; lahat ng iba ay internal network. Healthchecks + `depends_on: service_healthy` kaya tama ang boot order; `restart: unless-stopped` kaya bumabalik pagka-reboot.
- **`.env.prod.example`** — may malinaw na babala sa dalawang pinaka-madaling mapagkamalan: `SESSION_COOKIE_SECURE` (true sa http = walang makaka-login) at `WEB_ORIGIN` (ito ang napupunta sa QR scan URLs).
- **`scripts/backup-gemeni.sh`** — pg_dump (custom format) + `mc mirror` ng MinIO bucket, may 30-day pruning. Network name hardcoded `gemeni_default` (galing sa `name: gemeni` sa compose) — mas matibay kaysa sa pag-parse ng `docker compose ps`.
- **`docs/deploy-on-premise.md`** — 12-section runbook: server specs, Docker install, clone, config, launch, seed + **password rotation**, firewall, auto-start, day-2 ops (update/backup/restore/logs), optional HTTPS, troubleshooting table, security checklist.
- **`.dockerignore` fix**: dati may `apps/web` na excluded (tama noon — api/worker lang ang naka-Docker), kaya imposibleng ma-build ang web image. Inalis; dinagdag ang `user_access_prod.md` para hindi mapunta sa image.
- **`.gitignore`**: `!.env.prod.example` exception (nahuhuli ito ng `.env.*` rule).

**Verification (totoong Docker stack, project `gemeni`, ports 3100/9101 para hindi mag-conflict sa dev):** 6 containers up at healthy → 9 migrations auto-applied sa unang boot ng api → seed tumakbo sa loob ng container → **live smoke lahat pumasa**: health (**minio "up"**, hindi "disabled" — ito ang bentahe kumpara sa Railway), login through the web proxy, dashboard KPIs, **attachment upload → download byte-identical**, **export job end-to-end** (queue → worker → MinIO → download, XLSX magic verified), printable PO PDF. Tapos **na-test din ang backup + restore**: pg_dump → `pg_restore --clean --if-exists` → login OK, 12 items at 10 assets buo. Nilinis ang test stack (`down -v`); hindi ginalaw ang dev stack.

**Decisions:** S3_ENABLED=true sa on-prem (may MinIO na sa stack — gumagana ang attachments at exports, hindi tulad ng Railway kung saan naka-off); MinIO console port nakalabas by default para may admin access, may tala kung paano isara; walang Caddy/TLS na isinama sa compose (LAN-first; naka-dokumento ang hakbang kung kailanganin).

**Pending / Next:** kung ilalabas sa internet o gustong HTTPS — dagdag na Caddy service + `SESSION_COOKIE_SECURE=true`. Para sa totoong rollout: "minimal seed" mode (permissions/roles/branches/users lang, walang demo data) — naka-dokumento bilang opsyon, gagawin kapag hiniling ni Tim.

---

## 2026-08-11 (gabi) — fix: warehouse settings rows nagdodoble sa item page

Tim reported: pag-save sa Warehouse settings, nag-a-append ang rows (parehong warehouse dalawang beses — blangko ang isa, may values ang isa na "—" ang branch).

**Root cause:** ang `GET /items/:id/warehouse-settings` view ay walang top-level `warehouseId` (nested `warehouse.id` lang), pero ang UI merge sa `item-warehouse-settings-card.tsx` ay nagma-match sa `setting.warehouseId` → laging `undefined` → hindi nakakabit ang settings sa warehouse rows (blangkong inputs) at ina-append ng defensive loop bilang "unknown warehouse" rows. **Display bug lang — walang duplicate sa database** (unique constraint sa itemId+warehouseId).

**Fix:** bagong `settingWarehouseId()` helper sa types.ts (tolerant: top-level o nested); merge + defensive loop gumagamit na nito; branch label fallback via branchId→code map. Verified: web typecheck/lint/build green. Committed 2c56662, pushed, **redeployed sa Vercel — live na sa prod**.

---

## 2026-08-11 (later) — 🚀 FULL DEPLOYMENT: Phases 4–7 live sa production + password rotation

Tim gave the go. Everything executed same day:

**Done:**
- **GitHub push**: 6 commits (e0e7757 P4, 4595746 P5, 7393453 P3.5, bbab751 P6, 8e74a07 P7, 9956081 Dockerfile fixes).
- **Railway API redeploy**: first attempt FAILED — Dockerfile hindi kasama ang bagong `packages/reports` (fixed: COPY + build step; commit 9956081). Second deploy SUCCESS, healthcheck pass, migrations auto-applied (9 total). Verified live: /reports → 401 unauthed (bagong code).
- **Vercel web redeploy**: Ready. (Vercel project ni-link ulit sa repo root — ang CLI deploy ay dapat mula ROOT, hindi apps/web, dahil rootDirectory=apps/web na ang project setting.)
- **NEW: worker service sa Railway** (`worker`, Dockerfile: bagong apps/worker/Dockerfile): DATABASE_URL/REDIS_URL references, NODE_ENV=production, S3_ENABLED=false. Deploy trick: per-upload ang railway.json kaya pinalitan ito pansamantala ng worker build config para sa `railway up --service worker`, tapos ibinalik (ang committed railway.json ay para sa api). Worker verified live sa prod: 4 queues running; unang detector run nakahanap ng lowStock=8, lotExpiry=4, maintenanceOverdue=2, warrantyExpiry=2, overdueReturns=3, unreceivedTransfers=1 — notifications flowing na sa prod.
- **Prod seed**: idempotent full seed via `railway ssh --service api` — permissions synced (report.*/count.*/approval.* atbp.), Phase 4–6 sample data nalikha (3 suppliers/3 POs/2 GRs, 2 plans/3 WOs, 2 approval workflows kasama ang 4-approver-type demo, count session).
- **🔐 PASSWORD ROTATION (prod)**: lahat ng 7 accounts — strong random passwords, argon2id hashes generated locally, inapply via PrismaClient script sa loob ng api container (railway ssh). Verified: lumang `ChangeMe!123` → 401 INVALID_CREDENTIALS; bagong passwords → 200. **Credentials nasa `user_access_prod.md` (LOCAL ONLY, gitignored)** — ibigay kay Tim, huwag i-commit. Local dev unchanged (ChangeMe!123, dev only).
- **Prod smoke (all passed)**: new-password login ✅, dashboard summary totoong data ✅, 16 runnable reports ✅, notifications endpoint ✅, seeded workflows ✅.

**Decisions:** S3_ENABLED=false pa rin sa prod (attachments UI nagde-degrade gracefully; export jobs magfa-FAIL nang malinaw na may dahilan) — pag-uusapan kay Tim ang S3/R2 bucket kung kailangan ang attachments/exports sa prod. mustChangePassword hindi in-set sa rotation (strong passwords na, si Tim ang mamamahagi).

**Pending / Next:** S3 storage decision para sa prod attachments/exports; Phase 8 hardening remainder (e2e passes, security review); palitan ang sample/demo data ng totoong GemCor data kapag handa na si Tim mag-onboard ng users.

---

## 2026-08-11 — ✅ Phase 7 complete: dashboard, 16 reports, queued exports, printable PDFs

Both agents hit session limits mid-build (resumed via SendMessage; disk verified first). **Local commit only — no push/deploy per Tim.**

**Done (backend — verified: api+worker build ✅, 40 suites / 496 tests ✅ (+52), typecheck 7/7 ✅, lint ✅, 9 migrations clean):**
- **`packages/reports` (@gemerp/reports)** — bagong workspace package: report registry (key → permissions, filters, columns, run()), filter validation, chunked runner (50k cap + truncated flag), CSV/XLSX/PDF renderers. Iisang definition para sa API at worker — walang dobleng queries.
- **Dashboard** GET /dashboard/summary: lahat ng KPI mula sa live batched queries (assets by status/condition, assigned vs available, SKU counts, low/out-of-stock via reorder settings, pending transfers/approvals, maintenance due/overdue, warranty & lot expirations 30d, open POs/draft receipts, 10 recent txns); acquisitionValue/inventoryValue hindi man lang tumatakbo ang queries kung walang *.view_cost.
- **Reports**: GET /reports catalog (runnable subset per caller) + 16 report endpoints (registry-driven, contract URLs), bawat isa: report.view + underlying permission, branch scope always (out-of-scope 403), §1.4 filters validated (unsupported → VALIDATION_ERROR), paginated, cost columns gated.
- **Exports**: POST /exports (permission + scope verified at enqueue, snapshot ng includeCost/branchIds), own-jobs list/detail/download (foreign job = 404; download streamed, audit-logged). Worker: report-exports queue every 30s, atomic QUEUED→PROCESSING claim, renders via registry, upload sa S3/MinIO, EXPORT_READY/EXPORT_FAILED notification (dedup-keyed), S3 disabled = graceful FAILED status hindi crash.
- **Printables** (sariling module, PDFs via pdfkit): PO, goods receipt, transfer, asset acknowledgment form (signature blocks), work order (checklist + parts + gated costs), count sheet (blank counted/remarks columns, blind masking). Parent view permission + branch scope + audit per render.
- Migration `20260806120000_phase7_export_jobs` (additive): ExportJobStatus enum + export_jobs table. Shared: EXPORT_READY/EXPORT_FAILED notification types.

**Done (frontend):** *(nasa itaas na entry ang detalye — reports hub, generic report pages, export center with polling, print buttons sa 6 detail pages, dashboard rebuilt sa /dashboard/summary)*

**Integration (orchestrator):** wired ReportsModule + ExportsModule + PrintablesModule; full chain green (build 5/5, typecheck 7/7, lint 4/4, **496 api tests**, 9 migrations clean). **Live smoke via proxy (10 steps, all passed):** dashboard KPIs totoong data (12 assets sa 5 statuses, 10 recent txns, cost-gated values present para sa superadmin) → 16 runnable reports sa catalog → stock-on-hand rows tama → unsupported filter = VALIDATION_ERROR → **PO PDF at acknowledgment form = totoong %PDF** → **export end-to-end: queue → worker claim → XLSX render → MinIO upload → completed → download (PK magic verified) → EXPORT_READY notification**. Worker verified live: 4 queues tumatakbo (report-exports 30s, maintenance hourly, detectors 15m, heartbeat).

**Decisions:** singular `report.*` permission family (existing since Phase 0) — walang duplicate `reports.*` strings; 16 report URLs served ng isang parameterized route (registry ang contract); exports capped 50k rows na may truncated flag; export statuses lowercase sa API (contract literal); worker dist run kailangan ng `node --env-file=<repo>/.env` (dev script may --env-file-if-exists na).

**Pending / Next:** Phase 8 hardening remainder na lang (e2e/security passes, password rotation sa deploy). **HOLD until Tim's go: git push, Vercel/Railway deploys, seed-password rotation (ChangeMe!123 live publicly — kasama sa deploy).**

**Done (frontend — verified: web build ✅ all routes, lint 0, web typecheck green):**
- **Reports hub** `/reports` (runnable subset mula sa GET /reports, grouped by area client-side) + generic `/reports/[key]` page: client registry na mirror ng `packages/reports` server registry (16 keys, filters verbatim — VALIDATION_ERROR ang hindi supported), house pickers sa filter bar, server-paginated table, cost columns render-if-present, saved filters sa localStorage, CSV/XLSX/PDF export buttons → POST /exports → toast na tumuturo sa Export center.
- **Export center** `/reports/exports` (may `/exports` redirect alias para sa NOTIFICATION_LINKS): own jobs, status badges, 4s polling habang may in-flight, Download, failed rows nagpapakita ng error, `truncated` warning badge.
- **Print buttons** (shared `print-document-button.tsx`, new-tab + download fallback): PO, goods receipt, transfer, work order, asset (Acknowledgment form), count session (Count sheet).
- **Dashboard rebuilt** sa iisang GET /dashboard/summary: KPI tiles (assets by status na may pure-CSS distribution bar, assigned vs available, SKU, low/out-of-stock, pending transfers/approvals, maintenance due/overdue, expirations, open POs/draft receipts), value tiles render-only-when-present (server cost-gates), recent transactions na naka-link; self-scoped cards retained.
- Nav "Reports" section; lib surface: dashboard/report/export/printable endpoints + types + tolerant helpers; permissions tolerant sa `report.*` vs `reports.*` spelling.

**Pending / Next:** backend agent finishing (report controllers + exports queue + printables + tests). Then: wire modules, full verify, smoke (kasama end-to-end export job), local commit. **HOLD: push/deploy/password rotation.**

---

## 2026-08-06 (later) — ✅ Phase 6 complete: counts, parameterized approvals, notifications

Both agents died on session limits mid-build TWICE (resumed via SendMessage each time; disk state verified before every resume). **Local commit only — no push/deploy per Tim.**

**Done (backend — verified: api build ✅, 34 suites / 444 tests ✅ (+52), root typecheck ✅, lint ✅, 8 migrations clean, seed idempotent 3×):**
- **Counts §7.1** (`apps/api/src/counts/`): sessions CNT-{YYYY}-{SEQ5}; start = atomic snapshot ng balances + expected assets; line counting ({countedQty} / {found, conditionId, locationConfirmed}); rapid scans (barcode + asset tag/serial, out-of-snapshot → UNEXPECTED lines); blind masking hanggang complete; recount REVIEW→IN_PROGRESS; variance report; complete → REVIEW (locks); **create-adjustments (Idempotency-Key required, resumable replay) → DRAFT adjustment txns via existing StockTransactionsService — counts never touch balances**; cancel.
- **Approvals §7.2** (`apps/api/src/approvals/`): workflows CRUD + activate/deactivate (documentType, subtypes, branch scope, amount+quantity thresholds, ordered steps); **approver resolution at request time: ROLE | POSITION | DEPT_HEAD | USER** (bagong `approval_request_steps` table ang nag-iimbak ng resolved assignees per step — ang GemCor requirement); requests queue with delegation-aware assignedToMe; approve/reject(comment!)/return; delegations with time windows; self-approval 409 kahit via delegation; finalization executes the document's own transition. **Retrofit**: stock-transactions/transfers/POs/supplier-returns submit ay dumadaan sa ApprovalEngineService.routeSubmit (most-specific match: branch > subtype > threshold; document claim + request creation sa iisang transaction); walang workflow = legacy auto-approve behavior (backward compatible).
- **Notifications §7.3** (`apps/api/src/notifications/`): self-scoped list/unread-count/read/read-all; channel-ready service (in-app now, email/SMS on hold per Tim); dedup per (recipient, dedupeKey), reopen-after-read para sa engine events. Shared: `packages/shared/src/notifications.ts` (NOTIFICATION_TYPES, dedupe keys, NOTIFICATION_LINKS).
- **Worker**: `notifications` queue, repeatable run-detectors every 15min (advisory-locked): low/out-of-stock, lot expiry 30d, maintenance overdue + due reminders (pinalitan ang Phase 5 log-only note), warranty expiry 30d, overdue asset returns, unreceived transfers >3d, failed-job → super admins.
- Migration `20260806080000_phase6_counts_approvals_notifications` (additive): approval_request_steps table, workflow subtypes/qty thresholds, count session/line columns, notifications.link.
- Seed: WF-SEED-PO-4STEP (steps ROLE→POSITION→DEPT_HEAD→USER, lahat nagre-resolve), WF-SEED-ADJ-THRESHOLD (adjustment subtypes, minQuantity 25), completed count session + linked draft adjustment, sample notifications.

**Done (frontend — verified: web build 38/38 pages ✅, lint 0, web typecheck clean):** *(detalye sa ibaba, unchanged)*

**Done (frontend — verified: web build 38/38 pages ✅, lint 0, web typecheck clean):**
- **Counts**: `/inventory/counts` list/new/detail — branch→warehouse→location scope cascade, blind toggle, full|cycle; detail stepper Draft→Counting→Review→Completed; **mobile-first counting** (64px touch rows, numeric pad dialog, rapid-scan wedge panel → `/scans`), asset lines Found/Not-found + condition + location-confirmed, blind masking until review, recount selection, variance tab (exceptions filter, cost-gated value impact), adjustments tab linking generated draft txns, complete/create-adjustments (Idempotency-Key)/cancel.
- **Approvals**: `/approvals` inbox (PENDING + assignedToMe defaults) + delegations tabs; detail sheet (document summary + link, step snapshots with resolved assignees, history timeline with delegation attribution, approve/reject!/return!); `/approvals/workflows` list + editor — **bawat step pumipili ng ROLE | POSITION | DEPT_HEAD | USER** na may tamang picker + helper text (Tim's requirement); acting is assignment-based (assignees + in-window delegates), SELF_APPROVAL_FORBIDDEN banner.
- **Notifications**: topbar bell (unread badge poll 60s + on-focus, 8 recent, mark-read-on-click, read-all), `/notifications` history page with read/type filters; deep links via server `link` field; `/counts/[id]` at `/approvals/[id]` ay canonical redirect targets ng shared NOTIFICATION_LINKS.
- Nav: Counts under Inventory (count.view), Approvals section (Inbox + Workflows), "Pending my approval" dashboard tile.
- Lib: full §7.1–7.3 endpoint surface (12 count + 14 approval + 4 notification fns), types + tolerant helpers, status-maps mirror ng backend count-rules TRANSITIONS.

**Decisions (aligned sa actual DTOs):** conditionId (not condition) sa asset count lines; workflow documentType UPPERCASE + code create-only + no version sa workflow PATCH; count flow complete→REVIEW→create-adjustments→COMPLETED; unread `{unread}`; variance `{session, summary, lines}`.

**Integration (orchestrator):** wired ApprovalsModule + CountsModule + NotificationsModule sa app.module.ts, seedPhase6ApprovalsCounts sa seed.ts; full chain green (build, typecheck 5/5, lint, **444 api tests**, 8 migrations clean, full seed idempotent). **Live smoke via proxy (10 steps, all passed):** workflows list may 4 approver types ROLE→POSITION→DEPT_HEAD→USER → notifications (unread 9, MAINTENANCE_DUE mula sa detectors!) → count create/start (snapshot 2 lines) → count −2 → complete → REVIEW → variance −2 → create-adjustments STK-2026-000023 + **idempotent replay 200 walang doble** → adjustment qty 30 submit → **PENDING_APPROVAL** (routed sa WF-SEED-ADJ-THRESHOLD, hindi auto-approve) → self-approve = **409 SELF_APPROVAL_FORBIDDEN** → branchadmin assignedToMe=YES → approve → document **APPROVED** → requester nakatanggap ng **APPROVAL_APPROVED** notification.

**Local dev env note:** may kapwa-proyektong v-hive na nakaupo ngayon sa ports 3000/3001 paminsan-minsan; ang GEM-ENI dev ay pinapatakbo na sa **API port 3011** + web na may `API_PROXY_TARGET=http://localhost:3011` kapag okupado ang 3001. Production unaffected (sariling env vars).

**Decisions:** count flow complete→REVIEW→create-adjustments→COMPLETED; one draft per warehouse+direction (mixed variance = INCREASE at DECREASE drafts); create-adjustments needs `inventory.adjust` din (reuses StockTransactionsService.create); approval acting is assignment-based hindi permission-based (per contract); missing/misplaced assets flagged only (manual follow-up); BRANCH_ADMIN granted `approval.manage`.

**Pending / Next:** Phase 7 (analytics, reports, exports) — ang huling malaking phase. Deferred: variance value-impact costs sa UI (helpers ready), search indexing ng counts/approvals, external notification channels (on hold per Tim). **HOLD: push/deploy/password rotation (ChangeMe!123 live publicly).**

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
