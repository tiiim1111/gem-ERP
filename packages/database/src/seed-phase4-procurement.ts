/**
 * Phase 4 procurement seed: suppliers (with contacts and SUPPLIER_CATEGORY
 * lookups), and three purchase orders exercising the whole receiving story:
 *
 * - PO-…a  FULLY_RECEIVED — one posted goods receipt that produced two
 *   serialized laptop assets (tags from the real sequence counters) and a
 *   posted PURCHASE_RECEIPT stock transaction (+20 REAM bond paper).
 * - PO-…b  PARTIALLY_RECEIVED — approved, 12 of 24 PC isopropyl alcohol
 *   received into a new lot via a posted receipt.
 * - PO-…c  PENDING_APPROVAL — submitted by the branch admin, awaiting an
 *   approver (approver ≠ requester, spec §19).
 *
 * Invoked by seed.ts (the orchestrator wires it in). Idempotent: suppliers
 * and lookups upsert on natural keys; the document section is keyed on the
 * "[seed:phase4]" notes marker so re-running never duplicates stock.
 *
 * Consistency contract (spec §3): every seeded balance delta equals the sum
 * of the seeded immutable ledger entries for its bucket, exactly as the API
 * posting engine would have produced. (The Nest services are not importable
 * from this package — packages must not depend on apps — so this file
 * mirrors the engine's math with local helpers, same as the Phase 3 seed.)
 */
import { randomBytes } from "node:crypto";
import {
  GoodsReceiptStatus,
  Prisma,
  PrismaClient,
  PurchaseOrderStatus,
  StockDocumentStatus,
  StockTransactionType,
} from "@prisma/client";

const SEED_TAG = "[seed:phase4]";

// ---------------------------------------------------------------------------
// Document numbering (mirrors apps/api procurement-numbers.ts, outline 1.9)
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

const pad = (value: number, width: number): string =>
  String(value).padStart(width, "0");

async function nextPoNumber(prisma: PrismaClient, date: Date): Promise<string> {
  const year = date.getUTCFullYear();
  return `PO-${year}-${pad(await nextSequence(prisma, `PO-${year}`), 5)}`;
}

async function nextGrNumber(prisma: PrismaClient, date: Date): Promise<string> {
  const year = date.getUTCFullYear();
  return `GR-${year}-${pad(await nextSequence(prisma, `GR-${year}`), 5)}`;
}

async function nextStockTransactionNumber(
  prisma: PrismaClient,
  date: Date,
): Promise<string> {
  const year = date.getUTCFullYear();
  return `STK-${year}-${pad(await nextSequence(prisma, `STK-${year}`), 6)}`;
}

async function nextAssetTag(
  prisma: PrismaClient,
  branchCode: string,
  categoryCode: string,
  date: Date,
): Promise<string> {
  const year = date.getUTCFullYear();
  const key = `AST-${branchCode}-${categoryCode}-${year}`;
  return `${key}-${pad(await nextSequence(prisma, key), 6)}`;
}

