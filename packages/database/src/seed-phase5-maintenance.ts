/**
 * Phase 5 maintenance seed: preventive plans, work orders, parts consumption,
 * and meter readings so every maintenance screen has data:
 *
 * - MPL-SEED-001 "Laptop preventive service" — ACTIVE interval plan (180d)
 *   covering the two seeded Subic laptops, checklist template, due in 14
 *   days (inside its 14-day reminder window).
 * - MPL-SEED-002 "Drill runtime service" — ACTIVE meter plan (every 250
 *   RUNTIME_HOURS) covering the drill, which also gets 3 meter readings.
 * - WO-…-1 COMPLETED (laptop, plan 1): full history — diagnosis/action/
 *   resolution, labor 500 + parts 164 + external 0, 180 min downtime, final
 *   condition GOOD, outcome AVAILABLE, and a POSTED MAINTENANCE_ISSUE stock
 *   transaction (2 PC isopropyl alcohol) with ledger entries + balance
 *   decrement exactly as the posting engine writes them.
 * - WO-…-2 SCHEDULED & OVERDUE (damaged monitor): planned window ended days
 *   ago, technician Paolo Garcia assigned.
 * - WO-…-3 IN_PROGRESS (drill): explains the drill's existing
 *   Under-Maintenance status from the Phase 3 seed (pre-WO status Available).
 *
 * Also links employee EMP-000004 (Paolo Garcia, MNT technician) to the
 * maintenance@gemcor.dev account so technician scoping ("my work orders")
 * is demoable out of the box.
 *
 * Invoked by seed.ts (the orchestrator wires it in). Idempotent: lookups and
 * plans upsert on natural keys; the document section is keyed on the
 * "[seed:phase5]" notes marker so re-running never duplicates stock effects.
 * (The Nest services are not importable from this package — packages must
 * not depend on apps — so the stock math mirrors the posting engine's,
 * exactly like the Phase 3/4 seeds.)
 */
import {
  AssetLifecycleStatus,
  MaintenanceWorkOrderStatus,
  Prisma,
  PrismaClient,
  StockDocumentStatus,
  StockTransactionType,
} from "@prisma/client";

const SEED_TAG = "[seed:phase5]";

const D = (value: string | number) => new Prisma.Decimal(value);

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function nextSequence(prisma: PrismaClient, key: string): Promise<number> {
  await prisma.sequenceCounter.upsert({ where: { key }, update: {}, create: { key } });
  const rows = await prisma.$queryRaw<Array<{ last_value: bigint }>>`
    UPDATE sequence_counters
    SET last_value = last_value + 1, updated_at = NOW()
    WHERE key = ${key}
    RETURNING last_value
  `;
  return Number(rows[0].last_value);
}

async function nextWorkOrderNumber(prisma: PrismaClient, date: Date): Promise<string> {
  const year = date.getUTCFullYear();
  return `WO-${year}-${String(await nextSequence(prisma, `WO-${year}`)).padStart(5, "0")}`;
}

