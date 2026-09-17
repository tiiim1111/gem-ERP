# Deploying GEM-ENI on an on-premise Linux server

Runbook para ilagay ang buong sistema sa sariling server ng GemCor — walang
cloud, walang buwanang bayad, at gumagana ang lahat kasama ang attachments at
report exports (may kasamang MinIO file storage ang stack).

Ito na ang **tanging** paraan ng pag-deploy ng GEM-ENI — natanggal na ang dating
Vercel + Railway setup noong 2026-09-17.

```
Mga PC / phone sa office
        │  http://<server-ip>:3000
        ▼
┌──────────────────── Linux server (Docker) ────────────────────┐
│  web (Next.js)  ──same-origin proxy /api/v1──►  api (NestJS)  │
│                                                   │            │
│                            worker (background jobs)│           │
│                                                   ▼            │
│              postgres        redis        minio (files)        │
└────────────────────────────────────────────────────────────────┘
```

Isang container lang ang nakalabas (`web`); ang lahat ng iba ay nasa loob ng
private Docker network — hindi sila abot mula sa LAN.

> **Tandaan:** ang data ng dating cloud deployment ay naka-save bilang SQL dump
> (`/home/tim-sinag/gemeni-backups/railway-prod-20260917.sql` sa laptop ni Tim).
> Kung may dadalhin doon, tingnan ang §9 "Restore mula sa backup" — pero
> karaniwan mas malinis ang bagong seed sa on-prem.

---

## 1. Kailangan sa server

| | Minimum | Komportable |
|---|---|---|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 30 GB SSD | 100 GB SSD |
| OS | Ubuntu 22.04 / 24.04 LTS, Debian 12, o Rocky/Alma 9 | — |

Dagdag pa:
- **Static IP** sa server (o DHCP reservation sa router). Kapag nagpalit ang IP,
  mali na ang `WEB_ORIGIN` at masisira ang QR scan links.
- Internet access sa server kapag nagbi-build (para makakuha ng Docker images at
  npm packages). Pagkatapos, LAN-only na pwede.
- Sudo access.

---

## 2. I-install ang Docker

Ubuntu/Debian (opisyal na script ng Docker):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # para hindi na kailangan ng sudo sa docker
newgrp docker                       # o mag-logout/login
sudo systemctl enable --now docker  # auto-start pagka-boot ng server
docker compose version              # dapat may lumabas na v2.x
```

RHEL/Rocky/Alma: `sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin`

---

## 3. Kunin ang code

```bash
sudo mkdir -p /opt/gemeni && sudo chown $USER:$USER /opt/gemeni
git clone https://github.com/tiiim1111/gem-ERP.git /opt/gemeni
cd /opt/gemeni
```

Kung walang GitHub access ang server: i-zip ang repo sa laptop
(`git archive --format=zip HEAD -o gemeni.zip`), ilipat via USB/scp, tapos
i-extract sa `/opt/gemeni`.

---

## 4. I-configure ang `.env.prod`

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

Gumawa ng password (patakbuhin ng tatlong beses, isa para sa bawat isa):

```bash
openssl rand -base64 24 | tr -d '/+=' | head -c 24; echo
```

Apat ang **talagang mahalaga**:

| Setting | Ano ang ilalagay |
|---|---|
| `WEB_ORIGIN` | Ang **eksaktong** ita-type ng users sa browser, kasama ang port — hal. `http://192.168.1.50:3000`. Ito rin ang ginagamit sa QR scan URLs, kaya dapat ito ang address na kayang buksan ng mga phone sa office Wi-Fi. |
| `WEB_PORT` | `3000` (default) o `80` para mawala ang `:3000` sa URL. |
| `SESSION_COOKIE_SECURE` | `false` kapag `http://` ang WEB_ORIGIN. **`true` lang kung `https://`.** Mali dito = walang makaka-login (tahimik na binabasura ng browser ang cookie). |
| `POSTGRES_PASSWORD` / `REDIS_PASSWORD` / `S3_SECRET_KEY` | Tig-iisang random na 24-character. Letters at numbers lang — pumapasok sila sa connection URLs. |

Hanapin ang IP ng server: `ip -4 addr show | grep inet`

---

## 5. Buhayin ang stack

```bash
cd /opt/gemeni
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Mga 5–10 minuto ang unang build (nagko-compile ng tatlong apps). Ang mga susunod
ay mas mabilis dahil naka-cache.

Tignan kung maayos ang lahat:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

Dapat `healthy` ang postgres, redis, minio, at api; `Up` ang web at worker.
Awtomatikong tumatakbo ang database migrations tuwing bubuhayin ang `api`.

---

## 6. Unang setup ng data (isang beses lang)

Ilagay ang **totoong email** ng magiging super admin:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -e SUPERADMIN_EMAIL=superadmin@gemcor.ph \
  api pnpm --filter @gemerp/database seed:prod
```

