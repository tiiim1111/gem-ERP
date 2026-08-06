/**
 * GEM ERP development seed (idempotent - safe to run repeatedly).
 *
 * Phase 1 data set:
 * - Organization "GemCor" with branches SUB (Subic) / MKT (Makati)
 * - Warehouses and storage locations per branch (with default locations)
 * - The full permission catalog from @gemerp/shared ALL_PERMISSIONS
 * - The 7 initial roles from @gemerp/shared ROLE_DEFINITIONS
 * - One user per role, password "ChangeMe!123" (argon2id) - DEV ONLY,
 *   never use these credentials outside development
 * - Branch access: non-superadmin users -> SUB (branch admin gets SUB + MKT)
 *
 * Phase 2 data set:
 * - Departments (ADMIN/OPS/WHS/MNT) and positions, ADMIN head wired
 * - 8 employees (EMP-000001...) across SUB/MKT, one linked to
 *   employee@gemcor.dev
 * - UOMs (PC/BOX/PACK/REAM/SET/ROLL) + global conversions
 * - Item categories/subcategories, brands, manufacturers
 * - 12 items covering all business categories and tracking methods, with
 *   primary/alternate barcodes and per-warehouse reorder settings
 * - Spec section-10 generic lookup values
 * - Sequence counters raised past the seeded numbers
 * - An audit_logs entry recording that seeding ran
 *
 * All writes are upserts keyed on natural unique keys.
 */
import "./load-env";
import { BusinessCategory, PrismaClient, TrackingMethod } from "@prisma/client";
import * as argon2 from "argon2";
import { ALL_PERMISSIONS, ROLE_DEFINITIONS } from "@gemerp/shared";
import { seedPhase3Inventory } from "./seed-phase3-inventory";
import { seedPhase3Assets } from "./seed-phase3-assets";
import { seedPhase4Procurement } from "./seed-phase4-procurement";
import { seedPhase5Maintenance } from "./seed-phase5-maintenance";
import { seedPhase6ApprovalsCounts } from "./seed-phase6-approvals-counts";

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

// ---------------------------------------------------------------------------
// Phase 2 seed data
// ---------------------------------------------------------------------------

/** Raise (never lower) a sequence counter so generation skips seeded numbers. */
async function bumpCounter(key: string, minimum: number): Promise<void> {
  await prisma.sequenceCounter.upsert({
    where: { key },
    update: {},
    create: { key, lastValue: BigInt(minimum) },
  });
  await prisma.sequenceCounter.updateMany({
    where: { key, lastValue: { lt: BigInt(minimum) } },
    data: { lastValue: BigInt(minimum) },
  });
}

const DEPARTMENTS = [
  { code: "ADMIN", name: "Administration" },
  { code: "OPS", name: "Operations" },
  { code: "WHS", name: "Warehouse" },
  { code: "MNT", name: "Maintenance" },
];

const POSITIONS = [
  { code: "DEPT_HEAD", name: "Department Head" },
  { code: "SUPERVISOR", name: "Supervisor" },
  { code: "STAFF", name: "Staff" },
  { code: "TECHNICIAN", name: "Technician" },
  { code: "WHS_CLERK", name: "Warehouse Clerk" },
];

async function seedDepartmentsAndPositions(): Promise<{
  departmentIdsByCode: Map<string, string>;
  positionIdsByCode: Map<string, string>;
}> {
  const departmentIdsByCode = new Map<string, string>();
  for (const seed of DEPARTMENTS) {
    const department = await prisma.department.upsert({
      where: { code: seed.code },
      update: { name: seed.name, isActive: true },
      create: { code: seed.code, name: seed.name },
    });
    departmentIdsByCode.set(seed.code, department.id);
  }

  const positionIdsByCode = new Map<string, string>();
  for (const seed of POSITIONS) {
    const position = await prisma.position.upsert({
      where: { code: seed.code },
      update: { name: seed.name, isActive: true },
      create: { code: seed.code, name: seed.name },
    });
    positionIdsByCode.set(seed.code, position.id);
  }
  return { departmentIdsByCode, positionIdsByCode };
}

