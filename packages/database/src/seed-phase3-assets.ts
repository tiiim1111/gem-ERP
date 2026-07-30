/**
 * GEM ERP Phase 3 seed — serialized asset instances (idempotent).
 *
 * Seeds 8 assets over the SERIAL-tracked Phase 2 items (Dell/HP laptops,
 * Dell monitor, Stanley drill) across SUB and MKT:
 *
 *   3 × Available, 2 × Assigned (one acknowledgment pending, one acknowledged
 *   but overdue for return), 1 × Under Maintenance, 1 × Damaged, 1 × Retired.
 *
 * Every asset gets a tag in the AST-{BRANCH}-{CAT}-{YYYY}-{SEQ6} pattern
 * allocated from sequence_counters (per branch+category+year key), an opaque
 * 32-byte base64url scan token, and status/condition/movement history rows
 * that trace how it reached its current state. Assigned assets carry open
 * AssetAssignment rows (+ an ISSUE acknowledgment for the acknowledged one).
 *
 * Idempotency: each seed row is keyed by its (item, manufacturer serial)
 * pair — re-runs skip existing assets entirely, so counters are not burned
 * and history is not duplicated.
 *
 * Orchestration: seed.ts (or the orchestrator) calls seedPhase3Assets(prisma)
 * AFTER the Phase 1/2 seed and the Phase 3 inventory seed.
 */
