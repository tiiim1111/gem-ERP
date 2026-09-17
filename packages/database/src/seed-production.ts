/**
 * GEM-ENI production bootstrap — the minimum a real deployment needs.
 *
 *   SUPERADMIN_EMAIL=admin@yourcompany.ph pnpm --filter @gemerp/database seed:prod
 *
 * Creates ONLY what cannot be created through the app:
 *   - the organization row
 *   - the permission catalog and system roles (both defined in code)
 *   - one super-admin account so someone can sign in
 *   - the lookup vocabulary and base units of measure (editable in the app)
 *
 * It creates NO branches, warehouses, employees, items, suppliers or documents
 * — you build those in the app with your real data. Idempotent: safe to re-run
 * (it syncs permissions/roles after an upgrade without touching your data).
 *
 * Environment:
 *   SUPERADMIN_EMAIL     required
 *   SUPERADMIN_PASSWORD  optional — a strong one is generated and printed once
 *   SUPERADMIN_NAME      optional — display name (default "Super Admin")
 *   ORG_CODE/ORG_NAME/ORG_TIMEZONE/ORG_CURRENCY  optional overrides
 */
import "./load-env";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import {
  DEFAULT_ORGANIZATION,
  hashPassword,
  seedLookupValues,
  seedOrganization,
  seedPermissions,
  seedRoles,
  seedUomsAndConversions,
} from "./baseline";

const prisma = new PrismaClient();

/** 24 URL-safe characters — strong enough that rotation is optional. */
function generatePassword(): string {
  return randomBytes(24).toString("base64url").slice(0, 24);
}

function requireEmail(): string {
  const email = process.env.SUPERADMIN_EMAIL?.trim();
  if (!email) {
    console.error(
      "SUPERADMIN_EMAIL is required.\n\n" +
        "  SUPERADMIN_EMAIL=admin@yourcompany.ph pnpm --filter @gemerp/database seed:prod\n",
    );
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`SUPERADMIN_EMAIL "${email}" is not a valid email address.`);
    process.exit(1);
  }
  return email.toLowerCase();
}

async function main(): Promise<void> {
  const email = requireEmail();
  const suppliedPassword = process.env.SUPERADMIN_PASSWORD?.trim();
  const password = suppliedPassword || generatePassword();
  const generated = !suppliedPassword;
  const displayName = process.env.SUPERADMIN_NAME?.trim() || "Super Admin";

  console.log("Bootstrapping GEM-ENI for production...\n");

  const organization = {
    code: process.env.ORG_CODE?.trim() || DEFAULT_ORGANIZATION.code,
    name: process.env.ORG_NAME?.trim() || DEFAULT_ORGANIZATION.name,
    timezone: process.env.ORG_TIMEZONE?.trim() || DEFAULT_ORGANIZATION.timezone,
    currencyCode: process.env.ORG_CURRENCY?.trim() || DEFAULT_ORGANIZATION.currencyCode,
  };
  await seedOrganization(prisma, organization);
  console.log(`  Organization ${organization.name} (${organization.code}), ${organization.timezone}, ${organization.currencyCode}`);

  const permissionIdsByCode = await seedPermissions(prisma);
  console.log(`  ${permissionIdsByCode.size} permissions`);

  const roleIdsByCode = await seedRoles(prisma, permissionIdsByCode);
  console.log(`  ${roleIdsByCode.size} roles (with role permissions)`);

  const lookupCount = await seedLookupValues(prisma);
  console.log(`  ${lookupCount} lookup values (editable under Lookups)`);

  const { uomIdsByCode, conversions } = await seedUomsAndConversions(prisma);
  console.log(`  ${uomIdsByCode.size} units of measure + ${conversions} conversions`);

  const superAdminRoleId = roleIdsByCode.get("SUPER_ADMIN");
  if (!superAdminRoleId) {
    throw new Error("SUPER_ADMIN role missing from ROLE_DEFINITIONS");
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Re-run: keep the existing password, just make sure the account is usable.
    await prisma.user.update({
      where: { id: existing.id },
      data: { isActive: true, displayName },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: existing.id, roleId: superAdminRoleId } },
      update: {},
      create: { userId: existing.id, roleId: superAdminRoleId },
    });
    console.log(`  Super admin ${email} already exists — password left unchanged`);
  } else {
    const user = await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash: await hashPassword(password),
        // A generated password must be replaced by its owner on first sign-in.
        mustChangePassword: generated,
      },
    });
    await prisma.userRole.create({
      data: { userId: user.id, roleId: superAdminRoleId },
    });
    console.log(`  Super admin ${email} created`);
  }

  await prisma.auditLog.create({
    data: {
      action: "system.bootstrap",
      resourceType: "system",
      metadata: {
        organization: organization.code,
        permissions: permissionIdsByCode.size,
        roles: roleIdsByCode.size,
        lookupValues: lookupCount,
        uoms: uomIdsByCode.size,
        superAdmin: email,
      },
      reason: "Production bootstrap executed",
    },
  });

  console.log("\nBootstrap complete — no demo data was created.\n");

  if (!existing && generated) {
    console.log("========================================================");
    console.log("  SIGN IN WITH THESE CREDENTIALS — SHOWN ONLY ONCE");
    console.log("");
    console.log(`    email:    ${email}`);
    console.log(`    password: ${password}`);
    console.log("");
    console.log("  You must change this password on first sign-in.");
    console.log("========================================================\n");
  }

  console.log("Next steps in the app:");
  console.log("  1. Sign in and change your password");
  console.log("  2. Branches -> add your branches, warehouses and storage locations");
  console.log("  3. Lookups -> review the vocabulary, Items -> add your catalog");
  console.log("  4. Users -> create accounts for your team\n");
}

main()
  .catch((error: unknown) => {
    console.error("Bootstrap failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
