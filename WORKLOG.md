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