import { randomBytes } from "node:crypto";
import {
  AcknowledgmentType,
  AssetAssignmentStatus,
  AssetLifecycleStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

const S = AssetLifecycleStatus;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysAhead(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** Registration year in the org timezone (Asia/Manila, UTC+8). */
function manilaYear(): number {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).getUTCFullYear();
}

function scanToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Next value of a named counter. The seed runs single-threaded, so a plain
 * increment-returning-update is equivalent to the API's locked allocation.
 */
async function nextSequence(prisma: PrismaClient, key: string): Promise<number> {
  await prisma.sequenceCounter.upsert({
    where: { key },
    update: {},
    create: { key, description: "Asset tags (Phase 3 seed)" },
  });
  const row = await prisma.sequenceCounter.update({
    where: { key },
    data: { lastValue: { increment: 1 } },
    select: { lastValue: true },
  });
  return Number(row.lastValue);
}

function formatAssetTag(
  branchCode: string,
  categoryCode: string,
  year: number,
  sequence: number,
): string {
  return `AST-${branchCode}-${categoryCode}-${year}-${String(sequence).padStart(6, "0")}`;
}

interface AssignmentSeed {
  employeeNumber: string;
  status: "PENDING_ACKNOWLEDGMENT" | "ACTIVE";
  assignedDaysAgo: number;
  /** Negative = overdue by N days; positive = due in N days. */
  expectedReturnInDays: number;
  acknowledged: boolean;
  issueNotes: string;
}

interface StatusStep {
  from: AssetLifecycleStatus | null;
  to: AssetLifecycleStatus;
  daysAgo: number;
  notes: string;
}

interface AssetSeed {
  itemSku: string;
  branchCode: "SUB" | "MKT";
  warehouseCode: string;
  locationCode?: string;
  serialNumber: string;
  status: AssetLifecycleStatus;
  conditionCode: string;
  acquisitionCost: string;
  acquisitionDaysAgo: number;
  warrantyEndInDays: number;
  maintenanceRequired?: boolean;
  retiredDaysAgo?: number;
  notes?: string;
  statusPath: StatusStep[];
  /** Extra condition entries beyond the registration condition. */
  extraConditions?: Array<{
    code: string;
    daysAgo: number;
    source: string;
    notes: string;
  }>;
  assignment?: AssignmentSeed;
}

const ASSET_SEEDS: AssetSeed[] = [
  {
    // 1 — Available laptop (SUB)
    itemSku: "SKU-LAP-00001",
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    locationCode: "A-01",
    serialNumber: "DL5450-SEED-001",
    status: S.AVAILABLE,
    conditionCode: "NEW",
    acquisitionCost: "65000.00",
    acquisitionDaysAgo: 90,
    warrantyEndInDays: 275,
    statusPath: [
      { from: null, to: S.DRAFT, daysAgo: 90, notes: "register" },
      { from: S.DRAFT, to: S.AVAILABLE, daysAgo: 89, notes: "activate" },
    ],
  },
  {
    // 2 — Assigned laptop, acknowledged but OVERDUE for return (SUB)
    itemSku: "SKU-LAP-00001",
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    serialNumber: "DL5450-SEED-002",
    status: S.ASSIGNED,
    conditionCode: "GOOD",
    acquisitionCost: "65000.00",
    acquisitionDaysAgo: 90,
    warrantyEndInDays: 275,
    statusPath: [
      { from: null, to: S.DRAFT, daysAgo: 90, notes: "register" },
      { from: S.DRAFT, to: S.AVAILABLE, daysAgo: 89, notes: "activate" },
      {
        from: S.AVAILABLE,
        to: S.ASSIGNED,
        daysAgo: 30,
        notes: "assign: temporary issue to Liza Reyes",
      },
    ],
    assignment: {
      employeeNumber: "EMP-000005",
      status: "ACTIVE",
      assignedDaysAgo: 30,
      expectedReturnInDays: -7, // overdue by a week
      acknowledged: true,
      issueNotes: "Temporary loan for the month-end reporting project",
    },
  },
  {
    // 3 — Assigned laptop, acknowledgment still PENDING (SUB)
    itemSku: "SKU-LAP-00002",
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    serialNumber: "HPPB-SEED-001",
    status: S.ASSIGNED,
    conditionCode: "NEW",
    acquisitionCost: "58500.00",
    acquisitionDaysAgo: 45,
    warrantyEndInDays: 320,
    statusPath: [
      { from: null, to: S.DRAFT, daysAgo: 45, notes: "register" },
      { from: S.DRAFT, to: S.AVAILABLE, daysAgo: 44, notes: "activate" },
      {
        from: S.AVAILABLE,
        to: S.ASSIGNED,
        daysAgo: 2,
        notes: "assign: standard issue to Ana Cruz",
      },
    ],
    assignment: {
      employeeNumber: "EMP-000003",
      status: "PENDING_ACKNOWLEDGMENT",
      assignedDaysAgo: 2,
      expectedReturnInDays: 30,
      acknowledged: false,
      issueNotes: "Standard warehouse-clerk workstation issue",
    },
  },
  {
    // 4 — Available monitor (SUB), warranty expiring soon
    itemSku: "SKU-MON-00001",
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    locationCode: "A-02",
    serialNumber: "MONP-SEED-001",
    status: S.AVAILABLE,
    conditionCode: "GOOD",
    acquisitionCost: "12500.00",
    acquisitionDaysAgo: 340,
    warrantyEndInDays: 20,
    statusPath: [
      { from: null, to: S.DRAFT, daysAgo: 340, notes: "register" },
      { from: S.DRAFT, to: S.AVAILABLE, daysAgo: 339, notes: "activate" },
    ],
  },
  {
    // 5 — Available monitor (MKT)
    itemSku: "SKU-MON-00001",
    branchCode: "MKT",
    warehouseCode: "MKT-WH1",
    locationCode: "A-01",
    serialNumber: "MONP-SEED-002",
    status: S.AVAILABLE,
    conditionCode: "NEW",
    acquisitionCost: "12500.00",
    acquisitionDaysAgo: 30,
    warrantyEndInDays: 335,
    statusPath: [
      { from: null, to: S.DRAFT, daysAgo: 30, notes: "register" },
      { from: S.DRAFT, to: S.AVAILABLE, daysAgo: 29, notes: "activate" },
    ],
  },
  {
    // 6 — Damaged monitor (SUB)
    itemSku: "SKU-MON-00001",
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    serialNumber: "MONP-SEED-003",
    status: S.DAMAGED,
    conditionCode: "DEFECTIVE",
    acquisitionCost: "12500.00",
    acquisitionDaysAgo: 200,
    warrantyEndInDays: 165,
    maintenanceRequired: true,
    notes: "Panel cracked — awaiting repair decision",
    statusPath: [
      { from: null, to: S.DRAFT, daysAgo: 200, notes: "register" },
      { from: S.DRAFT, to: S.AVAILABLE, daysAgo: 199, notes: "activate" },
      {
        from: S.AVAILABLE,
        to: S.DAMAGED,
        daysAgo: 10,
        notes: "report-damage: panel cracked during office rearrangement",
      },
    ],
    extraConditions: [
      {
        code: "DEFECTIVE",
        daysAgo: 10,
        source: "damage-report",
        notes: "Panel cracked during office rearrangement",
      },
    ],
  },
  {
    // 7 — Drill under maintenance (SUB)
    itemSku: "SKU-TLS-00002",
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    serialNumber: "STDR-SEED-001",
    status: S.UNDER_MAINTENANCE,
    conditionCode: "FAIR",
    acquisitionCost: "7800.00",
    acquisitionDaysAgo: 400,
    warrantyEndInDays: -35, // warranty already lapsed
    statusPath: [
      { from: null, to: S.DRAFT, daysAgo: 400, notes: "register" },
      { from: S.DRAFT, to: S.AVAILABLE, daysAgo: 399, notes: "activate" },
      {
        from: S.AVAILABLE,
        to: S.UNDER_MAINTENANCE,
        daysAgo: 5,
        notes: "send-to-maintenance: chuck slipping, preventive service",
      },
    ],
    extraConditions: [
      {
        code: "FAIR",
        daysAgo: 5,
        source: "maintenance",
        notes: "Chuck slipping under load",
      },
    ],
  },
  {
    // 8 — Retired monitor (SUB)
    itemSku: "SKU-MON-00001",
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    serialNumber: "MONP-SEED-004",
    status: S.RETIRED,
    conditionCode: "POOR",
    acquisitionCost: "11800.00",
    acquisitionDaysAgo: 1500,
    warrantyEndInDays: -1100,
    retiredDaysAgo: 20,
    statusPath: [
      { from: null, to: S.DRAFT, daysAgo: 1500, notes: "register" },
      { from: S.DRAFT, to: S.AVAILABLE, daysAgo: 1499, notes: "activate" },
      {
        from: S.AVAILABLE,
        to: S.RETIRED,
        daysAgo: 20,
        notes: "retire: beyond economical repair, replaced by new unit",
      },
    ],
    extraConditions: [
      {
        code: "POOR",
        daysAgo: 21,
        source: "inspection",
        notes: "Severe backlight bleed, flickering",
      },
    ],
  },
];

interface SeedRefs {
  itemsBySku: Map<string, { id: string; categoryCode: string }>;
  branchesByCode: Map<string, string>;
  warehousesByCode: Map<string, string>;
  locationsByKey: Map<string, string>; // "WHCODE:LOCCODE"
  employeesByNumber: Map<string, string>;
  conditionsByCode: Map<string, string>;
  actorUserId: string;
}

async function loadRefs(prisma: PrismaClient): Promise<SeedRefs> {
  const skus = [...new Set(ASSET_SEEDS.map((seed) => seed.itemSku))];
  const items = await prisma.item.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, category: { select: { code: true } } },
  });
  const itemsBySku = new Map(
    items.map((item) => {
      if (!item.category) {
        throw new Error(`Seed item ${item.sku} has no category (needed for tag)`);
      }
      return [item.sku, { id: item.id, categoryCode: item.category.code }] as const;
    }),
  );

  const branches = await prisma.branch.findMany({
    where: { code: { in: ["SUB", "MKT"] } },
    select: { id: true, code: true },
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { code: { in: ["SUB-WH1", "MKT-WH1"] } },
    select: {
      id: true,
      code: true,
      storageLocations: { select: { id: true, code: true } },
    },
  });
  const locationsByKey = new Map<string, string>();
  for (const warehouse of warehouses) {
    for (const location of warehouse.storageLocations) {
      locationsByKey.set(`${warehouse.code}:${location.code}`, location.id);
    }
  }

  const employees = await prisma.employee.findMany({
    where: { employeeNumber: { in: ["EMP-000003", "EMP-000005"] } },
    select: { id: true, employeeNumber: true },
  });

  const conditions = await prisma.lookupValue.findMany({
    where: { category: "ASSET_CONDITION" },
    select: { id: true, code: true },
  });

  const actor = await prisma.user.findUnique({
    where: { email: "assets@gemcor.dev" },
    select: { id: true },
  });
  if (!actor) {
    throw new Error(
      "Phase 3 asset seed requires the Phase 1 users (assets@gemcor.dev) to be seeded first",
    );
  }

  return {
    itemsBySku,
    branchesByCode: new Map(branches.map((branch) => [branch.code, branch.id])),
    warehousesByCode: new Map(
      warehouses.map((warehouse) => [warehouse.code, warehouse.id]),
    ),
    locationsByKey,
    employeesByNumber: new Map(
      employees.map((employee) => [employee.employeeNumber, employee.id]),
    ),
    conditionsByCode: new Map(
      conditions.map((condition) => [condition.code, condition.id]),
    ),
    actorUserId: actor.id,
  };
}

