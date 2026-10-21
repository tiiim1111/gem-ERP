# HRIS employee sync — operations

Paano i-deploy, i-enable at i-troubleshoot ang HRIS employee feed sa prod.

Ang kontrata sa producer: [`hris-employee-api-phase2-decisions.md`](./hris-employee-api-phase2-decisions.md).

---

## 1. Ano ang gumagalaw

```
HRIS (192.168.0.60)                GEM-ENI (192.168.0.50)
GET /api/v1/integrations/          ┌──────────────────────────────────┐
    gemeni/employees      ◄────────┤ api: engine + poller             │
Bearer <token>, read-only          │   • kumukuha, nagva-validate,    │
full snapshot, paginated           │     nagre-reconcile              │
                                   │   • advisory lock: isa lang      │
                                   │     tumatakbo kahit may replica  │
                                   ├──────────────────────────────────┤
                                   │ worker: nightly cron             │
                                   │   • gumagawa lang ng QUEUED row  │
                                   └──────────────────────────────────┘
```

Isang landas lang ang lahat ng trigger: **gumagawa ng `hris_sync_runs` row**
(QUEUED), tapos dinudrain ng poller ng API. Pareho ang dinadaanan ng nightly
cron at ng "Run now" sa UI, kaya ang na-rehearse sa dry run ay siya ring
tatakbo.

**Ang nasa GEM-ENI pa rin** (hindi kailanman ino-overwrite ng sync): branch,
supervisor, department head, naka-link na login account, notes, photo, at lahat
ng asset custody at kasaysayan nito.

**Hindi natin buburahin ang kahit sino.** Kapag may naka-link na employee na
wala na sa snapshot, **ini-report** iyon — hindi dinededelete, ina-archive o
dinideactivate. Ang record na iyon ang nagtatali sa nawawalang laptop sa isang
pangalan.

## 2. Mga setting

Nasa `.env.prod` sa server. Nakasulat din lahat sa `.env.example`.

| Variable | Dapat |
|---|---|
| `GEMENI_HRIS_SYNC_ENABLED` | `false` muna. Huling hakbang ang pag-`true`. **Ibig sabihin nito ay "pinapayagang magsulat", hindi "pinapayagang tumakbo"** — tumatakbo pa rin ang dry run kapag `false`, at iyon mismo ang punto ng pag-deploy nang disabled. Tinatanggihan ang tunay na run na may malinaw na dahilan sa run history. |
| `GEMENI_HRIS_BASE_URL` | `http://192.168.0.60` |
| `GEMENI_HRIS_EMPLOYEE_PATH` | `/api/v1/integrations/gemeni/employees` |
| `GEMENI_HRIS_EXPECTED_COMPANY_CODE` | `GEM` |
| `GEMENI_HRIS_TOKEN` | Ang shared bearer token. **Huwag i-commit, huwag i-print.** |
| `GEMENI_HRIS_DEFAULT_BRANCH_CODE` | Branch code ng bagong employees — kailangang **active**. Para sa GemCor: ang branch na **SBMA GEM Investment Corp.** Kung hindi mo alam ang code, inililista ito ng HRIS Feed page mismo. |
| `GEMENI_HRIS_SYNC_CRON` | `0 2 * * *` |
| `GEMENI_HRIS_SYNC_TIMEZONE` | `Asia/Manila` |

Gumagana ang lahat kahit blanko ang mga ito — nananatili lang na manual ang
employees, gaya ng dati.

### Company sa HRIS ≠ branch sa GEM-ENI

May `company_id` ang HRIS (`companies`, isang row: `GEM` / GEM Investment Corp
/ GemCor), at natural isipin na iyon na ang branch. Hindi.

**Isang kompanya lang**, kaya pare-pareho ang value sa lahat ng empleyado — ang
i-map ang `GEM` → isang branch ay eksaktong kapareho ng pag-set ng default
branch, walang dagdag na impormasyon. At sa prinsipyo: ang isang kompanya ay
maaaring may maraming branch, kaya hindi masasabi ng company code kung alin
doon.

