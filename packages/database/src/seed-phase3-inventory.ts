/**
 * Phase 3 inventory seed: opening balances, lot-controlled stock, issue
 * history, and one in-transit inter-branch transfer.
 *
 * Invoked by seed.ts (the orchestrator wires it in). Idempotent: every
 * section is keyed on a natural marker — document notes carry the
 * "[seed:phase3]" tag and lots use fixed lot numbers — so re-running the seed
 * never duplicates stock.
 *
 * Consistency contract (spec §3): every seeded balance equals the sum of the
 * seeded immutable ledger entries for its bucket, exactly as the API posting
 * engine would have produced. (The Nest posting service itself is not
 * importable from this package — packages must not depend on apps — so this
 * file constructs transaction + ledger + balance rows through one shared
 * helper that mirrors the engine's math.)
 *
 * Seeded picture:
 * - SUB-WH1: paper 120→100 REAM, pens 30 PC (LOW STOCK: reorder 50), ink
 *   12→10→6 PC, gloves 2 BOX (LOW STOCK: reorder 6), chairs 15, cords 8,
 *   isopropyl alcohol 60 PC across two lots (one expiring in ~20 days).
 * - MKT-WH1: paper 40 REAM, ink 10 PC, plus 4 PC ink in transit from Subic.
 * - Issue history: 20 REAM paper to EMP-000003, 2 PC ink to EMP-000004.
 * - TRF (IN_TRANSIT): 4 PC ink SUB-WH1 → MKT-WH1 awaiting receipt.
 */
import {
  Prisma,
  PrismaClient,
  StockDocumentStatus,
  StockTransactionType,
  TransferStatus,
  TransferType,
} from "@prisma/client";

const SEED_TAG = "[seed:phase3]";

// ---------------------------------------------------------------------------
// Document numbering (mirrors apps/api inventory-numbers.ts, api-outline 1.9)
// ---------------------------------------------------------------------------

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

async function nextStockTransactionNumber(prisma: PrismaClient, date: Date): Promise<string> {
  const year = date.getUTCFullYear();
  const seq = await nextSequence(prisma, `STK-${year}`);
  return `STK-${year}-${String(seq).padStart(6, "0")}`;
}