async function nextStockTransactionNumber(
  prisma: PrismaClient,
  date: Date,
): Promise<string> {
  const year = date.getUTCFullYear();
  return `STK-${year}-${String(await nextSequence(prisma, `STK-${year}`)).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Context from earlier phases
// ---------------------------------------------------------------------------

interface SeedContext {
  branchId: string;
  adminUserId: string;
  branchAdminUserId: string;
  maintenanceUserId: string;
  technicianEmployeeId: string;
  laptop1: { id: string; warehouseId: string | null };
  laptop2: { id: string };
  damagedMonitor: { id: string };
  drill: { id: string };
  alcoholItem: { id: string; baseUomId: string };
  pcUomId: string;
  typePreventiveId: string;
  typeCorrectiveId: string;
  priorityMediumId: string;
  priorityHighId: string;
  conditionGoodId: string;
  conditionFairId: string;
}

async function loadContext(prisma: PrismaClient): Promise<SeedContext> {
  const branch = await prisma.branch.findUnique({
    where: { code: "SUB" },
    select: { id: true },
  });
  const [admin, branchAdmin, maintenanceUser] = await Promise.all([
    prisma.user.findUnique({ where: { email: "superadmin@gemcor.dev" }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: "branchadmin@gemcor.dev" }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: "maintenance@gemcor.dev" }, select: { id: true } }),
  ]);
  const technician = await prisma.employee.findUnique({
    where: { employeeNumber: "EMP-000004" },
    select: { id: true, userId: true },
  });
  const assets = await prisma.asset.findMany({
    where: {
      serialNumber: {
        in: ["DL5450-SEED-001", "DL5450-SEED-002", "MONP-SEED-003", "STDR-SEED-001"],
      },
    },
    select: { id: true, serialNumber: true, warehouseId: true },
  });
  const bySerial = new Map(assets.map((asset) => [asset.serialNumber, asset]));
  const alcohol = await prisma.item.findUnique({
    where: { sku: "SKU-PPE-00001" },
    select: { id: true, baseUomId: true },
  });
  const pcUom = await prisma.unitOfMeasure.findFirst({
    where: { code: "PC" },
    select: { id: true },
  });
  const lookups = await prisma.lookupValue.findMany({
    where: {
      OR: [
        { category: "MAINTENANCE_TYPE", code: { in: ["PREVENTIVE", "CORRECTIVE"] } },
        { category: "MAINTENANCE_PRIORITY", code: { in: ["MEDIUM", "HIGH"] } },
        { category: "ASSET_CONDITION", code: { in: ["GOOD", "FAIR"] } },
      ],
    },
    select: { id: true, category: true, code: true },
  });
  const lookup = (category: string, code: string): string | undefined =>
    lookups.find((row) => row.category === category && row.code === code)?.id;

  const laptop1 = bySerial.get("DL5450-SEED-001");
  const laptop2 = bySerial.get("DL5450-SEED-002");
  const damagedMonitor = bySerial.get("MONP-SEED-003");
  const drill = bySerial.get("STDR-SEED-001");
  const typePreventiveId = lookup("MAINTENANCE_TYPE", "PREVENTIVE");
  const typeCorrectiveId = lookup("MAINTENANCE_TYPE", "CORRECTIVE");
  const priorityMediumId = lookup("MAINTENANCE_PRIORITY", "MEDIUM");
  const priorityHighId = lookup("MAINTENANCE_PRIORITY", "HIGH");
  const conditionGoodId = lookup("ASSET_CONDITION", "GOOD");
  const conditionFairId = lookup("ASSET_CONDITION", "FAIR");

  if (
    !branch || !admin || !branchAdmin || !maintenanceUser || !technician ||
    !laptop1 || !laptop2 || !damagedMonitor || !drill || !alcohol || !pcUom ||
    !typePreventiveId || !typeCorrectiveId || !priorityMediumId ||
    !priorityHighId || !conditionGoodId || !conditionFairId
  ) {
    throw new Error(
      "Phase 5 seed requires the Phase 1-4 seed data (branches, users, employees, assets, items, lookups) — run the base seed first.",
    );
  }

  // Technician scoping demo: link the MNT technician to the maintenance user.
  if (!technician.userId) {
    await prisma.employee.update({
      where: { id: technician.id },
      data: { userId: maintenanceUser.id },
    });
  }

  return {
    branchId: branch.id,
    adminUserId: admin.id,
    branchAdminUserId: branchAdmin.id,
    maintenanceUserId: maintenanceUser.id,
    technicianEmployeeId: technician.id,
    laptop1: { id: laptop1.id, warehouseId: laptop1.warehouseId },
    laptop2: { id: laptop2.id },
    damagedMonitor: { id: damagedMonitor.id },
    drill: { id: drill.id },
    alcoholItem: alcohol,
    pcUomId: pcUom.id,
    typePreventiveId,
    typeCorrectiveId,
    priorityMediumId,
    priorityHighId,
    conditionGoodId,
    conditionFairId,
  };
}

// ---------------------------------------------------------------------------
// Plans (natural-key upserts — idempotent on their own)
// ---------------------------------------------------------------------------

async function seedPlans(
  prisma: PrismaClient,
  ctx: SeedContext,
): Promise<{ laptopPlanId: string; drillPlanId: string }> {
  const laptopPlan = await prisma.maintenancePlan.upsert({
    where: { code: "MPL-SEED-001" },
    update: { isActive: true, archivedAt: null },
    create: {
      code: "MPL-SEED-001",
      name: "Laptop preventive service",
      description: `Semi-annual clean, thermal service, and health check for issued laptops ${SEED_TAG}`,
      maintenanceTypeId: ctx.typePreventiveId,
      intervalDays: 180,
      assignedTeam: "IT Support",
      estimatedDurationHours: D("1.5"),
      estimatedCost: D("1500.00"),
      reminderLeadDays: 14,
      nextDueAt: daysFromNow(14), // upcoming — inside the reminder window
      createdById: ctx.adminUserId,
    },
    select: { id: true },
  });
  const drillPlan = await prisma.maintenancePlan.upsert({
    where: { code: "MPL-SEED-002" },
    update: { isActive: true, archivedAt: null },
    create: {
      code: "MPL-SEED-002",
      name: "Drill runtime service",
      description: `Chuck + brush service every 250 runtime hours ${SEED_TAG}`,
      maintenanceTypeId: ctx.typePreventiveId,
      meterInterval: D("250"),
      meterType: "RUNTIME_HOURS",
      assignedTeam: "Facilities",
      estimatedDurationHours: D("2"),
      estimatedCost: D("800.00"),
      reminderLeadDays: 7,
      createdById: ctx.adminUserId,
    },
    select: { id: true },
  });

  for (const [planId, sequence, name, isRequired] of [
    [laptopPlan.id, 1, "Blow out fans and heatsink", true],
    [laptopPlan.id, 2, "Renew thermal paste", true],
    [laptopPlan.id, 3, "Run battery + SMART diagnostics", true],
    [laptopPlan.id, 4, "Clean keyboard and screen", false],
    [drillPlan.id, 1, "Inspect and torque chuck", true],
    [drillPlan.id, 2, "Replace carbon brushes if worn", true],
  ] as Array<[string, number, string, boolean]>) {
    await prisma.maintenancePlanTask.upsert({
      where: { planId_sequence: { planId, sequence } },
      update: { name, isRequired },
      create: { planId, sequence, name, isRequired },
    });
  }

  for (const [planId, assetId] of [
    [laptopPlan.id, ctx.laptop1.id],
    [laptopPlan.id, ctx.laptop2.id],
    [drillPlan.id, ctx.drill.id],
  ] as Array<[string, string]>) {
    await prisma.maintenancePlanAsset.upsert({
      where: { planId_assetId: { planId, assetId } },
      update: {},
      create: { planId, assetId },
    });
  }
  return { laptopPlanId: laptopPlan.id, drillPlanId: drillPlan.id };
}

// ---------------------------------------------------------------------------
// Meter readings (drill) — idempotent via per-day existence check
// ---------------------------------------------------------------------------

async function seedMeterReadings(prisma: PrismaClient, ctx: SeedContext): Promise<number> {
  const readings: Array<{ daysAgo: number; value: string }> = [
    { daysAgo: 30, value: "1180" },
    { daysAgo: 14, value: "1290" },
    { daysAgo: 3, value: "1410" },
  ];
  let created = 0;
  for (const reading of readings) {
    const readingAt = daysFromNow(-reading.daysAgo);
    const exists = await prisma.assetMeterReading.findFirst({
      where: {
        assetId: ctx.drill.id,
        meterType: "RUNTIME_HOURS",
        readingValue: D(reading.value),
      },
      select: { id: true },
    });
    if (!exists) {
      await prisma.assetMeterReading.create({
        data: {
          assetId: ctx.drill.id,
          meterType: "RUNTIME_HOURS",
          readingValue: D(reading.value),
          readingAt,
          recordedById: ctx.maintenanceUserId,
          notes: `Phase 5 seed reading ${SEED_TAG}`,
        },
      });
      created += 1;
    }
  }
  return created;
}

// ---------------------------------------------------------------------------
// Work orders (marker-guarded — the stock effect must never run twice)
// ---------------------------------------------------------------------------

async function seedWorkOrders(
  prisma: PrismaClient,
  ctx: SeedContext,
  plans: { laptopPlanId: string; drillPlanId: string },
): Promise<{ workOrders: number; partsIssues: number }> {
  const marker = await prisma.maintenanceWorkOrder.findFirst({
    where: { problemDescription: { contains: SEED_TAG } },
    select: { id: true },
  });
  if (marker) {
    return { workOrders: 0, partsIssues: 0 };
  }

  // ----- WO 1: COMPLETED preventive service on laptop 1 (with parts) -------
  const wo1Start = daysFromNow(-20);
  const wo1End = new Date(wo1Start.getTime() + 3 * 60 * 60 * 1000); // +3h
  const wo1 = await prisma.maintenanceWorkOrder.create({
    data: {
      workOrderNumber: await nextWorkOrderNumber(prisma, wo1Start),
      assetId: ctx.laptop1.id,
      planId: plans.laptopPlanId,
      branchId: ctx.branchId,
      typeId: ctx.typePreventiveId,
      priorityId: ctx.priorityMediumId,
      status: MaintenanceWorkOrderStatus.COMPLETED,
      problemDescription: `[preventive] Generated from plan MPL-SEED-001 (Laptop preventive service) ${SEED_TAG}`,
      reportedById: ctx.adminUserId,
      reportedAt: daysFromNow(-21),
      assignedToEmployeeId: ctx.technicianEmployeeId,
      assignedTeam: "IT Support",
      scheduledStartAt: wo1Start,
      scheduledEndAt: new Date(wo1Start.getTime() + 4 * 60 * 60 * 1000),
      actualStartAt: wo1Start,
      actualEndAt: wo1End,
      diagnosis: "Dust buildup on heatsink; thermal paste dried out.",
      actionTaken: "Disassembled, cleaned airflow path, renewed thermal paste.",
      resolution: "Temperatures back to normal under load test.",
      laborCost: D("500.00"),
      partsCost: D("164.00"),
      externalCost: D("0.00"),
      totalCost: D("664.00"),
      downtimeMinutes: 180,
      downtimeHours: D("3.00"),
      completionConditionId: ctx.conditionGoodId,
      nextMaintenanceAt: daysFromNow(14),
      assetStatusBeforeWo: AssetLifecycleStatus.AVAILABLE,
      outcomeStatus: AssetLifecycleStatus.AVAILABLE,
      completedById: ctx.maintenanceUserId,
      version: 5, // create + assign + start + parts + complete
      createdById: ctx.adminUserId,
    },
    select: { id: true, workOrderNumber: true },
  });
  // Checklist ticked off by the technician.
  const wo1Tasks: Array<[number, string, boolean]> = [
    [1, "Blow out fans and heatsink", true],
    [2, "Renew thermal paste", true],
    [3, "Run battery + SMART diagnostics", true],
    [4, "Clean keyboard and screen", false],
  ];
  for (const [sequence, name, isRequired] of wo1Tasks) {
    await prisma.maintenanceWorkOrderTask.create({
      data: {
        workOrderId: wo1.id,
        sequence,
        name,
        isRequired,
        isCompleted: true,
        completedAt: wo1End,
        completedById: ctx.maintenanceUserId,
      },
    });
  }
  // Asset history round-trip: Available → Under Maintenance → Available.
  await prisma.assetStatusHistory.createMany({
    data: [
      {
        assetId: ctx.laptop1.id,
        fromStatus: AssetLifecycleStatus.AVAILABLE,
        toStatus: AssetLifecycleStatus.UNDER_MAINTENANCE,
        changedAt: wo1Start,
        changedById: ctx.maintenanceUserId,
        notes: `maintenance-start (work order ${wo1.workOrderNumber}) ${SEED_TAG}`,
      },
      {
        assetId: ctx.laptop1.id,
        fromStatus: AssetLifecycleStatus.UNDER_MAINTENANCE,
        toStatus: AssetLifecycleStatus.AVAILABLE,
        changedAt: wo1End,
        changedById: ctx.maintenanceUserId,
        notes: `maintenance-complete (work order ${wo1.workOrderNumber}) ${SEED_TAG}`,
      },
    ],
  });
  await prisma.assetConditionHistory.create({
    data: {
      assetId: ctx.laptop1.id,
      conditionId: ctx.conditionGoodId,
      recordedAt: wo1End,
      recordedById: ctx.maintenanceUserId,
      source: "maintenance",
      workOrderId: wo1.id,
      notes: "Temperatures back to normal under load test.",
    },
  });
  await prisma.asset.update({
    where: { id: ctx.laptop1.id },
    data: { nextMaintenanceAt: daysFromNow(14), lastInspectionAt: wo1End },
  });

  // Parts: 2 PC isopropyl alcohol through a POSTED MAINTENANCE_ISSUE — the
  // seed consumes from whichever balance bucket actually has stock, writing
  // the same ledger entry + balance decrement the posting engine would.
  let partsIssues = 0;
  const bucket = await prisma.stockBalance.findFirst({
    where: {
      itemId: ctx.alcoholItem.id,
      onHandQty: { gte: D("2") },
    },
    select: {
      id: true,
      branchId: true,
      warehouseId: true,
      storageLocationId: true,
      lotId: true,
    },
  });
  if (bucket) {
    const txn = await prisma.stockTransaction.create({
      data: {
        transactionNumber: await nextStockTransactionNumber(prisma, wo1Start),
        type: StockTransactionType.MAINTENANCE_ISSUE,
        status: StockDocumentStatus.POSTED,
        transactionDate: wo1Start,
        branchId: bucket.branchId,
        sourceWarehouseId: bucket.warehouseId,
        workOrderId: wo1.id,
        idempotencyKey: "seed-phase5-wo1-parts",
        notes: `[system] Parts issue for work order ${wo1.workOrderNumber} ${SEED_TAG}`,
        createdById: ctx.maintenanceUserId,
        submittedAt: wo1Start,
        approvedById: ctx.maintenanceUserId,
        approvedAt: wo1Start,
        postedById: ctx.maintenanceUserId,
        postedAt: wo1Start,
      },
      select: { id: true },
    });
    const line = await prisma.stockTransactionLine.create({
      data: {
        transactionId: txn.id,
        lineNumber: 1,
        itemId: ctx.alcoholItem.id,
        lotId: bucket.lotId,
        sourceLocationId: bucket.storageLocationId,
        enteredUomId: ctx.pcUomId,
        enteredQuantity: D("2"),
        baseQuantity: D("2"),
        unitCost: D("82.00"),
        totalCost: D("164.00"),
        notes: "Cleaning solvent for heatsink service",
      },
      select: { id: true },
    });
    await prisma.stockLedgerEntry.create({
      data: {
        transactionId: txn.id,
        transactionLineId: line.id,
        itemId: ctx.alcoholItem.id,
        lotId: bucket.lotId,
        branchId: bucket.branchId,
        warehouseId: bucket.warehouseId,
        storageLocationId: bucket.storageLocationId,
        quantityDelta: D("-2"),
        unitCost: D("82.00"),
        postedAt: wo1Start,
      },
    });
    await prisma.stockBalance.update({
      where: { id: bucket.id },
      data: { onHandQty: { decrement: D("2") } },
    });
    await prisma.maintenancePart.create({
      data: {
        workOrderId: wo1.id,
        itemId: ctx.alcoholItem.id,
        lotId: bucket.lotId,
        uomId: ctx.pcUomId,
        quantity: D("2"),
        baseQuantity: D("2"),
        unitCost: D("82.00"),
        totalCost: D("164.00"),
        stockTransactionId: txn.id,
        notes: "Cleaning solvent for heatsink service",
      },
    });
    partsIssues = 1;
  }

  // ----- WO 2: SCHEDULED and OVERDUE on the damaged monitor ----------------
  const wo2 = await prisma.maintenanceWorkOrder.create({
    data: {
      workOrderNumber: await nextWorkOrderNumber(prisma, daysFromNow(-9)),
      assetId: ctx.damagedMonitor.id,
      branchId: ctx.branchId,
      typeId: ctx.typeCorrectiveId,
      priorityId: ctx.priorityHighId,
      status: MaintenanceWorkOrderStatus.SCHEDULED,
      problemDescription: `Panel cracked during office rearrangement — assess repair vs retire ${SEED_TAG}`,
      reportedById: ctx.branchAdminUserId,
      reportedAt: daysFromNow(-10),
      assignedToEmployeeId: ctx.technicianEmployeeId,
      scheduledStartAt: daysFromNow(-6),
      scheduledEndAt: daysFromNow(-5), // planned window ended → overdue
      version: 3, // create + assign + schedule
      createdById: ctx.branchAdminUserId,
    },
    select: { id: true },
  });
  await prisma.maintenanceWorkOrderTask.createMany({
    data: [
      { workOrderId: wo2.id, sequence: 1, name: "Assess panel damage", isRequired: true },
      { workOrderId: wo2.id, sequence: 2, name: "Quote replacement panel", isRequired: true },
    ],
  });

  // ----- WO 3: IN_PROGRESS on the drill (already Under Maintenance) --------
  const wo3Start = daysFromNow(-5);
  await prisma.maintenanceWorkOrder.create({
    data: {
      workOrderNumber: await nextWorkOrderNumber(prisma, wo3Start),
      assetId: ctx.drill.id,
      planId: plans.drillPlanId,
      branchId: ctx.branchId,
      typeId: ctx.typePreventiveId,
      priorityId: ctx.priorityMediumId,
      status: MaintenanceWorkOrderStatus.IN_PROGRESS,
      problemDescription: `[preventive] Generated from plan MPL-SEED-002 (Drill runtime service) — chuck slipping under load ${SEED_TAG}`,
      reportedAt: daysFromNow(-6),
      assignedToEmployeeId: ctx.technicianEmployeeId,
      assignedTeam: "Facilities",
      actualStartAt: wo3Start,
      diagnosis: "Chuck jaws worn; brushes at limit.",
      assetStatusBeforeWo: AssetLifecycleStatus.AVAILABLE,
      version: 3, // create + assign + start
      createdById: ctx.adminUserId,
    },
  });

  return { workOrders: 3, partsIssues };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function seedPhase5Maintenance(prisma: PrismaClient): Promise<void> {
  const ctx = await loadContext(prisma);
  const plans = await seedPlans(prisma, ctx);
  const readings = await seedMeterReadings(prisma, ctx);
  const documents = await seedWorkOrders(prisma, ctx, plans);
  console.log(
    `  Phase 5 maintenance: 2 plans (interval + meter, checklists, covered assets), ` +
      `${readings} meter readings, ${documents.workOrders} work orders ` +
      `(1 completed w/ parts+costs+downtime, 1 overdue scheduled, 1 in progress), ` +
      `${documents.partsIssues} posted parts issue` +
      (documents.workOrders === 0 ? " (already seeded — skipped)" : ""),
  );
}
