# GEM-ENI — Dev Accounts & Access Cheat Sheet

> ⚠️ **DEV ONLY.** These accounts exist only in the local development database
> (created by `pnpm db:seed`). Never use them in staging or production.

## Where to log in

| What | URL |
| --- | --- |
| **🌐 LIVE (production)** | <https://gem-erp.vercel.app> ← **ito ang i-share sa users** |
| Web app (local dev) | <http://localhost:3000> |
| API base | <http://localhost:3001/api/v1> |
| Swagger (API docs) | <http://localhost:3001/api/docs> |
| MinIO console | <http://localhost:9001> (user `gemerp` / `gemerp_dev_password`) |
| Postgres | `localhost:5433`, db `gemerp`, user `gemerp` / `gemerp_dev_password` |

## Accounts

**Lahat ng accounts, iisa ang password:** `ChangeMe!123` — **LOCAL DEV LANG ITO.**

> ⚠️ **PRODUCTION (gem-erp.vercel.app): iba na ang passwords** — rotated 2026-08-11.
> Nasa `user_access_prod.md` (local file, naka-gitignore, hindi kailanman iko-commit).

| Email | Role | Branch access | Ano ang kaya niya |
| --- | --- | --- | --- |
| `superadmin@gemcor.dev` | Super Admin | **All branches** | Lahat — users, roles, branches, employees, items, lookups, imports, audit log, costs |
| `branchadmin@gemcor.dev` | Branch Admin | Subic + Makati | Manage users/employees/items/lookups within both branches, view costs & reports |
| `warehouse@gemcor.dev` | Warehouse Custodian | Subic only | Inventory operations (receive/issue/transfer/count — Phase 3), view items; **walang** cost fields |
| `assets@gemcor.dev` | Asset Custodian | Subic only | Serialized asset registration/assignment/transfer (Phase 3) |
| `maintenance@gemcor.dev` | Maintenance Personnel | Subic only | Maintenance work orders + parts (Phase 5) |
| `auditor@gemcor.dev` | Auditor / Viewer | Subic only | **Read-only** — reports, ledgers, audit logs |
| `employee@gemcor.dev` | Employee / Requester | Subic only | Own assigned assets, requests, acknowledgments — pinaka-limited |

## Sinong account ang gamitin sa pag-test?

- **General testing / admin screens** → `superadmin@gemcor.dev`
- **Branch isolation** (dapat Subic lang makita) → `auditor@gemcor.dev`
- **Permission denials** (dapat maraming 403 / nakatagong menus) → `employee@gemcor.dev`
- **Cost-field hiding** (walang standard/last cost sa items) → `warehouse@gemcor.dev`
- **Multi-branch pero hindi superadmin** → `branchadmin@gemcor.dev`

## Seeded sample data (for reference)

- **Branches:** `SUB` GemCor - Subic (2 warehouses), `MKT` GemCor - Makati (1 warehouse)
- **Employees:** `EMP-000001` … `EMP-000008` (hindi ito login accounts — records lang;
  si `EMP-000005` ay naka-link sa `employee@gemcor.dev`)
- **Items:** 12 items — laptops/monitors (serialized), office supplies (quantity),
  alcohol (lot + expiry), chairs/tools (bulk)
- **Departments:** ADMIN, OPS, WHS, MNT · **UOMs:** PC/BOX/PACK/REAM/SET/ROLL
  (1 BOX = 10 PACK, 1 PACK = 100 PC, 1 REAM = 500 PC)

## Kapag nakalimutan o nasira ang data

```bash
pnpm db:seed        # idempotent — ibabalik/aayusin ang lahat ng nasa itaas
```

Kung gusto mong palitan ang password ng isang account: login as that user →
user menu (top right) → Change password. O kaya as superadmin: Users page →
Reset password.