Ang tunay na ginagawa ng company field ay **guard**, hindi source — may filter
ang producer at ina-assert natin ang `meta.companyCode` bawat page. Iyon ang
humaharang sa problemang **unique lang kada kompanya** ang employee number sa
HRIS gayong **global** ang constraint sa GEM-ENI.

Kapag nadagdagan ng pangalawang kompanya ang HRIS, **tinatanggihan ang buong
payload** kaysa hulaan. Sinadya iyon: ang bagong kompanya ay desisyong
pangnegosyo, hindi dapat tahimik na sinisipsip ng nightly job.

### Bakit kailangan ng default branch

Walang branch concept ang HRIS, pero **required** ang `branchId` sa GEM-ENI at
nakatali ito sa asset tag (`AST-{BRANCH}-…`) at sa kung sino ang nakakakita ng
anong asset. Kaya eksplisito ito, hindi hinuhulaan.

Ang kasalukuyang mapping: **HRIS company `GEM` (GemCor) → branch na SBMA GEM
Investment Corp.** Isa lang ang kompanya sa HRIS, kaya isa rin ang branch na
pinupuntahan — at hindi galing sa company field ang pagpipiliang iyon, nakatakda
ito sa config (tingnan sa itaas kung bakit).

Nailalapat lang ito **sa paggawa**. Kapag inilipat mo ang isang employee sa
ibang branch, mananatili iyon — hindi na ito pinapalitan ng susunod na sync.

Kapag mali, inactive o walang laman ang code: **nilalaktawan ang mga bagong
employee** na may malinaw na error, hindi gumagawa ng kulang na record.

## 3. Pag-deploy (unang beses)

1. **Mag-backup bago gumalaw.**
   ```bash
   /opt/gemeni/scripts/backup-gemeni.sh
   ls -lh /var/backups/gemeni | tail -3   # tiyaking hindi zero ang laki
   ```