Gagawa ito ng **kailangan lang** para gumana ang app:

- ang organization row
- ang permission catalog at ang 7 system roles (nasa code, hindi pwedeng gawin sa UI)
- **isang** super-admin account
- ang lookup vocabulary (asset conditions, reasons, maintenance types…) at ang base na units of measure — **lahat ito ay pwede mong baguhin sa app** sa ilalim ng Lookups

**Walang ginagawang demo data** — walang branches, warehouses, employees, items,
suppliers, o dokumento. Ikaw ang maglalagay ng totoong data ng GemCor sa app.

Ipi-print nito ang password **nang isang beses lang** — kopyahin mo agad:

```
    email:    superadmin@gemcor.ph
    password: 3NRm7DVi77Yl1HsjutB3XtQi
```

Sapilitang papalitan ito sa unang pag-login. Kung gusto mong ikaw mismo ang
pumili ng password, idagdag ang `-e SUPERADMIN_PASSWORD=...` sa command.

Idempotent ang script — ligtas ulitin (ginagamit ito para i-sync ang mga bagong
permission pagkatapos mag-upgrade). Hindi nito binabago ang password ng
account na umiiral na.

### Pagkatapos mag-login, sa app na ang lahat

1. Palitan ang password mo
2. **Branches** → idagdag ang mga branch, warehouse, at storage location mo
3. **Lookups** → tignan ang vocabulary, dagdagan o alisin ayon sa kailangan
4. **Items** → ang catalog mo; **Employees**, **Users** → ang team mo

> Ang `pnpm --filter @gemerp/database seed` (walang `:prod`) ay **development
> lang** — puno ito ng demo data at may mga account na `ChangeMe!123` ang
> password. Huwag itong patakbuhin sa server.

---

## 7. Payagan ang ibang PC na maka-access

```bash
sudo ufw allow 3000/tcp     # palitan ng 80 kung WEB_PORT=80 ang ginamit
sudo ufw reload
```

RHEL: `sudo firewall-cmd --permanent --add-port=3000/tcp && sudo firewall-cmd --reload`

Subukan mula sa ibang PC: `http://192.168.1.50:3000` — dapat lumabas ang login
page ng GEM-ENI.

Gusto mo ng pangalan imbes na IP (hal. `http://gemeni.gemcor.local`)? Magdagdag
ng A record sa router/DNS na nakaturo sa server IP, tapos ilagay yun sa
`WEB_ORIGIN` at i-restart ang stack (§9).

---

## 8. Auto-start pagka-boot

Wala nang gagawin — `restart: unless-stopped` ang lahat ng containers at
naka-enable na ang Docker service (§2). Pag na-restart o nawalan ng kuryente
ang server, babalik ang buong stack mag-isa.

Patunayan: `sudo reboot`, tapos pagkabalik, `docker compose -f docker-compose.prod.yml --env-file .env.prod ps`

---

## 9. Araw-araw na operasyon

Mula sa `/opt/gemeni`. Para hindi paulit-ulit ang mahabang command, gumawa ng
shortcut:

```bash
echo "alias gemeni='docker compose -f /opt/gemeni/docker-compose.prod.yml --env-file /opt/gemeni/.env.prod'" >> ~/.bashrc
source ~/.bashrc
```

| Gawain | Command |
|---|---|
| Status | `gemeni ps` |
| Logs (live) | `gemeni logs -f api` (o `web`, `worker`) |
| Restart | `gemeni restart` |
| Stop | `gemeni down` (nananatili ang data) |
| Start ulit | `gemeni up -d` |
| **Update sa bagong version** | `git pull && gemeni up -d --build` — awtomatikong mag-a-apply ang migrations |
| Linisin ang lumang images | `docker image prune -f` |

### Backup (gawin araw-araw)

```bash
/opt/gemeni/scripts/backup-gemeni.sh
```

Naglalabas ng Postgres dump + kopya ng lahat ng files (attachments, exports) sa
`/var/backups/gemeni`, at binubura ang mahigit 30 araw na luma.

Awtomatiko tuwing 1 AM:

```bash
sudo mkdir -p /var/backups/gemeni && sudo chown $USER:$USER /var/backups/gemeni
crontab -e
# idagdag:
0 1 * * * /opt/gemeni/scripts/backup-gemeni.sh >> /var/log/gemeni-backup.log 2>&1
```

> Ilipat din ang `/var/backups/gemeni` sa ibang makina o NAS paminsan-minsan —
> walang silbi ang backup na nasa parehong server na nasira.

### Restore mula sa backup

