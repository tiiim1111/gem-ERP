# Deploying GEM-ENI on an on-premise Linux server

Runbook para ilagay ang buong sistema sa sariling server ng GemCor — walang
cloud, walang buwanang bayad, at gumagana ang attachments at exports (hindi
katulad ng Railway setup kung saan naka-off ang file storage).

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

> **Tandaan:** hiwalay ang on-premise na ito sa https://gem-erp.vercel.app.
> Magkaibang database, magkaibang data. Hindi sila nagsi-sync.

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

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec api pnpm --filter @gemerp/database seed
```

Ito ang gumagawa ng permissions, roles, ang dalawang branches (SUB at MKT), at
sample data para may makita agad. Idempotent — ligtas ulitin.

### 🔐 Agad na palitan ang passwords

Ang seed ay gumagawa ng pitong account na `ChangeMe!123` ang password. **Bago
ibigay sa mga users**, buksan ang app sa browser, mag-login bilang
`superadmin@gemcor.dev`, tapos:

1. **Users** → bawat account → Reset password → bagong password
2. O mas mainam: gumawa ng totoong accounts para sa mga tao mo, tapos
   i-deactivate ang mga demo account.

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
| "Invalid email or password" kahit tama | (a) Hindi pa na-seed — §6. (b) Naka-`SESSION_COOKIE_SECURE=true` pero `http://` ang site — gawing `false`, tapos `gemeni up -d`. |
| Naka-login pero agad na-logout | Pareho ng taas — `SESSION_COOKIE_SECURE`. |
| Hindi ma-open mula sa ibang PC | Firewall (§7), o maling IP. Test sa server mismo: `curl -I http://localhost:3000/login`. |
| Blangko ang QR scan / mali ang link | Mali ang `WEB_ORIGIN` — dapat eksakto sa tina-type ng users. Ayusin, `gemeni up -d`, tapos i-print ulit ang labels. |
| "storage disabled" sa attachments | `S3_ENABLED=false` sa `.env.prod` — gawing `true` (dapat `true` sa on-prem). |
| Hindi natatapos ang exports | Patay ang worker: `gemeni logs worker`. Karaniwan ay maling `REDIS_PASSWORD`. |
| Ayaw mag-start ng `api`, may migration error | `gemeni logs api`. Kung nasira ang database, i-restore (§9). |
| Puno ang disk | `docker system prune -a` (mag-iingat: binubura ang unused images), at tignan ang laki ng backups. |
| Ayaw mag-build, "no space left" | Kulang ang disk sa `/var/lib/docker` — palakihin o ilipat. |

Mabilisang health check ng lahat:

```bash
gemeni exec api node -e "fetch('http://127.0.0.1:3001/api/v1/health/ready').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2)))"
```

Dapat `up` ang postgres, redis, **at** minio.

---

## 12. Security checklist bago ibigay sa users

- [ ] Napalitan na ang lahat ng seed passwords (§6)
- [ ] Malalakas at magkakaiba ang `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `S3_SECRET_KEY`
- [ ] Hindi naka-commit ang `.env.prod` (naka-gitignore na) at may kopya sa ligtas na lugar
- [ ] Naka-restrict ang MinIO console port 9001 — isara kung hindi kailangan
  (i-comment ang `ports` ng `minio` sa compose file)
- [ ] Gumagana ang backup at nasubukang ma-restore nang isang beses
- [ ] Naka-schedule ang OS updates sa server
- [ ] Alam ng isa pang tao sa team kung paano i-restart at i-restore

---

## Tala: demo data sa totoong rollout

Kasama sa seed ang sample items, suppliers, POs, work orders, at approval
workflows para may makita agad. Kapag handa na sa totoong data ng GemCor,
dalawa ang pwede:

1. **Simple:** gamitin ang demo bilang training sandbox muna, tapos linisin ang
   hindi kailangan sa UI (archive/deactivate) bago mag-encode ng totoo.
2. **Malinis na simula:** sabihan mo lang ako at gagawa ako ng "minimal seed"
   mode na permissions, roles, branches, at users lang ang gagawin — walang
   sample data.
