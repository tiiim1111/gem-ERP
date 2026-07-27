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