interface EmployeeSeed {
  employeeNumber: string;
  firstName: string;
  lastName: string;
  branchCode: string;
  departmentCode: string;
  positionCode: string;
  supervisorNumber?: string;
  /** Link this employee to an existing dev user account. */
  linkUserEmail?: string;
  /** Wire departments.headEmployeeId of this department to this employee. */
  headOfDepartment?: string;
}

const EMPLOYEES: EmployeeSeed[] = [
  { employeeNumber: "EMP-000001", firstName: "Maria", lastName: "Santos", branchCode: "SUB", departmentCode: "ADMIN", positionCode: "DEPT_HEAD", headOfDepartment: "ADMIN" },
  { employeeNumber: "EMP-000002", firstName: "Jose", lastName: "Ramirez", branchCode: "SUB", departmentCode: "OPS", positionCode: "SUPERVISOR", supervisorNumber: "EMP-000001" },
  { employeeNumber: "EMP-000003", firstName: "Ana", lastName: "Cruz", branchCode: "SUB", departmentCode: "WHS", positionCode: "WHS_CLERK", supervisorNumber: "EMP-000002" },
  { employeeNumber: "EMP-000004", firstName: "Paolo", lastName: "Garcia", branchCode: "SUB", departmentCode: "MNT", positionCode: "TECHNICIAN", supervisorNumber: "EMP-000002" },
  { employeeNumber: "EMP-000005", firstName: "Liza", lastName: "Reyes", branchCode: "SUB", departmentCode: "ADMIN", positionCode: "STAFF", supervisorNumber: "EMP-000001", linkUserEmail: "employee@gemcor.dev" },
  { employeeNumber: "EMP-000006", firstName: "Carlo", lastName: "Mendoza", branchCode: "MKT", departmentCode: "OPS", positionCode: "SUPERVISOR" },
  { employeeNumber: "EMP-000007", firstName: "Grace", lastName: "Lim", branchCode: "MKT", departmentCode: "ADMIN", positionCode: "STAFF", supervisorNumber: "EMP-000006" },
  { employeeNumber: "EMP-000008", firstName: "Ramon", lastName: "Torres", branchCode: "MKT", departmentCode: "WHS", positionCode: "WHS_CLERK", supervisorNumber: "EMP-000006" },
];

async function seedEmployees(
  branchIdsByCode: Map<string, string>,
  departmentIdsByCode: Map<string, string>,
  positionIdsByCode: Map<string, string>,
): Promise<number> {
  const employeeIdsByNumber = new Map<string, string>();

  for (const seed of EMPLOYEES) {
    const branchId = branchIdsByCode.get(seed.branchCode);
    if (!branchId) {
      throw new Error(`Unknown branch ${seed.branchCode} for ${seed.employeeNumber}`);
    }
    const workEmail = `${seed.firstName}.${seed.lastName}`
      .toLowerCase()
      .replace(/\s+/g, "")
      .concat("@gemcor.dev");

    let userId: string | null = null;
    if (seed.linkUserEmail) {
      const user = await prisma.user.findUnique({ where: { email: seed.linkUserEmail } });
      if (!user) {
        throw new Error(`Cannot link ${seed.employeeNumber}: user ${seed.linkUserEmail} not seeded`);
      }
      userId = user.id;
    }

    const data = {
      firstName: seed.firstName,
      lastName: seed.lastName,
      displayName: `${seed.firstName} ${seed.lastName}`,
      workEmail,
      branchId,
      departmentId: departmentIdsByCode.get(seed.departmentCode) ?? null,
      positionId: positionIdsByCode.get(seed.positionCode) ?? null,
      supervisorId: seed.supervisorNumber
        ? (employeeIdsByNumber.get(seed.supervisorNumber) ?? null)
        : null,
      startDate: new Date("2025-01-06T00:00:00Z"),
      ...(userId ? { userId } : {}),
    };
    const employee = await prisma.employee.upsert({
      where: { employeeNumber: seed.employeeNumber },
      update: data,
      create: { employeeNumber: seed.employeeNumber, ...data },
    });
    employeeIdsByNumber.set(seed.employeeNumber, employee.id);

    if (seed.headOfDepartment) {
      await prisma.department.update({
        where: { code: seed.headOfDepartment },
        data: { headEmployeeId: employee.id },
      });
    }
  }

  await bumpCounter("EMP", EMPLOYEES.length);
  return EMPLOYEES.length;
}

