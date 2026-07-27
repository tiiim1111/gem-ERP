/**
 * GEM ERP development seed (idempotent - safe to run repeatedly).
 *
 * Seeds the canonical Phase 1 data set:
 * - Organization "GemCor" with branches SUB (Subic) / MKT (Makati)
 * - Warehouses and storage locations per branch (with default locations)
 * - The full permission catalog from @gemerp/shared ALL_PERMISSIONS
 * - The 7 initial roles from @gemerp/shared ROLE_DEFINITIONS
 * - One user per role, password "ChangeMe!123" (argon2id) - DEV ONLY,
 *   never use these credentials outside development
 * - Branch access: non-superadmin users -> SUB (branch admin gets SUB + MKT)
 * - An audit_logs entry recording that seeding ran
 *
 * All writes are upserts keyed on natural unique keys.
 */
import "./load-env";
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { ALL_PERMISSIONS, ROLE_DEFINITIONS } from "@gemerp/shared";

const prisma = new PrismaClient();

const DEV_PASSWORD = "ChangeMe!123";

/** OWASP-recommended argon2id parameters. */
function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  });
}

interface LocationSeed {
  code: string;
  name: string;
  locationType: string;
}

interface WarehouseSeed {
  code: string;
  name: string;
  description: string;
  locations: LocationSeed[];
}

interface BranchSeed {
  code: string;
  name: string;
  city: string;
  warehouses: WarehouseSeed[];
}

const STANDARD_LOCATIONS: LocationSeed[] = [
  { code: "RCV", name: "Receiving Bay", locationType: "RECEIVING" },
  { code: "ISS", name: "Issuance Staging", locationType: "STAGING" },
  { code: "A-01", name: "Rack A-01", locationType: "RACK" },
  { code: "A-02", name: "Rack A-02", locationType: "RACK" },
];

// Real GemCor branches (confirmed by Tim, 2026-07-27).
const BRANCHES: BranchSeed[] = [
  {
    code: "SUB",
    name: "GemCor - Subic",
    city: "Subic",
    warehouses: [
      {
        code: "SUB-WH1",
        name: "Subic Main Warehouse",
        description: "Primary warehouse for GemCor - Subic",
        locations: STANDARD_LOCATIONS,
      },
      {
        code: "SUB-SR1",
        name: "Subic Stockroom",
        description: "Office consumables stockroom",
        locations: [
          { code: "RCV", name: "Receiving Shelf", locationType: "RECEIVING" },
          { code: "ISS", name: "Issuance Counter", locationType: "STAGING" },
          { code: "S-01", name: "Shelf S-01", locationType: "SHELF" },
        ],
      },
    ],
  },
  {
    code: "MKT",
    name: "GemCor - Makati",
    city: "Makati",
    warehouses: [
      {
        code: "MKT-WH1",
        name: "Makati Warehouse",
        description: "Primary warehouse for GemCor - Makati",
        locations: STANDARD_LOCATIONS,
      },
    ],
  },
];

interface UserSeed {
  email: string;
  displayName: string;
  roleCode: string;
  branchCodes: string[];
}

/** Non-superadmin users get Subic access only; branch admin gets both branches. */
const USERS: UserSeed[] = [
  { email: "superadmin@gemcor.dev", displayName: "Super Admin", roleCode: "SUPER_ADMIN", branchCodes: [] },
  { email: "branchadmin@gemcor.dev", displayName: "Branch Admin", roleCode: "BRANCH_ADMIN", branchCodes: ["SUB", "MKT"] },
  { email: "warehouse@gemcor.dev", displayName: "Warehouse Custodian", roleCode: "WAREHOUSE_CUSTODIAN", branchCodes: ["SUB"] },
  { email: "assets@gemcor.dev", displayName: "Asset Custodian", roleCode: "ASSET_CUSTODIAN", branchCodes: ["SUB"] },
  { email: "maintenance@gemcor.dev", displayName: "Maintenance Personnel", roleCode: "MAINTENANCE_PERSONNEL", branchCodes: ["SUB"] },
  { email: "auditor@gemcor.dev", displayName: "Auditor", roleCode: "AUDITOR", branchCodes: ["SUB"] },
  { email: "employee@gemcor.dev", displayName: "Employee Requester", roleCode: "EMPLOYEE", branchCodes: ["SUB"] },
];

function permissionParts(code: string): { resource: string; action: string } {
  const lastDot = code.lastIndexOf(".");
  if (lastDot <= 0) {
    return { resource: code, action: code };
  }
  return { resource: code.slice(0, lastDot), action: code.slice(lastDot + 1) };
}

