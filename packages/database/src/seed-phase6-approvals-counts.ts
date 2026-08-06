/**
 * Phase 6 seed: approval workflows, a finished count session, and sample
 * notifications so every Phase 6 screen has data.
 *
 * - WF-SEED-PO-4STEP — ACTIVE PURCHASE_ORDER workflow, Subic branch,
 *   minAmount 50,000: POs at/over the threshold route through FOUR steps
 *   demonstrating every approver type (GemCor requirement 2026-07-27):
 *     1. ROLE      — any active Branch Admin with Subic access
 *     2. POSITION  — any active SUPERVISOR employee (Jose Ramirez, linked
 *                    here to assets@gemcor.dev so the step is actionable)
 *     3. DEPT_HEAD — the requester's department head (Maria Santos, ADMIN
 *                    head, linked here to branchadmin@gemcor.dev)
 *     4. USER      — the named superadmin@gemcor.dev account
 *   Smaller POs keep auto-approving (threshold not met) — existing flows
 *   stay demoable.
 * - WF-SEED-ADJ-THRESHOLD — ACTIVE STOCK_TRANSACTION workflow scoped to
 *   ADJUSTMENT_INCREASE/ADJUSTMENT_DECREASE with minQuantity 25 (base
 *   units), single ROLE step (Branch Admin): bulk adjustments need sign-off,
 *   small corrections do not.
 * - CNT-… — a COMPLETED cycle count in the Subic warehouse: one −2 variance
 *   line, one matched line, one verified asset line, plus the DRAFT
 *   ADJUSTMENT_DECREASE stock transaction the variance generated (linked
 *   via count_session_id; it flows through the ordinary §4.1 machine).
 * - Sample notifications (low stock, approval pending, maintenance due)
 *   for the dev accounts, written with canonical dedupe keys.
 *
 * Invoked by seed.ts (the orchestrator wires it in). Idempotent: workflows
 * upsert on code; user↔employee links only fill empty slots; the count
 * section is keyed on a fixed adjustment_idempotency_key; notifications
 * upsert on (recipient, dedupe_key).
 */
import {
  ApprovalApproverType,
  CountLineFlag,
  InventoryCountStatus,
  InventoryCountType,
  Prisma,
  PrismaClient,
  StockDocumentStatus,
  StockTransactionType,
} from "@prisma/client";
import {
  NOTIFICATION_LINKS,
  NOTIFICATION_TYPES,
  notificationDedupeKey,
} from "@gemerp/shared";

const SEED_TAG = "[seed:phase6]";
/** Natural key for the count section (unique column on the session). */
const SEED_COUNT_IDEMPOTENCY_KEY = "seed-phase6-count-adjustments-0001";

const D = (value: string | number) => new Prisma.Decimal(value);

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

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface SeedContext {
  subBranchId: string;
  superadmin: { id: string };
  branchadmin: { id: string };
  warehouseUser: { id: string };
  maintenanceUser: { id: string };
  branchAdminRoleId: string;
  supervisorPositionId: string;
}

async function loadContext(prisma: PrismaClient): Promise<SeedContext> {
  const [branch, superadmin, branchadmin, warehouseUser, maintenanceUser, role, position] =
    await Promise.all([
      prisma.branch.findUnique({ where: { code: "SUB" }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: "superadmin@gemcor.dev" }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: "branchadmin@gemcor.dev" }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: "warehouse@gemcor.dev" }, select: { id: true } }),
      prisma.user.findUnique({ where: { email: "maintenance@gemcor.dev" }, select: { id: true } }),
      prisma.role.findUnique({ where: { code: "BRANCH_ADMIN" }, select: { id: true } }),
      prisma.position.findUnique({ where: { code: "SUPERVISOR" }, select: { id: true } }),
    ]);
  if (!branch || !superadmin || !branchadmin || !warehouseUser || !maintenanceUser || !role || !position) {
    throw new Error(
      "Phase 6 seed requires the Phase 1/2 base seed (branches, dev users, roles, positions) to run first.",
    );
  }
  return {
    subBranchId: branch.id,
    superadmin,
    branchadmin,
    warehouseUser,
    maintenanceUser,
    branchAdminRoleId: role.id,
    supervisorPositionId: position.id,
  };
}

/**
 * Wire dev accounts to employee records so POSITION and DEPT_HEAD steps
 * resolve to real users. Fills only EMPTY slots — re-runs and manual edits
 * are respected.
 */
