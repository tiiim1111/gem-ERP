# Deploying GEM ERP — Vercel (web) + Railway (API + data)

Test/staging deployment topology. Production hardening is Phase 8.

```
Browser ──HTTPS──► Vercel (apps/web, Next.js)
                      │  same-origin rewrite  /api/v1/*  (cookies stay first-party)
                      ▼
                   Railway (apps/api, NestJS + Postgres + Redis)
```

The web app calls `/api/v1` on its own origin; the Next.js rewrite proxies to the
API (`API_PROXY_TARGET`). No CORS pain, cookies are first-party, and the CSRF
guard accepts proxied same-origin requests (`Sec-Fetch-Site` / forwarded host).

## 1. Railway — API + Postgres + Redis

1. railway.app → New Project → **Deploy from GitHub repo** → pick `tiiim1111/gem-ERP`.
2. In the service settings:
   - **Root Directory:** `/` (repo root)
   - **Builder:** Dockerfile, path `apps/api/Dockerfile`
3. Add plugins to the same project: **PostgreSQL** and **Redis**.
4. Service → Variables:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | reference → Postgres `DATABASE_URL` |
   | `REDIS_URL` | reference → Redis `REDIS_URL` |
   | `NODE_ENV` | `production` |
   | `API_PORT` | `3001` (and set the service's target port to 3001) |
   | `WEB_ORIGIN` | `https://<your-vercel-domain>` (add after step 2 below) |
   | `SESSION_COOKIE_SECURE` | `true` |
   | `S3_ENABLED` | `false` (no MinIO service yet — attachments are Phase 3.5) |

5. Deploy. The container start command runs `prisma migrate deploy` automatically.
6. **One-time seed** (creates roles/permissions + dev data): Railway service →
   ⋮ → Shell (o `railway run` CLI) → `pnpm --filter @gemerp/database seed`
7. Networking → Generate Domain → note it, e.g. `gemerp-api-production.up.railway.app`.
8. Health check path: `/api/v1/health/ready`.

## 2. Vercel — web

1. vercel.com → Add New → Project → import `tiiim1111/gem-ERP`.
2. **Root Directory:** `apps/web` (installs/builds are configured by
   `apps/web/vercel.json` — workspace-aware).
3. Environment variable (build-time):

   | Variable | Value |
   | --- | --- |
   | `API_PROXY_TARGET` | `https://<railway-api-domain>` (from Railway step 7) |

4. Deploy → note the Vercel URL, e.g. `https://gem-erp.vercel.app`.
5. Balikan ang Railway → set `WEB_ORIGIN=https://gem-erp.vercel.app` → redeploy
   ang API (QR scan URLs + CORS/CSRF allowlist ang gumagamit nito).

## 3. Smoke test

- Open the Vercel URL → login `superadmin@gemcor.dev` / seed password.
- Items → add item; Inventory → post a receipt; Ledger shows the entry.
- `https://<railway-domain>/api/v1/health/ready` → `{"status":"ok"...}` (minio: disabled).

## Notes / gotchas

- **Change the seed passwords** — the app is on the public internet now. After
  first login as superadmin: Users → reset each account's password (or create
  real accounts and deactivate the demo ones).
- Railway free trial credit (~$5) burns in days–weeks always-on; expect the
  Hobby plan (~$5/mo) after.
- Web redeploys automatically on push to `main` (Vercel); Railway too. Prisma
  migrations run on every API deploy (`migrate deploy` is idempotent).
- Local development is unchanged: `docker compose up -d` + `pnpm dev`.
- MinIO/attachments: when Phase 3.5 lands, add a MinIO/S3 service (Railway
  template or Cloudflare R2) and flip `S3_ENABLED=true` + `S3_*` vars.