```bash
gemeni stop api worker
cat /var/backups/gemeni/gemeni-db-YYYYMMDD-HHMMSS.dump | \
  gemeni exec -T postgres pg_restore -U gemerp -d gemerp --clean --if-exists
gemeni start api worker
```

---

## 10. Opsyonal: HTTPS at domain

Kailangan lang kung ipapalabas sa internet, o kung gusto ng padlock icon sa LAN.
Pinakamadali ang Caddy (kusang kumukuha ng certificate):

1. Dagdagan ang `docker-compose.prod.yml` ng `caddy` service na naka-forward sa
   `web:3000`, ports 80 at 443.
2. Palitan sa `.env.prod`: `WEB_ORIGIN=https://gemeni.gemcor.com.ph` at
   **`SESSION_COOKIE_SECURE=true`**.
3. Alisin ang `ports` ng `web` para dumaan lahat sa Caddy.

Para sa totoong certificate kailangan ng public DNS name at bukas na port 80/443
mula sa labas. Sa LAN-only, internal CA o self-signed — sabihan mo lang ako at
ilalagay ko ang buong config.

---

## 11. Kapag may problema

| Sintomas | Dahilan at ayos |
|---|---|
| **Tama ang password pero "walang nangyayari"** (na-detect naman ang mali) | **Ito ang pinakamadalas.** `SESSION_COOKIE_SECURE=true` habang `http://` ang site → may `Secure` flag ang login cookie → tahimik itong binabasura ng browser → balik sa login, walang error. Ayos: gawing `false` sa `.env.prod`, tapos `gemeni up -d` (hindi kailangan ng `--build`). Paliwanag: kung na-detect ang maling password, gumagana ang buong pipeline — ang cookie lang ang problema. |
| "Invalid email or password" kahit tama | Hindi pa na-seed ang database — §6. |
| Naka-login pero agad na-logout | Pareho ng una sa itaas — `SESSION_COOKIE_SECURE`. |
| Hindi ma-open mula sa ibang PC | Firewall (§7), o maling IP. Test sa server mismo: `curl -I http://localhost:3000/login`. |
| Blangko ang QR scan / mali ang link | Mali ang `WEB_ORIGIN` — dapat eksakto sa tina-type ng users. Ayusin, `gemeni up -d`, tapos i-print ulit ang labels. |
| "storage disabled" sa attachments | `S3_ENABLED=false` sa `.env.prod` — gawing `true` (dapat `true` sa on-prem). |
| Hindi natatapos ang exports | Patay ang worker: `gemeni logs worker`. Karaniwan ay maling `REDIS_PASSWORD`. |
| Ayaw mag-start ng `api`, may migration error | `gemeni logs api`. Kung nasira ang database, i-restore (§9). |
| `pull access denied ... repository does not exist` | Nawala o lumipat ng registry ang isang image — hindi ito problema ng server mo. Kumpirmahin sa ibang makina: `docker pull <image>`. Ganito ang nangyari sa MinIO noong Sept 2026 (lumipat sa `quay.io/minio/minio`). Ayos: `git pull` para makuha ang na-update na compose file. |
| Puno ang disk | `docker system prune -a` (mag-iingat: binubura ang unused images), at tignan ang laki ng backups. |
| Ayaw mag-build, "no space left" | Kulang ang disk sa `/var/lib/docker` — palakihin o ilipat. |

Mabilisang health check ng lahat:

```bash
gemeni exec api node -e "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
```

Dapat `up` ang postgres, redis, **at** minio.

---

## 12. Security checklist bago ibigay sa users

- [ ] Napalitan na ang password ng super admin sa unang pag-login (§6)
- [ ] Malalakas at magkakaiba ang `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `S3_SECRET_KEY`
- [ ] Hindi naka-commit ang `.env.prod` (naka-gitignore na) at may kopya sa ligtas na lugar
- [ ] Naka-restrict ang MinIO console port 9001 — isara kung hindi kailangan
  (i-comment ang `ports` ng `minio` sa compose file)
- [ ] Gumagana ang backup at nasubukang ma-restore nang isang beses
- [ ] Naka-schedule ang OS updates sa server
- [ ] Alam ng isa pang tao sa team kung paano i-restart at i-restore

---

## Tala: paglilinis ng database na may demo data na

Kung nauna kang nakapagpatakbo ng development seed (`seed` na walang `:prod`) sa
server, may demo data ka na. Habang **wala pang totoong data**, ito ang
pinakamalinis na paraan para magsimula ulit:

```bash
cd /opt/gemeni
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -e SUPERADMIN_EMAIL=superadmin@gemcor.ph \
  api pnpm --filter @gemerp/database seed:prod
```

⚠️ **Buburahin ng `down -v` ang buong database.** Huwag na huwag itong gagamitin
kapag may totoo nang data — mag-backup muna (§9).