async function linkApproverAccounts(prisma: PrismaClient): Promise<void> {
  const links: Array<{ employeeNumber: string; email: string }> = [
    // Maria Santos: ADMIN department head → DEPT_HEAD approver.
    { employeeNumber: "EMP-000001", email: "branchadmin@gemcor.dev" },
    // Jose Ramirez: SUPERVISOR position → POSITION approver.
    { employeeNumber: "EMP-000002", email: "assets@gemcor.dev" },
  ];
  for (const link of links) {
    const [employee, user] = await Promise.all([
      prisma.employee.findUnique({
        where: { employeeNumber: link.employeeNumber },
        select: { id: true, userId: true },
      }),
      prisma.user.findUnique({
        where: { email: link.email },
        select: { id: true, employee: { select: { id: true } } },
      }),
    ]);
    if (!employee || !user) {
      continue;
    }
    if (employee.userId === null && user.employee === null) {
      await prisma.employee.update({
        where: { id: employee.id },
        data: { userId: user.id },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

interface StepSeed {
  sequence: number;
  name: string;
  approverType: ApprovalApproverType;
  approverRoleId?: string;
  approverPositionId?: string;
  approverUserId?: string;
}

async function upsertWorkflow(
  prisma: PrismaClient,
  data: {
    code: string;
    name: string;
    description: string;
    resourceType: string;
    documentSubtypes: string[];
    branchId: string | null;
    minAmount: Prisma.Decimal | null;
    minQuantity: Prisma.Decimal | null;
    steps: StepSeed[];
  },
): Promise<void> {
  const workflow = await prisma.approvalWorkflow.upsert({
    where: { code: data.code },
    update: {
      name: data.name,
      description: data.description,
      isActive: true,
    },
    create: {
      code: data.code,
      name: data.name,
      description: data.description,
      resourceType: data.resourceType,
      documentSubtypes: data.documentSubtypes,
      branchId: data.branchId,
      minAmount: data.minAmount,
      minQuantity: data.minQuantity,
      isActive: true,
    },
    select: { id: true, _count: { select: { steps: true } } },
  });
  // Steps only on first creation — replacing them under live requests would
  // orphan resolved assignments, and re-runs must never do that.
  if (workflow._count.steps === 0) {
    for (const step of data.steps) {
      await prisma.approvalStep.create({
        data: {
          workflowId: workflow.id,
          sequence: step.sequence,
          name: step.name,
          approverType: step.approverType,
          approverRoleId: step.approverRoleId ?? null,
          approverPositionId: step.approverPositionId ?? null,
          approverUserId: step.approverUserId ?? null,
        },
      });
    }
  }
}

async function seedWorkflows(
  prisma: PrismaClient,
  ctx: SeedContext,
): Promise<void> {
  await upsertWorkflow(prisma, {
    code: "WF-SEED-PO-4STEP",
    name: "High-value purchase orders (Subic)",
    description: `${SEED_TAG} Four-step approval for Subic POs of 50,000 PHP and up — one step per approver type: ROLE, POSITION, DEPT_HEAD, USER.`,
    resourceType: "PURCHASE_ORDER",
    documentSubtypes: [],
    branchId: ctx.subBranchId,
    minAmount: D("50000.00"),
    minQuantity: null,
    steps: [
      {
        sequence: 1,
        name: "Branch admin review",
        approverType: ApprovalApproverType.ROLE,
        approverRoleId: ctx.branchAdminRoleId,
      },
      {
        sequence: 2,
        name: "Supervisor endorsement",
        approverType: ApprovalApproverType.POSITION,
        approverPositionId: ctx.supervisorPositionId,
      },
      {
        sequence: 3,
        name: "Department head sign-off",
        approverType: ApprovalApproverType.DEPT_HEAD,
      },
      {
        sequence: 4,
        name: "Final approval",
        approverType: ApprovalApproverType.USER,
        approverUserId: ctx.superadmin.id,
      },
    ],
  });

  await upsertWorkflow(prisma, {
    code: "WF-SEED-ADJ-THRESHOLD",
    name: "Bulk stock adjustments (Subic)",
    description: `${SEED_TAG} Adjustment increase/decrease documents of 25+ base units in Subic need a Branch Admin decision; smaller corrections auto-approve.`,
    resourceType: "STOCK_TRANSACTION",
    documentSubtypes: [
      StockTransactionType.ADJUSTMENT_INCREASE,
      StockTransactionType.ADJUSTMENT_DECREASE,
    ],
    branchId: ctx.subBranchId,
    minAmount: null,
    minQuantity: D("25"),
    steps: [
      {
        sequence: 1,
        name: "Branch admin decision",
        approverType: ApprovalApproverType.ROLE,
        approverRoleId: ctx.branchAdminRoleId,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Completed count session + generated draft adjustment
// ---------------------------------------------------------------------------

async function seedCountSession(
  prisma: PrismaClient,
  ctx: SeedContext,
): Promise<void> {
  const existing = await prisma.inventoryCountSession.findUnique({
    where: { adjustmentIdempotencyKey: SEED_COUNT_IDEMPOTENCY_KEY },
    select: { id: true },
  });
  if (existing) {
    return; // already seeded
  }

  // The Subic warehouse that actually holds stock (SUB-WH1 in the base
  // seed; SUB-SR1 is an empty storeroom).
  const warehouse = await prisma.warehouse.findFirst({
    where: {
      branchId: ctx.subBranchId,
      isActive: true,
      stockBalances: { some: { onHandQty: { gte: 3 } } },
    },
    orderBy: { code: "asc" },
    select: { id: true, code: true },
  });
  if (!warehouse) {
    console.warn(`${SEED_TAG} no Subic warehouse — skipping count session`);
    return;
  }
  // Two stocked buckets from the Phase 3 seed: the first takes a −2
  // variance, the second matches exactly.
  const balances = await prisma.stockBalance.findMany({
    where: {
      warehouseId: warehouse.id,
      onHandQty: { gte: 3 },
      item: { is: { trackingMethod: { not: "SERIAL" } } },
    },
    orderBy: { onHandQty: "desc" },
    take: 2,
    select: {
      itemId: true,
      lotId: true,
      storageLocationId: true,
      onHandQty: true,
      item: { select: { baseUomId: true, sku: true } },
    },
  });
  const asset = await prisma.asset.findFirst({
    where: {
      branchId: ctx.subBranchId,
      warehouseId: warehouse.id,
      status: "AVAILABLE",
      archivedAt: null,
    },
    select: { id: true, itemId: true, storageLocationId: true },
  });
  if (balances.length < 2) {
    console.warn(`${SEED_TAG} not enough stocked items — skipping count session`);
    return;
  }
  const [varianceBucket, matchedBucket] = balances;
  const goodCondition = await prisma.lookupValue.findUnique({
    where: { category_code: { category: "ASSET_CONDITION", code: "GOOD" } },
    select: { id: true },
  });
  const countReason = await prisma.lookupValue.findUnique({
    where: {
      category_code: { category: "ADJUSTMENT_REASON", code: "COUNT_VARIANCE" },
    },
    select: { id: true },
  });

  const startedAt = daysAgo(2);
  const completedAt = daysAgo(1);
  const year = completedAt.getUTCFullYear();
  const countNumber = `CNT-${year}-${String(
    await nextSequence(prisma, `CNT-${year}`),
  ).padStart(5, "0")}`;

  const session = await prisma.inventoryCountSession.create({
    data: {
      countNumber,
      type: InventoryCountType.CYCLE,
      status: InventoryCountStatus.COMPLETED,
      branchId: ctx.subBranchId,
      warehouseId: warehouse.id,
      isBlind: true,
      scopeItemIds: [],
      snapshotAt: startedAt,
      startedAt,
      completedAt,
      adjustmentsCreatedAt: completedAt,
      adjustmentIdempotencyKey: SEED_COUNT_IDEMPOTENCY_KEY,
      notes: `${SEED_TAG} Blind cycle count of ${warehouse.code} — one shortage found and adjusted.`,
      version: 4,
      createdById: ctx.warehouseUser.id,
      approvedById: ctx.branchadmin.id,
      approvedAt: completedAt,
    },
    select: { id: true },
  });

  const varianceCounted = (varianceBucket.onHandQty as Prisma.Decimal).sub(2);
  await prisma.inventoryCountLine.createMany({
    data: [
      {
        countSessionId: session.id,
        itemId: varianceBucket.itemId,
        lotId: varianceBucket.lotId,
        warehouseId: warehouse.id,
        storageLocationId: varianceBucket.storageLocationId,
        uomId: varianceBucket.item.baseUomId,
        expectedQuantity: varianceBucket.onHandQty,
        countedQuantity: varianceCounted,
        varianceQuantity: D("-2"),
        flag: CountLineFlag.VARIANCE,
        countedById: ctx.warehouseUser.id,
        countedAt: completedAt,
        notes: `${SEED_TAG} two units short on the shelf`,
      },
      {
        countSessionId: session.id,
        itemId: matchedBucket.itemId,
        lotId: matchedBucket.lotId,
        warehouseId: warehouse.id,
        storageLocationId: matchedBucket.storageLocationId,
        uomId: matchedBucket.item.baseUomId,
        expectedQuantity: matchedBucket.onHandQty,
        countedQuantity: matchedBucket.onHandQty,
        varianceQuantity: D("0"),
        flag: CountLineFlag.MATCHED,
        countedById: ctx.warehouseUser.id,
        countedAt: completedAt,
      },
      ...(asset
        ? [
            {
              countSessionId: session.id,
              itemId: asset.itemId,
              assetId: asset.id,
              warehouseId: warehouse.id,
              storageLocationId: asset.storageLocationId,
              assetFound: true,
              locationConfirmed: true,
              conditionId: goodCondition?.id ?? null,
              flag: CountLineFlag.MATCHED,
              countedById: ctx.warehouseUser.id,
              countedAt: completedAt,
            },
          ]
        : []),
    ],
  });

  // The generated DRAFT adjustment (counts never write balances — this
  // document flows through the ordinary approval + posting machine).
  const txnNumber = `STK-${year}-${String(
    await nextSequence(prisma, `STK-${year}`),
  ).padStart(6, "0")}`;
  await prisma.stockTransaction.create({
    data: {
      transactionNumber: txnNumber,
      type: StockTransactionType.ADJUSTMENT_DECREASE,
      status: StockDocumentStatus.DRAFT,
      transactionDate: completedAt,
      branchId: ctx.subBranchId,
      sourceWarehouseId: warehouse.id,
      countSessionId: session.id,
      reasonId: countReason?.id ?? null,
      notes: `${SEED_TAG} [count:${countNumber}] Variance adjustment generated from the physical count`,
      createdById: ctx.branchadmin.id,
      lines: {
        create: [
          {
            lineNumber: 1,
            itemId: varianceBucket.itemId,
            lotId: varianceBucket.lotId,
            sourceLocationId: varianceBucket.storageLocationId,
            enteredUomId: varianceBucket.item.baseUomId,
            enteredQuantity: D("2"),
            baseQuantity: D("2"),
            notes: `${SEED_TAG} shortage of ${varianceBucket.item.sku} found by ${countNumber}`,
          },
        ],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Sample notifications
// ---------------------------------------------------------------------------

async function seedNotifications(
  prisma: PrismaClient,
  ctx: SeedContext,
): Promise<void> {
  const samples: Array<{
    recipientId: string;
    type: string;
    title: string;
    message: string;
    branchId?: string;
    dedupeKey: string;
    link: string;
    readAt?: Date;
  }> = [
    {
      recipientId: ctx.branchadmin.id,
      type: NOTIFICATION_TYPES.approvalPending,
      title: "Approval requested",
      message:
        "A high-value purchase order is waiting for your approval (step 1: Branch admin review).",
      branchId: ctx.subBranchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.approvalPending,
        "seed",
        "phase6-sample",
      ),
      link: "/approvals",
    },
    {
      recipientId: ctx.warehouseUser.id,
      type: NOTIFICATION_TYPES.lowStock,
      title: "Low stock",
      message:
        "One or more items in your warehouse are at/below their reorder level — review the low-stock report.",
      branchId: ctx.subBranchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.lowStock,
        "seed",
        "phase6-sample",
      ),
      link: NOTIFICATION_LINKS.lowStock(),
    },
    {
      recipientId: ctx.maintenanceUser.id,
      type: NOTIFICATION_TYPES.maintenanceDue,
      title: "Maintenance due soon",
      message:
        "Plan MPL-SEED-001 (Laptop preventive service) is inside its reminder window.",
      branchId: ctx.subBranchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.maintenanceDue,
        "seed",
        "phase6-sample",
      ),
      link: NOTIFICATION_LINKS.maintenancePlans(),
      readAt: daysAgo(1),
    },
  ];
  for (const sample of samples) {
    const { recipientId, dedupeKey, readAt, ...rest } = sample;
    await prisma.notification.upsert({
      where: { recipientId_dedupeKey: { recipientId, dedupeKey } },
      update: {},
      create: {
        recipientId,
        dedupeKey,
        readAt: readAt ?? null,
        ...rest,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Entry point (wired by seed.ts — the orchestrator)
// ---------------------------------------------------------------------------

export async function seedPhase6ApprovalsCounts(
  prisma: PrismaClient,
): Promise<void> {
  const ctx = await loadContext(prisma);
  await linkApproverAccounts(prisma);
  await seedWorkflows(prisma, ctx);
  await seedCountSession(prisma, ctx);
  await seedNotifications(prisma, ctx);
  console.log(
    `${SEED_TAG} approvals (WF-SEED-PO-4STEP with ROLE/POSITION/DEPT_HEAD/USER steps, WF-SEED-ADJ-THRESHOLD), completed count session with variance + draft adjustment, sample notifications — done`,
  );
}
