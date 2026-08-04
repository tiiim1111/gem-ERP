# GEM-ENI — GEM ERP and Inventory

Asset & Inventory Management system for **GemCor** — a single-company, multi-branch platform
covering serialized assets, consumable inventory, procurement, employee custodianship,
maintenance, approvals, reporting, and immutable audit history.

The authoritative product and engineering spec lives in
[`asset-inventory-system-codex-master-prompt.md`](./asset-inventory-system-codex-master-prompt.md).
The running project log is [`WORKLOG.md`](./WORKLOG.md) — read it before continuing work.
Design docs live in [`docs/`](./docs/) (architecture, barcode strategy, and friends).

## Stack

| Layer | Technology |
| --- | --- |
| Web | Next.js 15 (App Router), React, Tailwind CSS, TanStack Query/Table — `apps/web`, port 3000 |
| API | NestJS 11, REST under `/api/v1`, Swagger UI at `/api/docs` — `apps/api`, port 3001 |
| Worker | BullMQ consumer for jobs/alerts — `apps/worker` |
| Database | PostgreSQL 16 + Prisma (schema, migrations, seed) — `packages/database` |
| Queue | Redis 7 + BullMQ |
| Object storage | MinIO (S3-compatible) for attachments |
| Shared code | `packages/shared` (permissions, roles, API types), `packages/config` (tsconfig/eslint presets) |
| Tooling | pnpm 9 workspaces + Turborepo, TypeScript strict everywhere |

Sessions are server-side HTTP-only cookies (`gemerp_session`), passwords are argon2id,
all timestamps are stored in UTC (display timezone Asia/Manila), default currency PHP.

## Repository layout

```text
apps/
  web/        @gemerp/web      — Next.js frontend (port 3000)
  api/        @gemerp/api      — NestJS REST API (port 3001)
  worker/     @gemerp/worker   — BullMQ background worker
packages/
  database/   @gemerp/database — Prisma schema, client, migrations, seed
  shared/     @gemerp/shared   — permission catalog, role definitions, shared types
  config/     @gemerp/config   — shared tsconfig and ESLint presets
docs/         architecture and design documentation
```

## Prerequisites

- **Node.js 22+** (see `.nvmrc`)
- **pnpm 9** via corepack: `corepack enable && corepack prepare pnpm@9.15.9 --activate`
- **Docker Desktop** with WSL integration enabled (for Postgres, Redis, MinIO).
  On Windows/WSL2: Docker Desktop → Settings → Resources → WSL Integration → enable your distro.

## Quick start

```bash
# 1. Environment
cp .env.example .env

# 2. Infrastructure (Postgres 16, Redis 7, MinIO + bucket)
docker compose up -d

# 3. Dependencies
pnpm install

# 4. Database schema + dev data
pnpm db:migrate
pnpm db:seed

# 5. Run everything (web :3000, api :3001, worker)
pnpm dev
```

Then open:

- Web app: <http://localhost:3000>
- API: <http://localhost:3001/api/v1> (health: `/api/v1/health`)
- Swagger UI: <http://localhost:3001/api/docs>
- MinIO console: <http://localhost:9001> (user `gemerp`, password `gemerp_dev_password`)

### Root scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run all apps in dev/watch mode (Turborepo) |
| `pnpm build` | Build all packages and apps |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Lint / typecheck / test the whole workspace |
| `pnpm db:generate` | Generate the Prisma client (`@gemerp/database`) |
| `pnpm db:migrate` | Apply committed Prisma migrations (`prisma migrate deploy`) |
| `pnpm db:migrate:dev` | Create + apply a new migration after schema changes (`prisma migrate dev`) |
| `pnpm db:seed` | Seed development data (idempotent — safe to re-run) |
| `pnpm db:studio` | Open Prisma Studio to browse the database |
| `pnpm format` / `pnpm format:check` | Prettier write / check |

## Development seed credentials

> **WARNING — DEV ONLY.** These accounts are created by `pnpm db:seed` for local
> development. They must **NEVER** exist in staging or production. Production
> credentials are provisioned separately, and the seed refuses to double as a
> production bootstrap.

All seed users share the password **`ChangeMe!123`**. Quick cheat sheet:
[`user_access.md`](./user_access.md).

| Email | Role | Branch access |
| --- | --- | --- |
| `superadmin@gemcor.dev` | Super Admin | All branches |
| `branchadmin@gemcor.dev` | Branch Admin | SUB, MKT |
| `warehouse@gemcor.dev` | Warehouse Custodian | SUB |
| `assets@gemcor.dev` | Asset Custodian | SUB |
| `maintenance@gemcor.dev` | Maintenance Personnel | SUB |
| `auditor@gemcor.dev` | Auditor / Viewer | SUB |
| `employee@gemcor.dev` | Employee / Requester | SUB |

Seed branches: **SUB** GemCor - Subic, **MKT** GemCor - Makati.

## Troubleshooting

### `docker: command not found` inside WSL

Docker Desktop's WSL integration is off. Docker Desktop → Settings → Resources →
WSL Integration → toggle your distro on → restart the terminal. Verify with `docker info`.

### Port already in use (3000/3001/5433/6379/9000/9001)

Something on the host holds the port — commonly a local Postgres (5432 — which is why GEM ERP maps Postgres to host port 5433 by default) or Redis (6379)
service, or another dev server. Find it with `ss -tlnp | grep <port>` and stop it, or
change the mapping: app ports via `API_PORT` / Next's `--port`, infrastructure ports in
`docker-compose.yml` (update the matching URL in `.env` too).

### Prisma engine errors (`Query engine library ... not found`, openssl mismatch)

The Prisma client was generated for a different platform or not at all:

```bash
pnpm db:generate
```

If it persists after switching Node versions or moving between Windows and WSL, remove
`node_modules` and reinstall (`rm -rf node_modules && pnpm install`). Keep the repo inside
the WSL filesystem (`~/projects/...`), not under `/mnt/c/` — Prisma and file watching are
dramatically slower and flakier on the Windows mount.

### `ERR_PNPM_UNSUPPORTED_ENGINE` / wrong pnpm version

The repo pins `pnpm@9.15.9` via the `packageManager` field. Use corepack so the right
version activates automatically: `corepack enable && corepack prepare pnpm@9.15.9 --activate`.

### MinIO bucket missing

The `minio-init` one-shot container creates `gemerp-attachments` on `docker compose up`.
If it was skipped, re-run `docker compose up minio-init` or create the bucket in the
console at <http://localhost:9001>.