const UOMS = [
  { code: "PC", name: "Piece" },
  { code: "BOX", name: "Box" },
  { code: "PACK", name: "Pack" },
  { code: "REAM", name: "Ream" },
  { code: "SET", name: "Set" },
  { code: "ROLL", name: "Roll" },
];

/** Global conversions: 1 from = factor x to (spec section 5 examples). */
const GLOBAL_CONVERSIONS = [
  { from: "BOX", to: "PACK", factor: 10 },
  { from: "PACK", to: "PC", factor: 100 },
  { from: "REAM", to: "PC", factor: 500 },
];

async function seedUomsAndConversions(): Promise<{
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

const ITEM_CATEGORIES = [
  { code: "LAP", name: "Laptops", subcategories: [{ code: "BUS", name: "Business Laptops" }] },
  { code: "MON", name: "Monitors", subcategories: [] },
  { code: "PRN", name: "Printers", subcategories: [] },
  {
    code: "OFC",
    name: "Office Supplies",
    subcategories: [
      { code: "PPR", name: "Paper Products" },
      { code: "INK", name: "Inks & Toners" },
      { code: "WRT", name: "Writing Instruments" },
    ],
  },
  {
    code: "PPE",
    name: "Safety & PPE",
    subcategories: [
      { code: "CHM", name: "Chemicals & Sanitation" },
      { code: "GLV", name: "Gloves & Protection" },
    ],
  },
  { code: "TLS", name: "Tools", subcategories: [] },
  { code: "FUR", name: "Furniture", subcategories: [] },
];

const BRANDS = [
  { code: "DELL", name: "Dell" },
  { code: "HP", name: "HP" },
  { code: "EPSON", name: "Epson" },
  { code: "3M", name: "3M" },
  { code: "STANLEY", name: "Stanley" },
  { code: "GENERIC", name: "Generic / Unbranded" },
];

const MANUFACTURERS = [
  { code: "DELLINC", name: "Dell Inc." },
  { code: "HPINC", name: "HP Inc." },
  { code: "EPSONCO", name: "Seiko Epson Corporation" },
  { code: "MMMCO", name: "3M Company" },
  { code: "SBD", name: "Stanley Black & Decker" },
];

interface CatalogMaps {
  categoryIdsByCode: Map<string, string>;
  subcategoryIdsByPath: Map<string, string>;
  brandIdsByCode: Map<string, string>;
  manufacturerIdsByCode: Map<string, string>;
}

async function seedCatalog(): Promise<CatalogMaps> {
  const categoryIdsByCode = new Map<string, string>();
  const subcategoryIdsByPath = new Map<string, string>();
  for (const [index, seed] of ITEM_CATEGORIES.entries()) {
    const category = await prisma.itemCategory.upsert({
      where: { code: seed.code },
      update: { name: seed.name, sortOrder: index, isActive: true },
      create: { code: seed.code, name: seed.name, sortOrder: index },
    });
    categoryIdsByCode.set(seed.code, category.id);
    for (const [subIndex, subSeed] of seed.subcategories.entries()) {
      const subcategory = await prisma.itemSubcategory.upsert({
        where: { categoryId_code: { categoryId: category.id, code: subSeed.code } },
        update: { name: subSeed.name, sortOrder: subIndex, isActive: true },
        create: {
          categoryId: category.id,
          code: subSeed.code,
          name: subSeed.name,
          sortOrder: subIndex,
        },
      });
      subcategoryIdsByPath.set(`${seed.code}:${subSeed.code}`, subcategory.id);
    }
  }

  const brandIdsByCode = new Map<string, string>();
  for (const seed of BRANDS) {
    const brand = await prisma.brand.upsert({
      where: { code: seed.code },
      update: { name: seed.name, isActive: true },
      create: { code: seed.code, name: seed.name },
    });
    brandIdsByCode.set(seed.code, brand.id);
  }
  const manufacturerIdsByCode = new Map<string, string>();
  for (const seed of MANUFACTURERS) {
    const manufacturer = await prisma.manufacturer.upsert({
      where: { code: seed.code },
      update: { name: seed.name, isActive: true },
      create: { code: seed.code, name: seed.name },
    });
    manufacturerIdsByCode.set(seed.code, manufacturer.id);
  }
  return { categoryIdsByCode, subcategoryIdsByPath, brandIdsByCode, manufacturerIdsByCode };
}

interface ItemSeed {
  sku: string;
  name: string;
  businessCategory: BusinessCategory;
  trackingMethod: TrackingMethod;
  categoryCode: string;
  subcategoryPath?: string;
  brandCode?: string;
  manufacturerCode?: string;
  model?: string;
  baseUom: string;
  purchaseUom?: string;
  issueUom?: string;
  standardCost: string;
  isExpiryTracked?: boolean;
  primaryBarcode: string;
  altBarcodes?: Array<{ barcode: string; type: string; uom?: string }>;
  /** whCode -> stocking rule (reorderLevel > 0 marks the low-stock examples). */
  warehouseSettings?: Array<{
    warehouseCode: string;
    reorderLevel?: number;
    reorderQuantity?: number;
    minQuantity?: number;
    maxQuantity?: number;
  }>;
}

/**
 * 12 items covering every business category and tracking method:
 * - SERIALIZED_ASSET/SERIAL: laptops, monitor, printer
 * - CONSUMABLE/QUANTITY: paper, pens, ink, gloves
 * - CONSUMABLE/LOT (+expiry): isopropyl alcohol
 * - BULK_NON_CONSUMABLE/QUANTITY: chairs, extension cords
 * - BULK_NON_CONSUMABLE/SERIAL: cordless drill (individual custody)
 * Stock quantities arrive with Phase 3 opening balances - reorderLevel > 0
 * rows are the standing low-stock examples until then.
 */
const ITEMS: ItemSeed[] = [
  {
    sku: "SKU-LAP-00001", name: 'Dell Latitude 5450 14" Laptop',
    businessCategory: "SERIALIZED_ASSET", trackingMethod: "SERIAL",
    categoryCode: "LAP", subcategoryPath: "LAP:BUS", brandCode: "DELL",
    manufacturerCode: "DELLINC", model: "Latitude 5450", baseUom: "PC",
    standardCost: "65000.00", primaryBarcode: "0884116454501",
  },
  {
    sku: "SKU-LAP-00002", name: "HP ProBook 450 G11 Laptop",
    businessCategory: "SERIALIZED_ASSET", trackingMethod: "SERIAL",
    categoryCode: "LAP", subcategoryPath: "LAP:BUS", brandCode: "HP",
    manufacturerCode: "HPINC", model: "ProBook 450 G11", baseUom: "PC",
    standardCost: "58500.00", primaryBarcode: "0196337450112",
  },
  {
    sku: "SKU-MON-00001", name: 'Dell P2422H 24" Monitor',
    businessCategory: "SERIALIZED_ASSET", trackingMethod: "SERIAL",
    categoryCode: "MON", brandCode: "DELL", manufacturerCode: "DELLINC",
    model: "P2422H", baseUom: "PC", standardCost: "12500.00",
    primaryBarcode: "0884116370529",
  },
  {
    sku: "SKU-PRN-00001", name: "HP LaserJet Pro M404dn Printer",
    businessCategory: "SERIALIZED_ASSET", trackingMethod: "SERIAL",
    categoryCode: "PRN", brandCode: "HP", manufacturerCode: "HPINC",
    model: "LaserJet Pro M404dn", baseUom: "PC", standardCost: "18900.00",
    primaryBarcode: "0193015506121",
  },
  {
    sku: "SKU-OFC-00001", name: "Bond Paper A4 80gsm (500 sheets)",
    businessCategory: "CONSUMABLE", trackingMethod: "QUANTITY",
    categoryCode: "OFC", subcategoryPath: "OFC:PPR", brandCode: "GENERIC",
    baseUom: "REAM", purchaseUom: "BOX", issueUom: "REAM",
    standardCost: "240.00", primaryBarcode: "4806534001234",
    altBarcodes: [{ barcode: "4806534001241", type: "PACKAGING", uom: "BOX" }],
    warehouseSettings: [
      { warehouseCode: "SUB-WH1", reorderLevel: 20, reorderQuantity: 50, minQuantity: 10, maxQuantity: 200 },
      { warehouseCode: "MKT-WH1", reorderLevel: 10, reorderQuantity: 25 },
    ],
  },
  {
    sku: "SKU-OFC-00002", name: "Ballpoint Pen Black 0.5mm",
    businessCategory: "CONSUMABLE", trackingMethod: "QUANTITY",
    categoryCode: "OFC", subcategoryPath: "OFC:WRT", brandCode: "GENERIC",
    baseUom: "PC", purchaseUom: "BOX", issueUom: "PC",
    standardCost: "8.50", primaryBarcode: "4806534002231",
    warehouseSettings: [
      { warehouseCode: "SUB-WH1", reorderLevel: 50, reorderQuantity: 100 },
    ],
  },
  {
    sku: "SKU-OFC-00003", name: "HP 682 Black Ink Cartridge",
    businessCategory: "CONSUMABLE", trackingMethod: "QUANTITY",
    categoryCode: "OFC", subcategoryPath: "OFC:INK", brandCode: "HP",
    manufacturerCode: "HPINC", model: "682", baseUom: "PC",
    standardCost: "455.00", primaryBarcode: "0195161618434",
    altBarcodes: [{ barcode: "HP-682-BLK-SUP", type: "SUPPLIER" }],
    warehouseSettings: [
      { warehouseCode: "SUB-WH1", reorderLevel: 5, reorderQuantity: 10, minQuantity: 2 },
      { warehouseCode: "MKT-WH1", reorderLevel: 4, reorderQuantity: 8 },
    ],
  },
  {
    sku: "SKU-PPE-00001", name: "Isopropyl Alcohol 70% 500ml",
    businessCategory: "CONSUMABLE", trackingMethod: "LOT",
    categoryCode: "PPE", subcategoryPath: "PPE:CHM", brandCode: "GENERIC",
    baseUom: "PC", purchaseUom: "BOX", issueUom: "PC",
    standardCost: "85.00", isExpiryTracked: true,
    primaryBarcode: "4806528881230",
    warehouseSettings: [
      { warehouseCode: "SUB-WH1", reorderLevel: 24, reorderQuantity: 48 },
    ],
  },
  {
    sku: "SKU-PPE-00002", name: "Nitrile Gloves Medium (100/box)",
    businessCategory: "CONSUMABLE", trackingMethod: "QUANTITY",
    categoryCode: "PPE", subcategoryPath: "PPE:GLV", brandCode: "3M",
    manufacturerCode: "MMMCO", baseUom: "BOX",
    standardCost: "320.00", primaryBarcode: "0051131933521",
    warehouseSettings: [
      { warehouseCode: "SUB-WH1", reorderLevel: 6, reorderQuantity: 12 },
    ],
  },
  {
    sku: "SKU-FUR-00001", name: "Mesh Office Chair",
    businessCategory: "BULK_NON_CONSUMABLE", trackingMethod: "QUANTITY",
    categoryCode: "FUR", brandCode: "GENERIC", baseUom: "PC",
    standardCost: "4200.00", primaryBarcode: "4809876543211",
  },
  {
    sku: "SKU-TLS-00001", name: "Extension Cord 10m Heavy Duty",
    businessCategory: "BULK_NON_CONSUMABLE", trackingMethod: "QUANTITY",
    categoryCode: "TLS", brandCode: "GENERIC", baseUom: "PC",
    standardCost: "950.00", primaryBarcode: "4801112223334",
    warehouseSettings: [{ warehouseCode: "SUB-WH1", reorderLevel: 3 }],
  },
  {
    sku: "SKU-TLS-00002", name: "Stanley 20V Cordless Drill",
    businessCategory: "BULK_NON_CONSUMABLE", trackingMethod: "SERIAL",
    categoryCode: "TLS", brandCode: "STANLEY", manufacturerCode: "SBD",
    model: "SCD700", baseUom: "PC", standardCost: "7800.00",
    primaryBarcode: "0076174857001",
  },
];

async function seedItems(
  uomIdsByCode: Map<string, string>,
  catalog: CatalogMaps,
): Promise<{ items: number; barcodes: number; warehouseSettings: number }> {
  const warehouses = await prisma.warehouse.findMany({
    where: { code: { in: ["SUB-WH1", "MKT-WH1"] } },
    select: { id: true, code: true },
  });
  const warehouseIdsByCode = new Map(warehouses.map((wh) => [wh.code, wh.id]));

  let barcodeCount = 0;
  let settingCount = 0;
  const maxSequenceByCategory = new Map<string, number>();

  for (const seed of ITEMS) {
    const isSerial = seed.trackingMethod === "SERIAL";
    const isLot = seed.trackingMethod === "LOT";
    const data = {
      name: seed.name,
      businessCategory: seed.businessCategory,
      trackingMethod: seed.trackingMethod,
      categoryId: catalog.categoryIdsByCode.get(seed.categoryCode) ?? null,
      subcategoryId: seed.subcategoryPath
        ? (catalog.subcategoryIdsByPath.get(seed.subcategoryPath) ?? null)
        : null,
      brandId: seed.brandCode ? (catalog.brandIdsByCode.get(seed.brandCode) ?? null) : null,
      manufacturerId: seed.manufacturerCode
        ? (catalog.manufacturerIdsByCode.get(seed.manufacturerCode) ?? null)
        : null,
      model: seed.model ?? null,
      baseUomId: uomIdsByCode.get(seed.baseUom) as string,
      purchaseUomId: seed.purchaseUom ? (uomIdsByCode.get(seed.purchaseUom) ?? null) : null,
      issueUomId: seed.issueUom ? (uomIdsByCode.get(seed.issueUom) ?? null) : null,
      standardCost: seed.standardCost,
      isLotTracked: isLot,
      isExpiryTracked: isLot && (seed.isExpiryTracked ?? false),
      requiresSerialNumber: isSerial,
      isMaintainable: isSerial && seed.businessCategory === "SERIALIZED_ASSET",
      isActive: true,
    };
    const item = await prisma.item.upsert({
      where: { sku: seed.sku },
      update: data,
      create: { sku: seed.sku, ...data },
    });

    // Barcodes: [barcode, active] unique-while-active - emulate the upsert.
    const allBarcodes = [
      { barcode: seed.primaryBarcode, type: "INTERNAL", uom: undefined as string | undefined, isPrimary: true },
      ...(seed.altBarcodes ?? []).map((alt) => ({ ...alt, isPrimary: false })),
    ];
    for (const barcodeSeed of allBarcodes) {
      const existing = await prisma.itemBarcode.findFirst({
        where: { barcode: barcodeSeed.barcode, active: true },
      });
      if (!existing) {
        await prisma.itemBarcode.create({
          data: {
            itemId: item.id,
            barcode: barcodeSeed.barcode,
            barcodeType: barcodeSeed.type,
            uomId: barcodeSeed.uom ? (uomIdsByCode.get(barcodeSeed.uom) ?? null) : null,
            isPrimary: barcodeSeed.isPrimary,
          },
        });
      }
      barcodeCount += 1;
    }

    for (const setting of seed.warehouseSettings ?? []) {
      const warehouseId = warehouseIdsByCode.get(setting.warehouseCode);
      if (!warehouseId) {
        throw new Error(`Unknown warehouse ${setting.warehouseCode} for ${seed.sku}`);
      }
      const values = {
        reorderLevel: setting.reorderLevel ?? null,
        reorderQuantity: setting.reorderQuantity ?? null,
        minQuantity: setting.minQuantity ?? null,
        maxQuantity: setting.maxQuantity ?? null,
      };
      await prisma.itemWarehouseSetting.upsert({
        where: { itemId_warehouseId: { itemId: item.id, warehouseId } },
        update: values,
        create: { itemId: item.id, warehouseId, ...values },
      });
      settingCount += 1;
    }

    const sequence = Number(seed.sku.split("-").pop());
    const current = maxSequenceByCategory.get(seed.categoryCode) ?? 0;
    maxSequenceByCategory.set(seed.categoryCode, Math.max(current, sequence));
  }

  for (const [categoryCode, maxSequence] of maxSequenceByCategory) {
    await bumpCounter(`SKU-${categoryCode}`, maxSequence);
  }
  return { items: ITEMS.length, barcodes: barcodeCount, warehouseSettings: settingCount };
}

/** Spec section-10 business-managed lookup values. */
const LOOKUP_VALUES: Record<string, Array<{ code: string; name: string }>> = {
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
};

async function seedLookupValues(): Promise<number> {
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

  // ----- Phase 2 -----
  const { departmentIdsByCode, positionIdsByCode } = await seedDepartmentsAndPositions();
  console.log(`  ${departmentIdsByCode.size} departments + ${positionIdsByCode.size} positions`);

  const employeeCount = await seedEmployees(branchIdsByCode, departmentIdsByCode, positionIdsByCode);
  console.log(`  ${employeeCount} employees (EMP-000001..., ADMIN head wired, one linked to employee@gemcor.dev)`);

  const { uomIdsByCode, conversions } = await seedUomsAndConversions();
  console.log(`  ${uomIdsByCode.size} UOMs + ${conversions} global conversions (BOX/PACK/PC/REAM)`);

  const catalog = await seedCatalog();
  console.log(
    `  ${catalog.categoryIdsByCode.size} item categories (+${catalog.subcategoryIdsByPath.size} subcategories), ` +
      `${catalog.brandIdsByCode.size} brands, ${catalog.manufacturerIdsByCode.size} manufacturers`,
  );

  const itemStats = await seedItems(uomIdsByCode, catalog);
  console.log(
    `  ${itemStats.items} items (all categories/tracking methods) with ${itemStats.barcodes} barcodes ` +
      `and ${itemStats.warehouseSettings} warehouse settings (incl. low-stock reorder levels)`,
  );

  const lookupCount = await seedLookupValues();
  console.log(`  ${lookupCount} lookup values across ${Object.keys(LOOKUP_VALUES).length} spec-§10 categories`);

  // Phase 3: opening stock + lots + an in-transit transfer, then asset instances.
  await seedPhase3Inventory(prisma);
  console.log("  Phase 3 inventory: opening balances, lots, low-stock examples, in-transit transfer");
  await seedPhase3Assets(prisma);
  console.log("  Phase 3 assets: serialized instances with custody + history");

  // Phase 4: suppliers, purchase orders, goods receipts (posted + partial + pending).
  await seedPhase4Procurement(prisma);
  console.log("  Phase 4 procurement: suppliers, POs (received/partial/pending), goods receipts");

  // Phase 5: maintenance plans, meter readings, work orders (completed/overdue/in-progress).
  await seedPhase5Maintenance(prisma);
  console.log("  Phase 5 maintenance: plans, meter readings, work orders with parts + history");

  // Phase 6: approval workflows (all four approver types), a completed count, notifications.
  await seedPhase6ApprovalsCounts(prisma);
  console.log("  Phase 6 approvals + counts: workflows (ROLE/POSITION/DEPT_HEAD/USER), count session, notifications");

  await prisma.auditLog.create({
    data: {
      action: "system.seed",
      resourceType: "system",
      metadata: {
        branches: branchIdsByCode.size,
        permissions: permissionIdsByCode.size,
        roles: roleIdsByCode.size,
        users: USERS.length,
        departments: departmentIdsByCode.size,
        positions: positionIdsByCode.size,
        employees: employeeCount,
        uoms: uomIdsByCode.size,
        uomConversions: conversions,
        itemCategories: catalog.categoryIdsByCode.size,
        items: itemStats.items,
        itemBarcodes: itemStats.barcodes,
        itemWarehouseSettings: itemStats.warehouseSettings,
        lookupValues: lookupCount,
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