function daysFromNow(days: number): Date {
  const date = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

const D = (value: string | number) => new Prisma.Decimal(value);

// ---------------------------------------------------------------------------
// Lookups: supplier categories + return reasons
// ---------------------------------------------------------------------------

const LOOKUPS: Record<string, Array<{ code: string; name: string }>> = {
  SUPPLIER_CATEGORY: [
    { code: "IT_EQUIPMENT", name: "IT Equipment" },
    { code: "OFFICE_SUPPLIES", name: "Office Supplies" },
    { code: "SAFETY_PPE", name: "Safety & PPE" },
    { code: "SERVICES", name: "Services" },
  ],
  RETURN_REASON: [
    { code: "DAMAGED_GOODS", name: "Damaged goods" },
    { code: "WRONG_ITEM", name: "Wrong item delivered" },
    { code: "EXPIRED_STOCK", name: "Expired on arrival" },
    { code: "OVER_DELIVERY", name: "Over-delivery" },
  ],
};

async function seedLookups(prisma: PrismaClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [category, values] of Object.entries(LOOKUPS)) {
    for (const [index, value] of values.entries()) {
      const row = await prisma.lookupValue.upsert({
        where: { category_code: { category, code: value.code } },
        update: { name: value.name, sortOrder: index + 1, isActive: true },
        create: {
          category,
          code: value.code,
          name: value.name,
          sortOrder: index + 1,
        },
      });
      ids.set(`${category}:${value.code}`, row.id);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

interface SupplierSeed {
  code: string;
  legalName: string;
  tradeName?: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  taxId: string;
  paymentTerms: string;
  categoryKey: string;
  contacts: Array<{
    name: string;
    position: string;
    email: string;
    phone: string;
    isPrimary: boolean;
  }>;
}

const SUPPLIERS: SupplierSeed[] = [
  {
    code: "SUP-00001",
    legalName: "TechnoHub IT Solutions Inc.",
    tradeName: "TechnoHub",
    email: "sales@technohub.ph",
    phone: "+63 2 8123 4567",
    address: "18F Cyber One Bldg, Eastwood Ave",
    city: "Quezon City",
    taxId: "TIN-201-555-001",
    paymentTerms: "Net 30",
    categoryKey: "SUPPLIER_CATEGORY:IT_EQUIPMENT",
    contacts: [
      {
        name: "Ramon Dizon",
        position: "Account Manager",
        email: "ramon.dizon@technohub.ph",
        phone: "+63 917 555 0101",
        isPrimary: true,
      },
      {
        name: "Karen Uy",
        position: "Sales Support",
        email: "karen.uy@technohub.ph",
        phone: "+63 917 555 0102",
        isPrimary: false,
      },
    ],
  },
  {
    code: "SUP-00002",
    legalName: "OfficePro Trading Corp.",
    tradeName: "OfficePro",
    email: "orders@officepro.ph",
    phone: "+63 47 252 8890",
    address: "Warehouse 3, Subic Gateway Park",
    city: "Subic",
    taxId: "TIN-201-555-002",
    paymentTerms: "Net 15",
    categoryKey: "SUPPLIER_CATEGORY:OFFICE_SUPPLIES",
    contacts: [
      {
        name: "Lea Bautista",
        position: "Sales Officer",
        email: "lea.bautista@officepro.ph",
        phone: "+63 917 555 0201",
        isPrimary: true,
      },
    ],
  },
  {
    code: "SUP-00003",
    legalName: "SafeGuard Industrial Supply Co.",
    email: "info@safeguard-ph.com",
    phone: "+63 45 625 7712",
    address: "MacArthur Hwy, San Fernando",
    city: "Pampanga",
    taxId: "TIN-201-555-003",
    paymentTerms: "COD",
    categoryKey: "SUPPLIER_CATEGORY:SAFETY_PPE",
    contacts: [
      {
        name: "Dennis Ocampo",
        position: "Branch Manager",
        email: "dennis.ocampo@safeguard-ph.com",
        phone: "+63 917 555 0301",
        isPrimary: true,
      },
    ],
  },
];

async function seedSuppliers(
  prisma: PrismaClient,
  lookupIds: Map<string, string>,
): Promise<Map<string, string>> {
  const idsByCode = new Map<string, string>();
  for (const seed of SUPPLIERS) {
    const supplier = await prisma.supplier.upsert({
      where: { code: seed.code },
      update: {
        legalName: seed.legalName,
        tradeName: seed.tradeName ?? null,
        categoryId: lookupIds.get(seed.categoryKey) ?? null,
        isActive: true,
      },
      create: {
        code: seed.code,
        legalName: seed.legalName,
        tradeName: seed.tradeName ?? null,
        email: seed.email,
        phone: seed.phone,
        address: seed.address,
        city: seed.city,
        country: "PH",
        taxId: seed.taxId,
        paymentTerms: seed.paymentTerms,
        categoryId: lookupIds.get(seed.categoryKey) ?? null,
        notes: `Phase 4 seed supplier ${SEED_TAG}`,
      },
    });
    idsByCode.set(seed.code, supplier.id);

    for (const contact of seed.contacts) {
      const existing = await prisma.supplierContact.findFirst({
        where: { supplierId: supplier.id, name: contact.name },
      });
      if (!existing) {
        await prisma.supplierContact.create({
          data: { supplierId: supplier.id, ...contact },
        });
      }
    }
    // Raise the SUP counter past explicit seed codes.
    const numeric = Number(seed.code.split("-").pop());
    await prisma.sequenceCounter.upsert({
      where: { key: "SUP" },
      update: {},
      create: { key: "SUP", lastValue: BigInt(numeric) },
    });
    await prisma.sequenceCounter.updateMany({
      where: { key: "SUP", lastValue: { lt: BigInt(numeric) } },
      data: { lastValue: BigInt(numeric) },
    });
  }
  return idsByCode;
}

// ---------------------------------------------------------------------------
// Context loaded from earlier phases
// ---------------------------------------------------------------------------

interface SeedContext {
  branchId: string;
  branchCode: string;
  warehouseId: string;
  receivingLocationId: string | null;
  items: Map<
    string,
    { id: string; baseUomId: string; categoryCode: string | null }
  >;
  uomIdsByCode: Map<string, string>;
  adminUserId: string;
  branchAdminUserId: string;
  conditionNewId: string | null;
}

async function loadContext(prisma: PrismaClient): Promise<SeedContext> {
  const branch = await prisma.branch.findUnique({
    where: { code: "SUB" },
    select: { id: true, code: true },
  });
  const warehouse = await prisma.warehouse.findFirst({
    where: { code: "SUB-WH1" },
    select: { id: true, defaultReceivingLocationId: true },
  });
  const items = await prisma.item.findMany({
    where: {
      sku: {
        in: [
          "SKU-LAP-00001",
          "SKU-MON-00001",
          "SKU-OFC-00001",
          "SKU-OFC-00003",
          "SKU-PPE-00001",
          "SKU-PPE-00002",
        ],
      },
    },
    select: {
      id: true,
      sku: true,
      baseUomId: true,
      category: { select: { code: true } },
    },
  });
  const uoms = await prisma.unitOfMeasure.findMany({
    where: { code: { in: ["PC", "BOX", "REAM"] } },
    select: { id: true, code: true },
  });
  const admin = await prisma.user.findUnique({
    where: { email: "superadmin@gemcor.dev" },
    select: { id: true },
  });
  const branchAdmin = await prisma.user.findUnique({
    where: { email: "branchadmin@gemcor.dev" },
    select: { id: true },
  });
  const conditionNew = await prisma.lookupValue.findFirst({
    where: { category: "ASSET_CONDITION", code: "NEW", isActive: true },
    select: { id: true },
  });

  if (!branch || !warehouse || !admin || !branchAdmin || items.length < 6) {
    throw new Error(
      "Phase 4 seed requires the Phase 1-3 seed data (branches, warehouses, items, users) — run the base seed first.",
    );
  }
  return {
    branchId: branch.id,
    branchCode: branch.code,
    warehouseId: warehouse.id,
    receivingLocationId: warehouse.defaultReceivingLocationId,
    items: new Map(
      items.map((item) => [
        item.sku,
        {
          id: item.id,
          baseUomId: item.baseUomId,
          categoryCode: item.category?.code ?? null,
        },
      ]),
    ),
    uomIdsByCode: new Map(uoms.map((uom) => [uom.code, uom.id])),
    adminUserId: admin.id,
    branchAdminUserId: branchAdmin.id,
    conditionNewId: conditionNew?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Mini posting helper (mirrors the API posting engine's math)
// ---------------------------------------------------------------------------

async function applyBalanceDelta(
  prisma: PrismaClient,
  bucket: {
    itemId: string;
    branchId: string;
    warehouseId: string;
    storageLocationId: string | null;
    lotId: string | null;
  },
  delta: Prisma.Decimal,
): Promise<void> {
  const existing = await prisma.stockBalance.findFirst({
    where: {
      itemId: bucket.itemId,
      warehouseId: bucket.warehouseId,
      storageLocationId: bucket.storageLocationId,
      lotId: bucket.lotId,
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.stockBalance.update({
      where: { id: existing.id },
      data: { onHandQty: { increment: delta } },
    });
  } else {
    await prisma.stockBalance.create({
      data: { ...bucket, onHandQty: delta },
    });
  }
}

/** POSTED PURCHASE_RECEIPT stock txn + lines + ledger + balances for a GR. */
async function postReceiptStock(
  prisma: PrismaClient,
  ctx: SeedContext,
  args: {
    when: Date;
    supplierId: string;
    purchaseOrderId: string;
    goodsReceiptId: string;
    receiptNumber: string;
    poNumber: string;
    idempotencyKey: string;
    lines: Array<{
      sku: string;
      quantity: string;
      uomCode: string;
      unitCost: string;
      lotId?: string | null;
    }>;
  },
): Promise<void> {
  const txn = await prisma.stockTransaction.create({
    data: {
      transactionNumber: await nextStockTransactionNumber(prisma, args.when),
      type: StockTransactionType.PURCHASE_RECEIPT,
      status: StockDocumentStatus.POSTED,
      transactionDate: args.when,
      branchId: ctx.branchId,
      destinationWarehouseId: ctx.warehouseId,
      supplierId: args.supplierId,
      purchaseOrderId: args.purchaseOrderId,
      goodsReceiptId: args.goodsReceiptId,
      idempotencyKey: args.idempotencyKey,
      notes: `[system] Purchase receipt ${args.receiptNumber} against ${args.poNumber} ${SEED_TAG}`,
      createdById: ctx.adminUserId,
      submittedAt: args.when,
      approvedById: ctx.adminUserId,
      approvedAt: args.when,
      postedById: ctx.adminUserId,
      postedAt: args.when,
    },
    select: { id: true },
  });

  let lineNumber = 0;
  for (const line of args.lines) {
    lineNumber += 1;
    const item = ctx.items.get(line.sku);
    if (!item) {
      throw new Error(`Phase 4 seed: unknown item ${line.sku}`);
    }
    const quantity = D(line.quantity);
    const unitCost = D(line.unitCost);
    const created = await prisma.stockTransactionLine.create({
      data: {
        transactionId: txn.id,
        lineNumber,
        itemId: item.id,
        lotId: line.lotId ?? null,
        destinationLocationId: ctx.receivingLocationId,
        enteredUomId: ctx.uomIdsByCode.get(line.uomCode) as string,
        enteredQuantity: quantity,
        baseQuantity: quantity,
        unitCost,
        totalCost: unitCost.mul(quantity).toDecimalPlaces(2),
      },
      select: { id: true },
    });
    const bucket = {
      itemId: item.id,
      branchId: ctx.branchId,
      warehouseId: ctx.warehouseId,
      storageLocationId: ctx.receivingLocationId,
      lotId: line.lotId ?? null,
    };
    await prisma.stockLedgerEntry.create({
      data: {
        transactionId: txn.id,
        transactionLineId: created.id,
        itemId: item.id,
        lotId: line.lotId ?? null,
        branchId: ctx.branchId,
        warehouseId: ctx.warehouseId,
        storageLocationId: ctx.receivingLocationId,
        quantityDelta: quantity,
        unitCost,
        postedAt: args.when,
      },
    });
    await applyBalanceDelta(prisma, bucket, quantity);
    await prisma.item.update({
      where: { id: item.id },
      data: { lastPurchaseCost: unitCost },
    });
  }
}

// ---------------------------------------------------------------------------
// Purchase orders + receipts
// ---------------------------------------------------------------------------

async function seedDocuments(
  prisma: PrismaClient,
  ctx: SeedContext,
  supplierIds: Map<string, string>,
): Promise<{ pos: number; receipts: number; assets: number }> {
  const marker = await prisma.purchaseOrder.findFirst({
    where: { notes: { contains: SEED_TAG } },
    select: { id: true },
  });
  if (marker) {
    return { pos: 0, receipts: 0, assets: 0 };
  }

  const technohubId = supplierIds.get("SUP-00001") as string;
  const officeproId = supplierIds.get("SUP-00002") as string;
  const laptop = ctx.items.get("SKU-LAP-00001")!;
  const monitor = ctx.items.get("SKU-MON-00001")!;
  const paper = ctx.items.get("SKU-OFC-00001")!;
  const ink = ctx.items.get("SKU-OFC-00003")!;
  const alcohol = ctx.items.get("SKU-PPE-00001")!;
  const gloves = ctx.items.get("SKU-PPE-00002")!;
  const pc = ctx.uomIdsByCode.get("PC") as string;
  const box = ctx.uomIdsByCode.get("BOX") as string;
  const ream = ctx.uomIdsByCode.get("REAM") as string;

  let assetCount = 0;

  // ----- PO 1: laptops + paper, FULLY received 6 days ago -----------------
  const po1Date = daysFromNow(-10);
  const gr1Date = daysFromNow(-6);
  const po1 = await prisma.purchaseOrder.create({
    data: {
      poNumber: await nextPoNumber(prisma, po1Date),
      supplierId: technohubId,
      branchId: ctx.branchId,
      destinationWarehouseId: ctx.warehouseId,
      status: PurchaseOrderStatus.FULLY_RECEIVED,
      orderDate: po1Date,
      expectedDeliveryDate: daysFromNow(-5),
      currencyCode: "PHP",
      subtotal: D("133700.00"), // 2×64500 + 20×235
      discountTotal: D("1000.00"),
      taxTotal: D("0"),
      grandTotal: D("132700.00"),
      terms: "Net 30",
      notes: `Laptop rollout + paper restock — fully delivered ${SEED_TAG}`,
      version: 4, // create + submit(auto-approve) + receipt
      createdById: ctx.adminUserId,
      submittedAt: po1Date,
      approvedById: ctx.adminUserId,
      approvedAt: po1Date,
      lines: {
        create: [
          {
            lineNumber: 1,
            itemId: laptop.id,
            uomId: pc,
            quantity: D("2"),
            unitPrice: D("64500.00"),
            discountAmount: D("1000.00"),
            taxAmount: D("0"),
            lineTotal: D("128000.00"),
            receivedQuantity: D("2"),
          },
          {
            lineNumber: 2,
            itemId: paper.id,
            uomId: ream,
            quantity: D("20"),
            unitPrice: D("235.00"),
            discountAmount: D("0"),
            taxAmount: D("0"),
            lineTotal: D("4700.00"),
            receivedQuantity: D("20"),
          },
        ],
      },
    },
    select: { id: true, poNumber: true, lines: { select: { id: true, lineNumber: true } } },
  });
  const po1Line1 = po1.lines.find((line) => line.lineNumber === 1)!;
  const po1Line2 = po1.lines.find((line) => line.lineNumber === 2)!;

  const gr1 = await prisma.goodsReceipt.create({
    data: {
      receiptNumber: await nextGrNumber(prisma, gr1Date),
      purchaseOrderId: po1.id,
      branchId: ctx.branchId,
      warehouseId: ctx.warehouseId,
      status: GoodsReceiptStatus.POSTED,
      receiptDate: gr1Date,
      supplierReference: "DR-8842 / SI-0913",
      notes: `Full delivery from TechnoHub ${SEED_TAG}`,
      idempotencyKey: "seed-phase4-gr1-post",
      version: 2,
      createdById: ctx.adminUserId,
      postedById: ctx.adminUserId,
      postedAt: gr1Date,
    },
    select: { id: true, receiptNumber: true },
  });
  const gr1Line1 = await prisma.goodsReceiptLine.create({
    data: {
      goodsReceiptId: gr1.id,
      purchaseOrderLineId: po1Line1.id,
      lineNumber: 1,
      itemId: laptop.id,
      uomId: pc,
      receivedQuantity: D("2"),
      baseQuantity: D("2"),
      unitCost: D("64000.00"), // (2×64500 − 1000) / 2
      serialNumbers: ["DL5450-P4-0001", "DL5450-P4-0002"],
      storageLocationId: ctx.receivingLocationId,
    },
    select: { id: true },
  });
  await prisma.goodsReceiptLine.create({
    data: {
      goodsReceiptId: gr1.id,
      purchaseOrderLineId: po1Line2.id,
      lineNumber: 2,
      itemId: paper.id,
      uomId: ream,
      receivedQuantity: D("20"),
      baseQuantity: D("20"),
      unitCost: D("235.00"),
      storageLocationId: ctx.receivingLocationId,
    },
  });

  // Serialized assets exactly as receipt posting creates them.
  for (const serial of ["DL5450-P4-0001", "DL5450-P4-0002"]) {
    const asset = await prisma.asset.create({
      data: {
        assetTag: await nextAssetTag(
          prisma,
          ctx.branchCode,
          laptop.categoryCode ?? "LAP",
          gr1Date,
        ),
        scanToken: randomBytes(32).toString("base64url"),
        serialNumber: serial,
        itemId: laptop.id,
        status: ctx.conditionNewId ? "AVAILABLE" : "DRAFT",
        conditionId: ctx.conditionNewId,
        branchId: ctx.branchId,
        warehouseId: ctx.warehouseId,
        storageLocationId: ctx.receivingLocationId,
        acquisitionDate: gr1Date,
        acquisitionCost: D("64000.00"),
        supplierId: technohubId,
        purchaseOrderId: po1.id,
        goodsReceiptLineId: gr1Line1.id,
        notes: `Received via ${gr1.receiptNumber} ${SEED_TAG}`,
      },
      select: { id: true },
    });
    await prisma.assetStatusHistory.create({
      data: {
        assetId: asset.id,
        fromStatus: null,
        toStatus: "DRAFT",
        changedAt: gr1Date,
        changedById: ctx.adminUserId,
        notes: `register (goods receipt ${gr1.receiptNumber})`,
      },
    });
    if (ctx.conditionNewId) {
      await prisma.assetStatusHistory.create({
        data: {
          assetId: asset.id,
          fromStatus: "DRAFT",
          toStatus: "AVAILABLE",
          changedAt: gr1Date,
          changedById: ctx.adminUserId,
          notes: `activate (received via ${gr1.receiptNumber})`,
        },
      });
      await prisma.assetConditionHistory.create({
        data: {
          assetId: asset.id,
          conditionId: ctx.conditionNewId,
          recordedAt: gr1Date,
          recordedById: ctx.adminUserId,
          source: "goods_receipt",
        },
      });
    }
    assetCount += 1;
  }

  // Quantity stock (paper) through the mirrored posting math.
  await postReceiptStock(prisma, ctx, {
    when: gr1Date,
    supplierId: technohubId,
    purchaseOrderId: po1.id,
    goodsReceiptId: gr1.id,
    receiptNumber: gr1.receiptNumber,
    poNumber: po1.poNumber,
    idempotencyKey: "seed-phase4-stk-gr1",
    lines: [{ sku: "SKU-OFC-00001", quantity: "20", uomCode: "REAM", unitCost: "235.00" }],
  });

  // ----- PO 2: alcohol (LOT) + ink, PARTIALLY received --------------------
  const po2Date = daysFromNow(-7);
  const gr2Date = daysFromNow(-3);
  const po2 = await prisma.purchaseOrder.create({
    data: {
      poNumber: await nextPoNumber(prisma, po2Date),
      supplierId: officeproId,
      branchId: ctx.branchId,
      destinationWarehouseId: ctx.warehouseId,
      status: PurchaseOrderStatus.PARTIALLY_RECEIVED,
      orderDate: po2Date,
      expectedDeliveryDate: daysFromNow(2),
      currencyCode: "PHP",
      subtotal: D("6518.00"), // 24×82 + 10×455
      discountTotal: D("0"),
      taxTotal: D("0"),
      grandTotal: D("6518.00"),
      terms: "Net 15",
      notes: `Sanitation + printer consumables — first drop received ${SEED_TAG}`,
      version: 4,
      createdById: ctx.adminUserId,
      submittedAt: po2Date,
      approvedById: ctx.adminUserId,
      approvedAt: po2Date,
      lines: {
        create: [
          {
            lineNumber: 1,
            itemId: alcohol.id,
            uomId: pc,
            quantity: D("24"),
            unitPrice: D("82.00"),
            discountAmount: D("0"),
            taxAmount: D("0"),
            lineTotal: D("1968.00"),
            receivedQuantity: D("12"),
          },
          {
            lineNumber: 2,
            itemId: ink.id,
            uomId: pc,
            quantity: D("10"),
            unitPrice: D("455.00"),
            discountAmount: D("0"),
            taxAmount: D("0"),
            lineTotal: D("4550.00"),
            receivedQuantity: D("0"),
          },
        ],
      },
    },
    select: { id: true, poNumber: true, lines: { select: { id: true, lineNumber: true } } },
  });
  const po2Line1 = po2.lines.find((line) => line.lineNumber === 1)!;

  const gr2Lot = await prisma.inventoryLot.upsert({
    where: {
      itemId_lotNumber: {
        itemId: alcohol.id,
        lotNumber: "LOT-PPE-00001-P4SEED-01",
      },
    },
    update: {},
    create: {
      itemId: alcohol.id,
      lotNumber: "LOT-PPE-00001-P4SEED-01",
      barcode: "LOT-PPE-00001-P4SEED-01",
      supplierLotNumber: "OPRO-ALC-2026-118",
      expiryDate: daysFromNow(300),
      notes: `Phase 4 seed lot ${SEED_TAG}`,
    },
    select: { id: true },
  });

  const gr2 = await prisma.goodsReceipt.create({
    data: {
      receiptNumber: await nextGrNumber(prisma, gr2Date),
      purchaseOrderId: po2.id,
      branchId: ctx.branchId,
      warehouseId: ctx.warehouseId,
      status: GoodsReceiptStatus.POSTED,
      receiptDate: gr2Date,
      supplierReference: "DR-9107",
      notes: `Partial delivery — alcohol only, ink to follow ${SEED_TAG}`,
      idempotencyKey: "seed-phase4-gr2-post",
      version: 2,
      createdById: ctx.adminUserId,
      postedById: ctx.adminUserId,
      postedAt: gr2Date,
    },
    select: { id: true, receiptNumber: true },
  });
  await prisma.goodsReceiptLine.create({
    data: {
      goodsReceiptId: gr2.id,
      purchaseOrderLineId: po2Line1.id,
      lineNumber: 1,
      itemId: alcohol.id,
      uomId: pc,
      receivedQuantity: D("12"),
      baseQuantity: D("12"),
      unitCost: D("82.00"),
      lotId: gr2Lot.id,
      storageLocationId: ctx.receivingLocationId,
    },
  });
  await postReceiptStock(prisma, ctx, {
    when: gr2Date,
    supplierId: officeproId,
    purchaseOrderId: po2.id,
    goodsReceiptId: gr2.id,
    receiptNumber: gr2.receiptNumber,
    poNumber: po2.poNumber,
    idempotencyKey: "seed-phase4-stk-gr2",
    lines: [
      {
        sku: "SKU-PPE-00001",
        quantity: "12",
        uomCode: "PC",
        unitCost: "82.00",
        lotId: gr2Lot.id,
      },
    ],
  });

  // ----- PO 3: monitors + gloves, PENDING approval ------------------------
  const po3Date = daysFromNow(-1);
  await prisma.purchaseOrder.create({
    data: {
      poNumber: await nextPoNumber(prisma, po3Date),
      supplierId: technohubId,
      branchId: ctx.branchId,
      destinationWarehouseId: ctx.warehouseId,
      status: PurchaseOrderStatus.PENDING_APPROVAL,
      orderDate: po3Date,
      expectedDeliveryDate: daysFromNow(10),
      currencyCode: "PHP",
      subtotal: D("39750.00"), // 3×12200 + 10×315
      discountTotal: D("0"),
      taxTotal: D("0"),
      grandTotal: D("39750.00"),
      terms: "Net 30",
      notes: `Monitor + PPE top-up — awaiting approval ${SEED_TAG}`,
      version: 2,
      createdById: ctx.branchAdminUserId,
      submittedAt: po3Date,
      lines: {
        create: [
          {
            lineNumber: 1,
            itemId: monitor.id,
            uomId: pc,
            quantity: D("3"),
            unitPrice: D("12200.00"),
            discountAmount: D("0"),
            taxAmount: D("0"),
            lineTotal: D("36600.00"),
          },
          {
            lineNumber: 2,
            itemId: gloves.id,
            uomId: box,
            quantity: D("10"),
            unitPrice: D("315.00"),
            discountAmount: D("0"),
            taxAmount: D("0"),
            lineTotal: D("3150.00"),
          },
        ],
      },
    },
  });

  return { pos: 3, receipts: 2, assets: assetCount };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function seedPhase4Procurement(prisma: PrismaClient): Promise<void> {
  const lookupIds = await seedLookups(prisma);
  const supplierIds = await seedSuppliers(prisma, lookupIds);
  const ctx = await loadContext(prisma);
  const documents = await seedDocuments(prisma, ctx, supplierIds);
  console.log(
    `  Phase 4 procurement: ${supplierIds.size} suppliers (with contacts + categories), ` +
      `${documents.pos} POs (1 fully received, 1 partially received, 1 pending approval), ` +
      `${documents.receipts} posted receipts, ${documents.assets} serialized assets` +
      (documents.pos === 0 ? " (already seeded — skipped)" : ""),
  );
}