function requireRef<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Phase 3 asset seed: missing prerequisite ${label}`);
  }
  return value;
}

async function seedOneAsset(
  prisma: PrismaClient,
  refs: SeedRefs,
  seed: AssetSeed,
  year: number,
): Promise<boolean> {
  const item = requireRef(refs.itemsBySku.get(seed.itemSku), `item ${seed.itemSku}`);

  // Idempotency key: (item, manufacturer serial) is unique in the schema.
  const existing = await prisma.asset.findFirst({
    where: { itemId: item.id, serialNumber: seed.serialNumber },
    select: { id: true },
  });
  if (existing) {
    return false;
  }

  const branchId = requireRef(
    refs.branchesByCode.get(seed.branchCode),
    `branch ${seed.branchCode}`,
  );
  const warehouseId = requireRef(
    refs.warehousesByCode.get(seed.warehouseCode),
    `warehouse ${seed.warehouseCode}`,
  );
  const locationId = seed.locationCode
    ? requireRef(
        refs.locationsByKey.get(`${seed.warehouseCode}:${seed.locationCode}`),
        `location ${seed.warehouseCode}:${seed.locationCode}`,
      )
    : null;
  const conditionId = requireRef(
    refs.conditionsByCode.get(seed.conditionCode),
    `ASSET_CONDITION ${seed.conditionCode}`,
  );
  const employeeId = seed.assignment
    ? requireRef(
        refs.employeesByNumber.get(seed.assignment.employeeNumber),
        `employee ${seed.assignment.employeeNumber}`,
      )
    : null;

  const sequenceKey = `AST-${seed.branchCode}-${item.categoryCode}-${year}`;
  const sequence = await nextSequence(prisma, sequenceKey);
  const assetTag = formatAssetTag(seed.branchCode, item.categoryCode, year, sequence);
  const registeredAt = daysAgo(seed.acquisitionDaysAgo);

  await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        assetTag,
        scanToken: scanToken(),
        serialNumber: seed.serialNumber,
        itemId: item.id,
        status: seed.status,
        conditionId,
        branchId,
        warehouseId,
        storageLocationId: locationId,
        custodianId: seed.status === S.ASSIGNED ? employeeId : null,
        acquisitionDate: registeredAt,
        acquisitionCost: seed.acquisitionCost,
        warrantyStartDate: registeredAt,
        warrantyEndDate:
          seed.warrantyEndInDays >= 0
            ? daysAhead(seed.warrantyEndInDays)
            : daysAgo(-seed.warrantyEndInDays),
        maintenanceRequired: seed.maintenanceRequired ?? false,
        retiredAt: seed.retiredDaysAgo !== undefined ? daysAgo(seed.retiredDaysAgo) : null,
        notes: seed.notes ?? null,
        createdAt: registeredAt,
      },
      select: { id: true },
    });

    // Status history tracing the path to the current state.
    for (const step of seed.statusPath) {
      await tx.assetStatusHistory.create({
        data: {
          assetId: asset.id,
          fromStatus: step.from,
          toStatus: step.to,
          changedAt: daysAgo(step.daysAgo),
          changedById: refs.actorUserId,
          notes: step.notes,
        },
      });
    }

    // Registration condition + any later condition changes. Assets whose
    // current condition degraded later start out GOOD at registration.
    const registrationConditionCode = seed.extraConditions
      ? "GOOD"
      : seed.conditionCode;
    await tx.assetConditionHistory.create({
      data: {
        assetId: asset.id,
        conditionId: requireRef(
          refs.conditionsByCode.get(registrationConditionCode),
          `ASSET_CONDITION ${registrationConditionCode}`,
        ),
        recordedAt: registeredAt,
        recordedById: refs.actorUserId,
        source: "registration",
      },
    });
    for (const extra of seed.extraConditions ?? []) {
      await tx.assetConditionHistory.create({
        data: {
          assetId: asset.id,
          conditionId: requireRef(
            refs.conditionsByCode.get(extra.code),
            `ASSET_CONDITION ${extra.code}`,
          ),
          recordedAt: daysAgo(extra.daysAgo),
          recordedById: refs.actorUserId,
          source: extra.source,
          notes: extra.notes,
        },
      });
    }

    // Open assignment (+ issuance movement, + acknowledgment when confirmed).
    if (seed.assignment && employeeId) {
      const assignedAt = daysAgo(seed.assignment.assignedDaysAgo);
      const expectedReturnAt =
        seed.assignment.expectedReturnInDays >= 0
          ? daysAhead(seed.assignment.expectedReturnInDays)
          : daysAgo(-seed.assignment.expectedReturnInDays);
      const assignment = await tx.assetAssignment.create({
        data: {
          assetId: asset.id,
          status:
            seed.assignment.status === "ACTIVE"
              ? AssetAssignmentStatus.ACTIVE
              : AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
          employeeId,
          assignedAt,
          assignedById: refs.actorUserId,
          expectedReturnAt,
          conditionAtIssueId: conditionId,
          issueNotes: seed.assignment.issueNotes,
          acknowledgedAt: seed.assignment.acknowledged
            ? new Date(assignedAt.getTime() + 12 * 60 * 60 * 1000)
            : null,
        },
        select: { id: true },
      });
      await tx.assetMovement.create({
        data: {
          assetId: asset.id,
          movedAt: assignedAt,
          fromBranchId: branchId,
          toBranchId: branchId,
          fromWarehouseId: warehouseId,
          fromLocationId: locationId,
          toEmployeeId: employeeId,
          assignmentId: assignment.id,
          movedById: refs.actorUserId,
          notes: "assign",
        },
      });
      if (seed.assignment.acknowledged) {
        await tx.assetAcknowledgment.create({
          data: {
            assignmentId: assignment.id,
            assetId: asset.id,
            employeeId,
            type: AcknowledgmentType.ISSUE,
            acknowledgedAt: new Date(assignedAt.getTime() + 12 * 60 * 60 * 1000),
            acknowledgedByUserId: refs.actorUserId,
            method: "USER_CONFIRMED",
            notes: "Seeded acknowledgment",
          },
        });
      }
    }
  });
  return true;
}

/**
 * Seed the Phase 3 serialized-asset demonstration data. Idempotent — safe to
 * run repeatedly; existing assets (matched by item + serial) are skipped.
 */
export async function seedPhase3Assets(prisma: PrismaClient): Promise<void> {
  const refs = await loadRefs(prisma);
  const year = manilaYear();

  let created = 0;
  let skipped = 0;
  for (const seed of ASSET_SEEDS) {
    const wasCreated = await seedOneAsset(prisma, refs, seed, year);
    if (wasCreated) {
      created += 1;
    } else {
      skipped += 1;
    }
  }

  if (created > 0) {
    await prisma.auditLog.create({
      data: {
        action: "system.seed.phase3_assets",
        resourceType: "system",
        metadata: {
          assetsCreated: created,
          assetsSkipped: skipped,
          statuses: {
            available: 3,
            assigned: 2,
            underMaintenance: 1,
            damaged: 1,
            retired: 1,
          },
        } satisfies Prisma.InputJsonValue,
        reason: "Phase 3 serialized-asset seed executed",
      },
    });
  }
  console.log(
    `  Phase 3 assets: ${created} created, ${skipped} already present ` +
      "(3 Available, 2 Assigned [1 ack-pending, 1 overdue], 1 Under Maintenance, 1 Damaged, 1 Retired)",
  );
}