2. **Tiyaking abot ang HRIS mula sa GEM-ENI server.**
   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' \
     http://192.168.0.60/api/v1/integrations/gemeni/employees
   # 401 ang tamang sagot: buhay ang route at naka-guard
   ```

3. **Ilagay ang token** sa `/opt/gemeni/.env.prod` — mode `600`, at **huwag
   itong ipasa sa shell argument** (nakikita sa `ps` at napupunta sa history):
   ```bash
   sudo install -m 600 /dev/null /opt/gemeni/.env.prod.new
   sudo cp -a /opt/gemeni/.env.prod /opt/gemeni/.env.prod.bak
   sudo nano /opt/gemeni/.env.prod     # idagdag ang mga variable sa §2
   sudo chmod 600 /opt/gemeni/.env.prod
   ```
   Panatilihing `GEMENI_HRIS_SYNC_ENABLED=false` sa unang boot.

4. **I-deploy.** Awtomatiko ang migrations (`migrate deploy` ang entrypoint ng
   api image).
   ```bash
   /opt/gemeni/scripts/update-gemeni.sh
   ```

5. **I-verify na healthy.**
   ```bash
   docker compose -f /opt/gemeni/docker-compose.prod.yml \
     --env-file /opt/gemeni/.env.prod ps
   ```

## 4. Pag-enable (hindi dapat madaliin)

Nasa **Administration → HRIS Feed** sa sidebar. Superadmin lang, o may
`integration.manage`.

1. **Test connection** — nagre-report ng bilang at metadata lang, walang
   employee data.
2. **Dry run** — dumadaan sa **eksaktong** parehong desisyon, pero **walang
   ginagalaw na employee**. Ito ang pinaka-mura at pinaka-mabuting paraan para
   makita ang mangyayari.

   Isang bagay na **iniimbak** nito: ang mga department/position code na nakita
   sa feed, para may maituro ka sa Code mappings. Reference data iyon, hindi
   pagbabago sa employee — at kung hindi iimbakin, sasabihin lang ng dry run na
   "unmapped" nang wala kang paraan para i-map, kaya patay na dulo.
3. **Kung may unmapped na code**, may dalawang pagpipilian sa Code mappings:
   - **Create from HRIS** — gumagawa ng department/position sa GEM-ENI para sa
     bawat code na walang katumbas, at itinuturo agad ang mapping. Isang pindot,
     naka-audit, at inuulat kung ano ang ginawa. **Pinangalanan ayon sa code**
     (hal. `ADMIN`) dahil code lang ang dala ng feed, walang pangalan — palitan
     mo sa **Lookups** kung gusto mong gawing "Administration". Ang code ang
     basehan ng pagtutugma, hindi ang pangalan.
   - **O ituro nang isa-isa** sa dropdown, kung may existing na record na iba
     ang code pero siya naman talaga ang tama.

   Sadyang **hindi** ito ginagawa ng sync mismo: kung kusang gagawa ng
   department ang nightly job, ang isang typo sa HRIS ay magiging basurang
   department nang permanente — at may mga record na tutukoy pa doon.

4. **Tingnan ang resulta ng dry run.** Bago mag-enable, dapat:
   - tugma ang company code at `snapshot: true`;
   - nabilang lahat ng record (tingnan ang producer total vs. counts);
   - **walang** ambiguous link;
   - may valid na default branch;
   - **naka-map lahat** ng department at position code;
   - walang uniqueness o custody conflict.
5. Kapag may pumalya: **iwan munang disabled.** Ayusin muna ang mappings o ang
   data sa HRIS. Huwag piliting mag-import.
6. Kapag malinaw na: `GEMENI_HRIS_SYNC_ENABLED=true` sa `.env.prod`, tapos
   `/opt/gemeni/scripts/update-gemeni.sh`, tapos **Run now**.

Pagkatapos ng unang tunay na sync, i-verify ang totals, ang HRIS badge sa
employee records, ang read-only na fields, ang statuses, ang audit/run history,
at **na buo pa ang asset custody**.

Kapag naka-enable na, **nawawala ang "New employee"** at tinatanggihan din ng
API ang manual na paggawa — ang HRIS na ang system of record.

## 5. Pagbasa ng run

| Status | Ibig sabihin |
|---|---|
| `SUCCEEDED` | Naiapply lahat, walang kailangang tingnan ng tao. |
| `REVIEW_REQUIRED` | Naiapply, pero may nilaktawan o may nakaflag. **Tingnan.** |
| `FAILED` | **Walang naiapply.** Tinanggihan ang payload, o namatay ang run. |

Bakit `FAILED` ay "walang naiapply": kapag kalahati lang ng snapshot ang
natanggap, kamukha iyon ng biglaang pag-alis ng maraming tao. Mas tama ang
huwag gumalaw.

### Mga issue code

| Code | Ano ang gagawin |
|---|---|
| `UNMAPPED_DEPARTMENT` / `UNMAPPED_POSITION` | I-map sa HRIS Feed page, tapos i-run muli. Nilaktawan lang ang apektadong record. |
| `UNKNOWN_STATUS` | May bagong status sa HRIS. Ginawang INACTIVE (ang maingat na dulo) at nakaflag — kumpirmahin ang tamang mapping. |
| `AMBIGUOUS_MATCH` | Dalawang unlinked na employee ang may parehong number. Ayusin nang manu-mano — hindi pipili ang sync. |
| `DUPLICATE_EMPLOYEE_NUMBER` | Doble sa loob mismo ng snapshot. Ayusin sa HRIS. |
| `EMPLOYEE_NUMBER_CONFLICT` | Hawak na ng iba ang number. Hindi ito inililipat ng sync. |
| `EMAIL_CONFLICT` | Hawak na ng iba ang email. Iniwang blanko sa record na ito; **walang nabura** sa iba. |
| `ARCHIVED_INACTIVE` | Naka-archive sa HRIS (na pumipilit ng INACTIVE). Kumpirmahin kung umalis na talaga. |
| `INFERRED_SEPARATION_WITH_ASSETS` | Umalis na, may hawak pang asset. **Clearance.** Nananatili ang record. |
| `MISSING_FROM_SNAPSHOT` | Dating naka-link, wala na sa kumpletong snapshot. **Walang ginalaw.** Tingnan kung tinanggal sa HRIS o may problema sa feed. |
| `NO_DEFAULT_BRANCH` | Walang valid na `GEMENI_HRIS_DEFAULT_BRANCH_CODE`. |
| `WRITE_FAILED` | Pumalya ang pagsulat ng isang record. Nasa run ang dahilan. |

### Separation date

Walang separation-date column ang HRIS. Kapag unang nakita ang
`RESIGNED`/`TERMINATED`, ang **petsa ng pagkakita** ang itinatala, markado
bilang inferred, para tumakbo pa rin ang asset clearance.

**Hindi** ito galing sa `archivedAt` — administratibong aksyon iyon, hindi
separation. Hindi rin pinapalitan ang petsang nakatala na.

## 6. Troubleshooting

| Sintomas | Tingnan |
|---|---|
| Walang nangyayari sa Run now | `GEMENI_HRIS_SYNC_ENABLED=true` ba? Dry run lang ang tumatakbo kapag disabled. |
| `FAILED` na "rejected the bearer token (401)" | Mali o blanko ang `GEMENI_HRIS_TOKEN`. |
| `FAILED` na "expected \"GEM\"" | Ibang company ang sinasagot ng HRIS. **Huwag palitan ng kung ano** — magkaibang bilang ang employee numbers kada kompanya. |
| `FAILED` na "snapshot must be exactly true" | Hindi full snapshot ang ipinadala ng producer. |
| `FAILED` na "unexpected field(s) …" | Nagdagdag ng column ang HRIS at tumatagas sa feed. **Sadyang tinatanggihan** — kausapin ang HRIS team. |
| Lahat nilaktawan, `NO_DEFAULT_BRANCH` | Mali o inactive ang branch code. |
| Hindi tumatakbo ang nightly | Tingnan ang worker log: `docker compose … logs worker \| grep hris`. |
| `RUNNING` nang matagal | Hawak ng advisory lock. Nabibitiwan ito kapag namatay ang session — i-restart ang api kung kailangan. |

### Mga log na dapat hanapin

```bash
cd /opt/gemeni
docker compose -f docker-compose.prod.yml --env-file .env.prod logs api    | grep -i hris
docker compose -f docker-compose.prod.yml --env-file .env.prod logs worker | grep -i hris
```

Hindi kailanman lumalabas sa log, sa response, sa audit metadata o sa run
record ang token.

## 7. Rollback

Hindi destruktibo ang integration: dagdag na column at apat na bagong table
lang, at walang binubura.

**Pinakamabilis:** `GEMENI_HRIS_SYNC_ENABLED=false` + `update-gemeni.sh`.
Titigil ang sync; buo pa lahat ng employee at custody, at bumabalik ang manual
na paggawa at pag-edit.

**Pag-rollback ng app:**
```bash
cd /opt/gemeni
git log --oneline -5
git checkout <dating-commit>
/opt/gemeni/scripts/update-gemeni.sh
```

> **Tandaan:** forward-only ang Prisma migrations. Mananatili ang mga bagong
> column at table pagkatapos ng app rollback — walang pinsala iyon, pero kapag
> talagang kailangang bawiin ang schema, **restore mula sa backup** (§9 ng
> `deploy-on-premise.md`), hindi manu-manong `DROP`.

## 8. Ano ang nilalaman ng database

| Table | Para saan |
|---|---|
| `employees.hris_id` | Ang durable match key. Hindi `employee_number` — nababago iyon sa HRIS. |
| `employees.hris_synced_at` / `hris_updated_at` | Kailan huling nagalaw, at ang `updatedAt` ng producer. |
| `employees.separation_date_inferred` | Nakita ng sync ang petsa, hindi binigay ng HR. |
| `hris_sync_runs` | Bawat reconciliation: trigger, dry-run flag, status, producer metadata, counts. |
| `hris_sync_issues` | Row-level na problema at review item. **Identifier lang** — walang pangalan o email. |
| `hris_department_maps` / `hris_position_maps` | HRIS code → GEM-ENI record. `auto_suggested` = tugma sa code, hindi pa kinumpirma ng tao. |
