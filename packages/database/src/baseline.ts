/**
 * Baseline data shared by the development seed and the production bootstrap.
 *
 * Everything here is *structural* — it cannot be created through the UI, or the
 * app needs it to function at all:
 *   - the organization row every branch hangs off
 *   - the permission catalog and the system roles (both defined in code)
 *   - the spec section-10 lookup vocabulary and the base units of measure
 *
 * Business data (branches, warehouses, employees, items, suppliers…) is NOT
 * here: production creates it through the app, development adds demo rows in
 * seed.ts.
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { ALL_PERMISSIONS, ROLE_DEFINITIONS } from "@gemerp/shared";

/** OWASP-recommended argon2id parameters. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456, // 19 MiB
    timeCost: 2,
    parallelism: 1,
  });
}

function permissionParts(code: string): { resource: string; action: string } {
  const lastDot = code.lastIndexOf(".");
  if (lastDot <= 0) {
    return { resource: code, action: code };
  }
  return { resource: code.slice(0, lastDot), action: code.slice(lastDot + 1) };
}

export interface OrganizationSeed {
  code: string;
  name: string;
  timezone: string;
  currencyCode: string;
}

export const DEFAULT_ORGANIZATION: OrganizationSeed = {
  code: "GEMCOR",
  name: "GemCor",
  timezone: "Asia/Manila",
  currencyCode: "PHP",
};

export async function seedOrganization(
  prisma: PrismaClient,
  seed: OrganizationSeed = DEFAULT_ORGANIZATION,
): Promise<string> {
  const organization = await prisma.organization.upsert({
    where: { code: seed.code },
    update: {
      name: seed.name,
      timezone: seed.timezone,
      currencyCode: seed.currencyCode,
      isActive: true,
    },
    create: seed,
  });
  return organization.id;
}

/** The full permission catalog from @gemerp/shared. */
export async function seedPermissions(
  prisma: PrismaClient,
): Promise<Map<string, string>> {
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

/** The system roles, with role_permissions synced to match the definitions. */
export async function seedRoles(
  prisma: PrismaClient,
  permissionIdsByCode: Map<string, string>,
): Promise<Map<string, string>> {
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

export const UOMS = [
  { code: "PC", name: "Piece" },
  { code: "BOX", name: "Box" },
  { code: "PACK", name: "Pack" },
  { code: "REAM", name: "Ream" },
  { code: "SET", name: "Set" },
  { code: "ROLL", name: "Roll" },
];

/** Global conversions: 1 from = factor x to (spec section 5 examples). */
export const GLOBAL_CONVERSIONS = [
  { from: "BOX", to: "PACK", factor: 10 },
  { from: "PACK", to: "PC", factor: 100 },
  { from: "REAM", to: "PC", factor: 500 },
];

export async function seedUomsAndConversions(prisma: PrismaClient): Promise<{
  uomIdsByCode: Map<string, string>;
  conversions: number;
}> {
  const uomIdsByCode = new Map<string, string>();
  for (const seed of UOMS) {
    const uom = await prisma.unitOfMeasure.upsert({
      where: { code: seed.code },
      update: { name: seed.name, isActive: true },
      create: { code: seed.code, name: seed.name },
    });
    uomIdsByCode.set(seed.code, uom.id);
  }

  for (const seed of GLOBAL_CONVERSIONS) {
    const fromUomId = uomIdsByCode.get(seed.from) as string;
    const toUomId = uomIdsByCode.get(seed.to) as string;
    // Global conversions carry itemId NULL, which a compound-unique upsert
    // cannot target - emulate the upsert with findFirst + create/update.
    const existing = await prisma.uomConversion.findFirst({
      where: { itemId: null, fromUomId, toUomId },
    });
    if (existing) {
      await prisma.uomConversion.update({
        where: { id: existing.id },
        data: { factor: seed.factor },
      });
    } else {
      await prisma.uomConversion.create({
        data: { itemId: null, fromUomId, toUomId, factor: seed.factor },
      });
    }
  }
  return { uomIdsByCode, conversions: GLOBAL_CONVERSIONS.length };
}

/** Spec section-10 business-managed lookup values (editable in the app). */
export const LOOKUP_VALUES: Record<string, Array<{ code: string; name: string }>> = {
  ASSET_CONDITION: [
    { code: "NEW", name: "New" },
    { code: "GOOD", name: "Good" },
    { code: "FAIR", name: "Fair" },
    { code: "POOR", name: "Poor" },
    { code: "DEFECTIVE", name: "Defective" },
  ],
  TRANSACTION_REASON: [
    { code: "NEW_ISSUE", name: "New issuance" },
    { code: "REPLACEMENT", name: "Replacement" },
    { code: "DEPT_CONSUMPTION", name: "Department consumption" },
    { code: "RETURN_UNUSED", name: "Return - unused" },
    { code: "TEMPORARY_BORROW", name: "Temporary borrow" },
  ],
  ADJUSTMENT_REASON: [
    { code: "COUNT_VARIANCE", name: "Physical count variance" },
    { code: "DAMAGED", name: "Damaged" },
    { code: "EXPIRED", name: "Expired" },
    { code: "FOUND", name: "Found / recovered" },
    { code: "DATA_CORRECTION", name: "Data correction" },
  ],
  DISPOSAL_METHOD: [
    { code: "SOLD", name: "Sold" },
    { code: "SCRAPPED", name: "Scrapped" },
    { code: "DONATED", name: "Donated" },
    { code: "TRADED_IN", name: "Traded in" },
    { code: "DESTROYED", name: "Destroyed" },
  ],
  MAINTENANCE_TYPE: [
    { code: "PREVENTIVE", name: "Preventive" },
    { code: "CORRECTIVE", name: "Corrective" },
    { code: "INSPECTION", name: "Inspection" },
    { code: "CALIBRATION", name: "Calibration" },
    { code: "EMERGENCY", name: "Emergency" },
  ],
  MAINTENANCE_PRIORITY: [
    { code: "LOW", name: "Low" },
    { code: "MEDIUM", name: "Medium" },
    { code: "HIGH", name: "High" },
    { code: "CRITICAL", name: "Critical" },
  ],
  DOCUMENT_TYPE: [
    { code: "DELIVERY_RECEIPT", name: "Delivery receipt" },
    { code: "SALES_INVOICE", name: "Sales invoice" },
    { code: "WARRANTY_CARD", name: "Warranty card" },
    { code: "USER_MANUAL", name: "User manual" },
    { code: "PHOTO", name: "Photo" },
    { code: "CONTRACT", name: "Contract" },
  ],
  NOTIFICATION_TYPE: [
    { code: "LOW_STOCK", name: "Low stock alert" },
    { code: "EXPIRY_WARNING", name: "Lot expiry warning" },
    { code: "MAINTENANCE_DUE", name: "Maintenance due" },
    { code: "APPROVAL_PENDING", name: "Approval pending" },
    { code: "OVERDUE_RETURN", name: "Overdue asset return" },
    { code: "WARRANTY_EXPIRY", name: "Warranty expiring" },
  ],
  SUPPLIER_CATEGORY: [
    { code: "IT_EQUIPMENT", name: "IT equipment" },
    { code: "OFFICE_SUPPLIES", name: "Office supplies" },
    { code: "SAFETY_PPE", name: "Safety & PPE" },
    { code: "SERVICES", name: "Services" },
    { code: "GENERAL", name: "General merchandise" },
  ],
  RETURN_REASON: [
    { code: "DEFECTIVE", name: "Defective on arrival" },
    { code: "WRONG_ITEM", name: "Wrong item delivered" },
    { code: "OVER_DELIVERY", name: "Over-delivery" },
    { code: "EXPIRED", name: "Expired stock" },
    { code: "NOT_AS_SPECIFIED", name: "Not as specified" },
  ],
};

export async function seedLookupValues(prisma: PrismaClient): Promise<number> {
  let count = 0;
  for (const [category, values] of Object.entries(LOOKUP_VALUES)) {
    for (const [index, value] of values.entries()) {
      await prisma.lookupValue.upsert({
        where: { category_code: { category, code: value.code } },
        update: { name: value.name, sortOrder: index + 1, isActive: true },
        create: {
          category,
          code: value.code,
          name: value.name,
          sortOrder: index + 1,
        },
      });
      count += 1;
    }
  }
  return count;
}