async function seedOrganizationAndBranches(): Promise<Map<string, string>> {
  const organization = await prisma.organization.upsert({
    where: { code: "GEMCOR" },
    update: { name: "GemCor", timezone: "Asia/Manila", currencyCode: "PHP", isActive: true },
    create: {
      code: "GEMCOR",
      name: "GemCor",
      timezone: "Asia/Manila",
      currencyCode: "PHP",
    },
  });

  const branchIdsByCode = new Map<string, string>();

  for (const branchSeed of BRANCHES) {
    const branch = await prisma.branch.upsert({
      where: { code: branchSeed.code },
      update: { name: branchSeed.name, city: branchSeed.city, isActive: true },
      create: {
        organizationId: organization.id,
        code: branchSeed.code,
        name: branchSeed.name,
        city: branchSeed.city,
      },
    });
    branchIdsByCode.set(branchSeed.code, branch.id);

    for (const warehouseSeed of branchSeed.warehouses) {
      const warehouse = await prisma.warehouse.upsert({
        where: { branchId_code: { branchId: branch.id, code: warehouseSeed.code } },
        update: { name: warehouseSeed.name, description: warehouseSeed.description, isActive: true },
        create: {
          branchId: branch.id,
          code: warehouseSeed.code,
          name: warehouseSeed.name,
          description: warehouseSeed.description,
        },
      });

      const locationIdsByCode = new Map<string, string>();
      for (const [index, locationSeed] of warehouseSeed.locations.entries()) {
        const location = await prisma.storageLocation.upsert({
          where: { warehouseId_code: { warehouseId: warehouse.id, code: locationSeed.code } },
          update: { name: locationSeed.name, locationType: locationSeed.locationType, isActive: true },
          create: {
            warehouseId: warehouse.id,
            code: locationSeed.code,
            name: locationSeed.name,
            locationType: locationSeed.locationType,
            sortOrder: index,
            barcode: `BIN-${branchSeed.code}-${warehouseSeed.code}-${locationSeed.code}`,
          },
        });
        locationIdsByCode.set(locationSeed.code, location.id);
      }

      await prisma.warehouse.update({
        where: { id: warehouse.id },
        data: {
          defaultReceivingLocationId: locationIdsByCode.get("RCV") ?? null,
          defaultIssueLocationId: locationIdsByCode.get("ISS") ?? null,
        },
      });
    }
  }

  return branchIdsByCode;
}

async function seedPermissions(): Promise<Map<string, string>> {
  const permissionIdsByCode = new Map<string, string>();
  for (const code of ALL_PERMISSIONS) {
    const { resource, action } = permissionParts(code);
    const permission = await prisma.permission.upsert({
      where: { code },
      update: { resource, action },
      create: { code, resource, action },
    });
    permissionIdsByCode.set(code, permission.id);
  }
  return permissionIdsByCode;
}

async function seedRoles(permissionIdsByCode: Map<string, string>): Promise<Map<string, string>> {
  const roleIdsByCode = new Map<string, string>();

  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.upsert({
      where: { code: definition.code },
      update: {
        name: definition.name,
        description: definition.description,
        isSystem: definition.isSystem,
        isActive: true,
      },
      create: {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystem: definition.isSystem,
      },
    });
    roleIdsByCode.set(definition.code, role.id);

    const permissionIds: string[] = [];
    for (const permissionCode of definition.permissions) {
      const permissionId = permissionIdsByCode.get(permissionCode);
      if (!permissionId) {
        throw new Error(
          `Role ${definition.code} references unknown permission "${permissionCode}" - it is missing from ALL_PERMISSIONS`,
        );
      }
      permissionIds.push(permissionId);
    }

    // Make role_permissions exactly match the definition (authoritative sync).
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: permissionIds } },
    });
    if (permissionIds.length > 0) {
      await prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }

  return roleIdsByCode;
}

async function seedUsers(
  roleIdsByCode: Map<string, string>,
  branchIdsByCode: Map<string, string>,
): Promise<void> {
  for (const userSeed of USERS) {
    const roleId = roleIdsByCode.get(userSeed.roleCode);
    if (!roleId) {
      throw new Error(`Unknown role code ${userSeed.roleCode} for ${userSeed.email}`);
    }

    const existing = await prisma.user.findUnique({ where: { email: userSeed.email } });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { displayName: userSeed.displayName, isActive: true },
        })
      : await prisma.user.create({
          data: {
            email: userSeed.email,
            displayName: userSeed.displayName,
            passwordHash: await hashPassword(DEV_PASSWORD),
          },
        });

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId } },
      update: {},
      create: { userId: user.id, roleId },
    });

    for (const branchCode of userSeed.branchCodes) {
      const branchId = branchIdsByCode.get(branchCode);
      if (!branchId) {
        throw new Error(`Unknown branch code ${branchCode} for ${userSeed.email}`);
      }
      await prisma.userBranchAccess.upsert({
        where: { userId_branchId: { userId: user.id, branchId } },
        update: {},
        create: { userId: user.id, branchId },
      });
    }
  }
}

async function main(): Promise<void> {
  console.log("Seeding GEM ERP development data...");

  const branchIdsByCode = await seedOrganizationAndBranches();
  console.log(`  Organization + ${branchIdsByCode.size} branches (with warehouses and storage locations)`);

  const permissionIdsByCode = await seedPermissions();
  console.log(`  ${permissionIdsByCode.size} permissions`);

  const roleIdsByCode = await seedRoles(permissionIdsByCode);
  console.log(`  ${roleIdsByCode.size} roles (with role permissions)`);

  await seedUsers(roleIdsByCode, branchIdsByCode);
  console.log(`  ${USERS.length} users (password: ${DEV_PASSWORD} - DEV ONLY)`);

  await prisma.auditLog.create({
    data: {
      action: "system.seed",
      resourceType: "system",
      metadata: {
        branches: branchIdsByCode.size,
        permissions: permissionIdsByCode.size,
        roles: roleIdsByCode.size,
        users: USERS.length,
      },
      reason: "Development seed executed",
    },
  });
  console.log("  Audit log entry recorded");

  console.log("Seed complete.");
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