async function nextTransferNumber(prisma: PrismaClient, date: Date): Promise<string> {
  const year = date.getUTCFullYear();
  const seq = await nextSequence(prisma, `TRF-${year}`);
  return `TRF-${year}-${String(seq).padStart(5, "0")}`;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface SeedContext {
  branchIdsByCode: Map<string, string>;
  warehouseIdsByCode: Map<string, string>;
  /** key: `${warehouseCode}:${locationCode}` */
  locationIds: Map<string, string>;
  items: Map<
    string,
    { id: string; baseUomId: string; standardCost: Prisma.Decimal | null }
  >;
  uomIdsByCode: Map<string, string>;
  adminUserId: string;
  employeeIdsByNumber: Map<string, string>;
}

async function loadContext(prisma: PrismaClient): Promise<SeedContext> {
  const branches = await prisma.branch.findMany({
    where: { code: { in: ["SUB", "MKT"] } },
    select: { id: true, code: true },
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { code: { in: ["SUB-WH1", "MKT-WH1"] } },
    select: { id: true, code: true, storageLocations: { select: { id: true, code: true } } },
  });
  const items = await prisma.item.findMany({
    where: {
      sku: {
        in: [
          "SKU-OFC-00001",
          "SKU-OFC-00002",
          "SKU-OFC-00003",
          "SKU-PPE-00001",
          "SKU-PPE-00002",
          "SKU-FUR-00001",
          "SKU-TLS-00001",
        ],
      },
    },
    select: { id: true, sku: true, baseUomId: true, standardCost: true },
  });
  const uoms = await prisma.unitOfMeasure.findMany({
    where: { code: { in: ["PC", "BOX", "REAM"] } },
    select: { id: true, code: true },
  });
  const admin = await prisma.user.findUnique({
    where: { email: "superadmin@gemcor.dev" },
    select: { id: true },
  });
  const employees = await prisma.employee.findMany({
    where: { employeeNumber: { in: ["EMP-000003", "EMP-000004"] } },
    select: { id: true, employeeNumber: true },
  });

  if (!admin || branches.length < 2 || warehouses.length < 2 || items.length < 7) {
    throw new Error(
      "Phase 3 seed requires the Phase 1/2 seed data (branches, warehouses, items, users) — run the base seed first.",
    );
  }

  const locationIds = new Map<string, string>();
  for (const warehouse of warehouses) {
    for (const location of warehouse.storageLocations) {
      locationIds.set(`${warehouse.code}:${location.code}`, location.id);
    }
  }
  return {
    branchIdsByCode: new Map(branches.map((branch) => [branch.code, branch.id])),
    warehouseIdsByCode: new Map(warehouses.map((wh) => [wh.code, wh.id])),
    locationIds,
    items: new Map(
      items.map((item) => [
        item.sku,
        { id: item.id, baseUomId: item.baseUomId, standardCost: item.standardCost },
      ]),
    ),
    uomIdsByCode: new Map(uoms.map((uom) => [uom.code, uom.id])),
    adminUserId: admin.id,
    employeeIdsByNumber: new Map(
      employees.map((employee) => [employee.employeeNumber, employee.id]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Mini posting helper (mirrors the API posting engine's math)
// ---------------------------------------------------------------------------

interface SeedLine {
  sku: string;
  /** Entered quantity in the entered UOM. */
  quantity: string;
  uomCode: string;
  /** Base-unit quantity (defaults to quantity when the entered UOM is base). */
  baseQuantity?: string;
  lotId?: string;
  locationId?: string | null;
  destinationLocationId?: string | null;
  unitCost?: string | null;
}

interface SeedTxn {
  type: StockTransactionType;
  branchCode: string;
  /** IN: destination warehouse. OUT: source warehouse. */
  warehouseCode: string;
  direction: "IN" | "OUT";
  daysAgo: number;
  lines: SeedLine[];
  notes: string;
  employeeId?: string;
  destinationBranchCode?: string;
  destinationWarehouseCode?: string;
  transferId?: string;
}

function daysFromNow(days: number): Date {
  const date = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

async function applyBalanceDelta(
  prisma: PrismaClient,
  bucket: {
    itemId: string;
    branchId: string;
    warehouseId: string;
    storageLocationId: string | null;
    lotId: string | null;
  },
  onHandDelta: Prisma.Decimal,
  inTransitDelta: Prisma.Decimal,
): Promise<void> {
  const existing = await prisma.stockBalance.findFirst({
    where: {
      itemId: bucket.itemId,
      warehouseId: bucket.warehouseId,
      storageLocationId: bucket.storageLocationId,
      lotId: bucket.lotId,
    },
    select: { id: true, onHandQty: true, reservedQty: true },
  });
  if (existing) {
    const nextOnHand = existing.onHandQty.add(onHandDelta);
    if (nextOnHand.sub(existing.reservedQty).lt(0)) {
      throw new Error("Phase 3 seed would drive a stock balance negative — seed data inconsistent.");
    }
    await prisma.stockBalance.update({
      where: { id: existing.id },
      data: {
        onHandQty: { increment: onHandDelta },
        inTransitQty: { increment: inTransitDelta },
      },
    });
  } else {
    if (onHandDelta.lt(0)) {
      throw new Error("Phase 3 seed issues stock from an empty bucket — seed data inconsistent.");
    }
    await prisma.stockBalance.create({
      data: { ...bucket, onHandQty: onHandDelta, inTransitQty: inTransitDelta },
    });
  }
}

/** Creates one POSTED transaction with lines + ledger + balance updates. */
async function postSeedTransaction(
  prisma: PrismaClient,
  ctx: SeedContext,
  spec: SeedTxn,
): Promise<{ id: string; transactionNumber: string }> {
  const when = daysFromNow(-spec.daysAgo);
  const branchId = ctx.branchIdsByCode.get(spec.branchCode) as string;
  const warehouseId = ctx.warehouseIdsByCode.get(spec.warehouseCode) as string;
  const destinationBranchId = spec.destinationBranchCode
    ? (ctx.branchIdsByCode.get(spec.destinationBranchCode) as string)
    : null;
  const destinationWarehouseId = spec.destinationWarehouseCode
    ? (ctx.warehouseIdsByCode.get(spec.destinationWarehouseCode) as string)
    : null;
  const transactionNumber = await nextStockTransactionNumber(prisma, when);

  const txn = await prisma.stockTransaction.create({
    data: {
      transactionNumber,
      type: spec.type,
      status: StockDocumentStatus.POSTED,
      transactionDate: when,
      branchId,
      sourceBranchId: spec.destinationBranchCode ? branchId : null,
      destinationBranchId,
      sourceWarehouseId: spec.direction === "OUT" ? warehouseId : null,
      destinationWarehouseId:
        spec.direction === "IN" ? warehouseId : destinationWarehouseId,
      employeeId: spec.employeeId ?? null,
      transferId: spec.transferId ?? null,
      notes: `${spec.notes} ${SEED_TAG}`,
      createdById: ctx.adminUserId,
      submittedAt: when,
      approvedById: ctx.adminUserId,
      approvedAt: when,
      postedById: ctx.adminUserId,
      postedAt: when,
    },
    select: { id: true, transactionNumber: true },
  });

  let lineNumber = 0;
  for (const line of spec.lines) {
    lineNumber += 1;
    const item = ctx.items.get(line.sku);
    if (!item) {
      throw new Error(`Phase 3 seed: unknown item ${line.sku}`);
    }
    const enteredQuantity = new Prisma.Decimal(line.quantity);
    const baseQuantity = new Prisma.Decimal(line.baseQuantity ?? line.quantity);
    const unitCost =
      line.unitCost !== undefined
        ? line.unitCost
          ? new Prisma.Decimal(line.unitCost)
          : null
        : (item.standardCost ?? null);
    const totalCost = unitCost
      ? unitCost.mul(enteredQuantity).toDecimalPlaces(2)
      : null;
    const created = await prisma.stockTransactionLine.create({
      data: {
        transactionId: txn.id,
        lineNumber,
        itemId: item.id,
        lotId: line.lotId ?? null,
        sourceLocationId: spec.direction === "OUT" ? (line.locationId ?? null) : null,
        destinationLocationId:
          spec.direction === "IN" ? (line.locationId ?? null) : null,
        enteredUomId: ctx.uomIdsByCode.get(line.uomCode) as string,
        enteredQuantity,
        baseQuantity,
        unitCost,
        totalCost,
      },
      select: { id: true },
    });

    const delta = spec.direction === "IN" ? baseQuantity : baseQuantity.neg();
    const bucket = {
      itemId: item.id,
      branchId,
      warehouseId,
      storageLocationId: line.locationId ?? null,
      lotId: line.lotId ?? null,
    };
    await prisma.stockLedgerEntry.create({
      data: {
        transactionId: txn.id,
        transactionLineId: created.id,
        itemId: item.id,
        lotId: line.lotId ?? null,
        branchId,
        warehouseId,
        storageLocationId: line.locationId ?? null,
        quantityDelta: delta,
        unitCost: totalCost ? totalCost.div(baseQuantity).toDecimalPlaces(2) : null,
        postedAt: when,
      },
    });
    await applyBalanceDelta(prisma, bucket, delta, new Prisma.Decimal(0));
  }
  return txn;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function seedLots(
  prisma: PrismaClient,
  ctx: SeedContext,
): Promise<{ expiringSoonLotId: string; laterLotId: string }> {
  const alcohol = ctx.items.get("SKU-PPE-00001");
  if (!alcohol) {
    throw new Error("Phase 3 seed: SKU-PPE-00001 missing");
  }
  const upsertLot = async (lotNumber: string, expiry: Date): Promise<string> => {
    const lot = await prisma.inventoryLot.upsert({
      where: { itemId_lotNumber: { itemId: alcohol.id, lotNumber } },
      update: {},
      create: {
        itemId: alcohol.id,
        lotNumber,
        barcode: lotNumber,
        expiryDate: expiry,
        notes: `Phase 3 seed lot ${SEED_TAG}`,
      },
      select: { id: true },
    });
    return lot.id;
  };
  // Fixed lot numbers = natural idempotency keys (LOT-{SKU}-{YYYYMMDD}-{SEQ}).
  const expiringSoonLotId = await upsertLot("LOT-PPE-00001-20260710-01", daysFromNow(20));
  const laterLotId = await upsertLot("LOT-PPE-00001-20260710-02", daysFromNow(365));
  return { expiringSoonLotId, laterLotId };
}

async function seedOpeningBalances(
  prisma: PrismaClient,
  ctx: SeedContext,
  lots: { expiringSoonLotId: string; laterLotId: string },
): Promise<number> {
  const marker = await prisma.stockTransaction.findFirst({
    where: {
      type: StockTransactionType.OPENING_BALANCE,
      notes: { contains: SEED_TAG },
    },
    select: { id: true },
  });
  if (marker) {
    return 0;
  }

  const loc = (key: string) => ctx.locationIds.get(key) ?? null;
  await postSeedTransaction(prisma, ctx, {
    type: StockTransactionType.OPENING_BALANCE,
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    direction: "IN",
    daysAgo: 14,
    notes: "Opening balances — Subic warehouse",
    lines: [
      { sku: "SKU-OFC-00001", quantity: "120", uomCode: "REAM", locationId: loc("SUB-WH1:A-01") },
      // Pens: 30 < reorder 50 → standing low-stock example.
      { sku: "SKU-OFC-00002", quantity: "30", uomCode: "PC", locationId: loc("SUB-WH1:A-01") },
      { sku: "SKU-OFC-00003", quantity: "12", uomCode: "PC", locationId: loc("SUB-WH1:A-02") },
      // Gloves: 2 < reorder 6 → standing low-stock example.
      { sku: "SKU-PPE-00002", quantity: "2", uomCode: "BOX", locationId: loc("SUB-WH1:A-02") },
      { sku: "SKU-FUR-00001", quantity: "15", uomCode: "PC", locationId: loc("SUB-WH1:A-02") },
      { sku: "SKU-TLS-00001", quantity: "8", uomCode: "PC", locationId: loc("SUB-WH1:A-01") },
      // Lot-controlled isopropyl alcohol: one lot expiring in ~20 days.
      {
        sku: "SKU-PPE-00001",
        quantity: "36",
        uomCode: "PC",
        lotId: lots.expiringSoonLotId,
        locationId: loc("SUB-WH1:A-01"),
      },
      {
        sku: "SKU-PPE-00001",
        quantity: "24",
        uomCode: "PC",
        lotId: lots.laterLotId,
        locationId: loc("SUB-WH1:A-01"),
      },
    ],
  });
  await postSeedTransaction(prisma, ctx, {
    type: StockTransactionType.OPENING_BALANCE,
    branchCode: "MKT",
    warehouseCode: "MKT-WH1",
    direction: "IN",
    daysAgo: 14,
    notes: "Opening balances — Makati warehouse",
    lines: [
      { sku: "SKU-OFC-00001", quantity: "40", uomCode: "REAM", locationId: loc("MKT-WH1:S-01") },
      { sku: "SKU-OFC-00003", quantity: "10", uomCode: "PC", locationId: loc("MKT-WH1:S-01") },
    ],
  });
  return 2;
}

async function seedIssueHistory(
  prisma: PrismaClient,
  ctx: SeedContext,
): Promise<number> {
  const marker = await prisma.stockTransaction.findFirst({
    where: {
      type: StockTransactionType.ISSUE_TO_EMPLOYEE,
      notes: { contains: SEED_TAG },
    },
    select: { id: true },
  });
  if (marker) {
    return 0;
  }

  const loc = (key: string) => ctx.locationIds.get(key) ?? null;
  await postSeedTransaction(prisma, ctx, {
    type: StockTransactionType.ISSUE_TO_EMPLOYEE,
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    direction: "OUT",
    daysAgo: 7,
    employeeId: ctx.employeeIdsByNumber.get("EMP-000003"),
    notes: "Bond paper issued to Ana Cruz (WHS)",
    lines: [
      { sku: "SKU-OFC-00001", quantity: "20", uomCode: "REAM", locationId: loc("SUB-WH1:A-01") },
    ],
  });
  await postSeedTransaction(prisma, ctx, {
    type: StockTransactionType.ISSUE_TO_EMPLOYEE,
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    direction: "OUT",
    daysAgo: 5,
    employeeId: ctx.employeeIdsByNumber.get("EMP-000004"),
    notes: "Ink cartridges issued to Paolo Garcia (MNT)",
    lines: [
      { sku: "SKU-OFC-00003", quantity: "2", uomCode: "PC", locationId: loc("SUB-WH1:A-02") },
    ],
  });
  return 2;
}

async function seedInTransitTransfer(
  prisma: PrismaClient,
  ctx: SeedContext,
): Promise<number> {
  const marker = await prisma.transfer.findFirst({
    where: { notes: { contains: SEED_TAG } },
    select: { id: true },
  });
  if (marker) {
    return 0;
  }

  const when = daysFromNow(-2);
  const ink = ctx.items.get("SKU-OFC-00003");
  if (!ink) {
    throw new Error("Phase 3 seed: SKU-OFC-00003 missing");
  }
  const sourceBranchId = ctx.branchIdsByCode.get("SUB") as string;
  const destinationBranchId = ctx.branchIdsByCode.get("MKT") as string;
  const sourceWarehouseId = ctx.warehouseIdsByCode.get("SUB-WH1") as string;
  const destinationWarehouseId = ctx.warehouseIdsByCode.get("MKT-WH1") as string;
  const sourceLocationId = ctx.locationIds.get("SUB-WH1:A-02") ?? null;
  const destinationLocationId = ctx.locationIds.get("MKT-WH1:RCV") ?? null;

  const transfer = await prisma.transfer.create({
    data: {
      transferNumber: await nextTransferNumber(prisma, when),
      type: TransferType.INTER_BRANCH,
      status: TransferStatus.IN_TRANSIT,
      sourceBranchId,
      sourceWarehouseId,
      sourceLocationId,
      destinationBranchId,
      destinationWarehouseId,
      destinationLocationId,
      transferDate: when,
      notes: `Restock ink for Makati — awaiting receipt ${SEED_TAG}`,
      createdById: ctx.adminUserId,
      submittedAt: when,
      approvedById: ctx.adminUserId,
      approvedAt: when,
      dispatchedById: ctx.adminUserId,
      dispatchedAt: when,
    },
    select: { id: true, transferNumber: true },
  });
  await prisma.transferLine.create({
    data: {
      transferId: transfer.id,
      lineNumber: 1,
      itemId: ink.id,
      uomId: ctx.uomIdsByCode.get("PC") as string,
      quantity: new Prisma.Decimal(4),
      baseQuantity: new Prisma.Decimal(4),
      dispatchedQuantity: new Prisma.Decimal(4),
    },
  });

  // Dispatched OUT leg: source on-hand down, destination in-transit up.
  await postSeedTransaction(prisma, ctx, {
    type: StockTransactionType.INTER_BRANCH_TRANSFER_OUT,
    branchCode: "SUB",
    warehouseCode: "SUB-WH1",
    direction: "OUT",
    daysAgo: 2,
    destinationBranchCode: "MKT",
    destinationWarehouseCode: "MKT-WH1",
    transferId: transfer.id,
    notes: `Dispatch leg of transfer ${transfer.transferNumber}`,
    lines: [
      { sku: "SKU-OFC-00003", quantity: "4", uomCode: "PC", locationId: sourceLocationId },
    ],
  });
  await applyBalanceDelta(
    prisma,
    {
      itemId: ink.id,
      branchId: destinationBranchId,
      warehouseId: destinationWarehouseId,
      storageLocationId: null,
      lotId: null,
    },
    new Prisma.Decimal(0),
    new Prisma.Decimal(4),
  );
  return 1;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function seedPhase3Inventory(prisma: PrismaClient): Promise<void> {
  const ctx = await loadContext(prisma);
  const lots = await seedLots(prisma, ctx);
  const openings = await seedOpeningBalances(prisma, ctx, lots);
  const issues = await seedIssueHistory(prisma, ctx);
  const transfers = await seedInTransitTransfer(prisma, ctx);
  console.log(
    `  Phase 3 inventory: ${openings} opening-balance txns, 2 alcohol lots (one expiring in ~20 days), ` +
      `${issues} issue txns, ${transfers} in-transit SUB→MKT transfer` +
      (openings + issues + transfers === 0 ? " (already seeded — skipped)" : ""),
  );
}
