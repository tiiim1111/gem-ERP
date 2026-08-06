/**
 * Phase 6 scheduled alert detectors (spec §20, implementation plan Phase 6).
 *
 * One repeatable BullMQ job runs the whole suite: low/out-of-stock, lot
 * expiry, maintenance overdue (work orders past their window + plans past
 * due), warranty expiry, overdue asset returns, and unreceived in-transit
 * transfers. Each detector is IDEMPOTENT through the notification dedup
 * rules (see notification-helpers.ts): stable dedupe keys mean re-runs and
 * retries never duplicate an alert.
 *
 * A try-advisory-lock serializes concurrent runs across worker replicas —
 * a second runner skips the sweep instead of racing (the unique constraint
 * would still keep the data correct; the lock keeps the logs clean).
 */
import {
  AssetAssignmentStatus,
  AssetLifecycleStatus,
  MaintenanceWorkOrderStatus,
  Prisma,
  PrismaClient,
  TransferStatus,
} from "@prisma/client";
import {
  NOTIFICATION_LINKS,
  NOTIFICATION_TYPES,
  notificationDedupeKey,
} from "@gemerp/shared";

import type { logger as rootLogger } from "../logger";
import {
  notifyUsersOnce,
  usersWithPermissionInBranch,
} from "./notification-helpers";

type Logger = typeof rootLogger;

/** Days ahead a lot/warranty expiry starts alerting. */
const EXPIRY_WINDOW_DAYS = 30;
/** Days in transit before an inter-branch transfer counts as unreceived. */
const UNRECEIVED_TRANSFER_DAYS = 3;

/** Mirror of OPEN_WO_STATUSES in apps/api maintenance/work-order-rules.ts. */
const OPEN_WO_STATUSES: MaintenanceWorkOrderStatus[] = [
  MaintenanceWorkOrderStatus.OPEN,
  MaintenanceWorkOrderStatus.ASSIGNED,
  MaintenanceWorkOrderStatus.SCHEDULED,
  MaintenanceWorkOrderStatus.IN_PROGRESS,
  MaintenanceWorkOrderStatus.ON_HOLD,
  MaintenanceWorkOrderStatus.AWAITING_PARTS,
  MaintenanceWorkOrderStatus.AWAITING_VENDOR,
];

export interface DetectorSummary {
  lowStock: number;
  outOfStock: number;
  lotExpiry: number;
  maintenanceOverdue: number;
  warrantyExpiry: number;
  overdueReturns: number;
  unreceivedTransfers: number;
}

function daysFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

const DETECTOR_LOCK_KEY = "gemerp:notification-detectors";

export async function runNotificationDetectors(
  prisma: PrismaClient,
  logger: Logger,
  now: Date = new Date(),
): Promise<DetectorSummary | null> {
  const lock = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(hashtextextended(${DETECTOR_LOCK_KEY}::text, 0)) AS locked
  `;
  if (!lock[0]?.locked) {
    logger.info("notification detectors already running elsewhere — skipping");
    return null;
  }
  try {
    const summary: DetectorSummary = {
      lowStock: 0,
      outOfStock: 0,
      lotExpiry: 0,
      maintenanceOverdue: 0,
      warrantyExpiry: 0,
      overdueReturns: 0,
      unreceivedTransfers: 0,
    };
    await detectLowAndOutOfStock(prisma, summary);
    await detectLotExpiry(prisma, summary, now);
    await detectMaintenanceOverdue(prisma, summary, now);
    await detectWarrantyExpiry(prisma, summary, now);
    await detectOverdueAssetReturns(prisma, summary, now);
    await detectUnreceivedTransfers(prisma, summary, now);
    return summary;
  } finally {
    await prisma.$queryRaw`
      SELECT pg_advisory_unlock(hashtextextended(${DETECTOR_LOCK_KEY}::text, 0)) AS unlocked
    `;
  }
}

// ---------------------------------------------------------------------------
// 1. Low / out of stock (per-warehouse reorder settings)
// ---------------------------------------------------------------------------

async function detectLowAndOutOfStock(
  prisma: PrismaClient,
  summary: DetectorSummary,
): Promise<void> {
  const settings = await prisma.itemWarehouseSetting.findMany({
    where: { reorderLevel: { not: null } },
    select: {
      itemId: true,
      warehouseId: true,
      reorderLevel: true,
      item: { select: { sku: true, name: true, isActive: true } },
      warehouse: {
        select: { code: true, name: true, branchId: true, isActive: true },
      },
    },
  });
  for (const setting of settings) {
    if (!setting.item.isActive || !setting.warehouse.isActive) {
      continue;
    }
    const onHand = await prisma.stockBalance.aggregate({
      where: { itemId: setting.itemId, warehouseId: setting.warehouseId },
      _sum: { onHandQty: true },
    });
    const total = onHand._sum.onHandQty ?? new Prisma.Decimal(0);
    const reorderLevel = setting.reorderLevel as Prisma.Decimal;
    if (total.gt(reorderLevel)) {
      continue;
    }
    const out = total.lte(0);
    const type = out
      ? NOTIFICATION_TYPES.outOfStock
      : NOTIFICATION_TYPES.lowStock;
    const recipients = await usersWithPermissionInBranch(
      prisma,
      "inventory.view",
      setting.warehouse.branchId,
    );
    const created = await notifyUsersOnce(prisma, recipients, {
      type,
      title: out ? "Out of stock" : "Low stock",
      message: `${setting.item.sku} (${setting.item.name}) is ${
        out ? "out of stock" : `at/below its reorder level (${reorderLevel.toString()})`
      } in ${setting.warehouse.code}: on hand ${total.toString()}.`,
      resourceType: "item",
      resourceId: setting.itemId,
      branchId: setting.warehouse.branchId,
      dedupeKey: notificationDedupeKey(
        type,
        "item",
        setting.itemId,
        setting.warehouseId,
      ),
      link: NOTIFICATION_LINKS.lowStock(),
    });
    if (out) {
      summary.outOfStock += created;
    } else {
      summary.lowStock += created;
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Lot expiry warning (lots with stock expiring inside the window)
// ---------------------------------------------------------------------------

async function detectLotExpiry(
  prisma: PrismaClient,
  summary: DetectorSummary,
  now: Date,
): Promise<void> {
  const threshold = daysFrom(now, EXPIRY_WINDOW_DAYS);
  const balances = await prisma.stockBalance.findMany({
    where: {
      lotId: { not: null },
      onHandQty: { gt: 0 },
      lot: { is: { expiryDate: { not: null, lte: threshold } } },
    },
    select: {
      lotId: true,
      branchId: true,
      onHandQty: true,
      lot: { select: { lotNumber: true, expiryDate: true } },
      item: { select: { sku: true } },
      warehouse: { select: { code: true } },
    },
  });
  for (const balance of balances) {
    if (!balance.lotId || !balance.lot?.expiryDate) {
      continue;
    }
    const recipients = await usersWithPermissionInBranch(
      prisma,
      "inventory.view",
      balance.branchId,
    );
    summary.lotExpiry += await notifyUsersOnce(prisma, recipients, {
      type: NOTIFICATION_TYPES.lotExpiring,
      title: "Lot expiring",
      message: `Lot ${balance.lot.lotNumber} of ${balance.item.sku} in ${balance.warehouse.code} expires ${balance.lot.expiryDate
        .toISOString()
        .slice(0, 10)} with ${balance.onHandQty.toString()} on hand.`,
      resourceType: "lot",
      resourceId: balance.lotId,
      branchId: balance.branchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.lotExpiring,
        "lot",
        balance.lotId,
      ),
      link: NOTIFICATION_LINKS.lots(),
    });
  }
}

// ---------------------------------------------------------------------------
// 3. Maintenance overdue (WOs past their window; plans past due)
// ---------------------------------------------------------------------------

async function detectMaintenanceOverdue(
  prisma: PrismaClient,
  summary: DetectorSummary,
  now: Date,
): Promise<void> {
  const overdueWos = await prisma.maintenanceWorkOrder.findMany({
    where: {
      status: { in: OPEN_WO_STATUSES },
      scheduledEndAt: { not: null, lt: now },
    },
    select: {
      id: true,
      workOrderNumber: true,
      branchId: true,
      scheduledEndAt: true,
      assignedToEmployee: { select: { userId: true } },
      asset: { select: { assetTag: true } },
    },
  });
  for (const wo of overdueWos) {
    const managers = await usersWithPermissionInBranch(
      prisma,
      "maintenance.work_order.manage",
      wo.branchId,
    );
    const recipients = [
      ...managers,
      ...(wo.assignedToEmployee?.userId ? [wo.assignedToEmployee.userId] : []),
    ];
    summary.maintenanceOverdue += await notifyUsersOnce(prisma, recipients, {
      type: NOTIFICATION_TYPES.maintenanceOverdue,
      title: "Work order overdue",
      message: `${wo.workOrderNumber} (${wo.asset.assetTag}) passed its planned end ${wo.scheduledEndAt
        ?.toISOString()
        .slice(0, 10)} and is still open.`,
      resourceType: "maintenance_work_order",
      resourceId: wo.id,
      branchId: wo.branchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.maintenanceOverdue,
        "maintenance_work_order",
        wo.id,
      ),
      link: NOTIFICATION_LINKS.workOrder(wo.id),
    });
  }

  // Plans past due (their open WO may not even exist yet).
  const overduePlans = await prisma.maintenancePlan.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      nextDueAt: { not: null, lt: now },
    },
    select: {
      id: true,
      code: true,
      name: true,
      nextDueAt: true,
      assetLinks: {
        select: { asset: { select: { branchId: true, status: true } } },
      },
    },
  });
  for (const plan of overduePlans) {
    const branchIds = [
      ...new Set(
        plan.assetLinks
          .filter(
            (link) => link.asset.status !== AssetLifecycleStatus.DISPOSED,
          )
          .map((link) => link.asset.branchId),
      ),
    ];
    for (const branchId of branchIds) {
      const recipients = await usersWithPermissionInBranch(
        prisma,
        "maintenance.work_order.manage",
        branchId,
      );
      summary.maintenanceOverdue += await notifyUsersOnce(prisma, recipients, {
        type: NOTIFICATION_TYPES.maintenanceOverdue,
        title: "Maintenance overdue",
        message: `Plan ${plan.code} (${plan.name}) was due ${plan.nextDueAt
          ?.toISOString()
          .slice(0, 10)} and has not been completed.`,
        resourceType: "maintenance_plan",
        resourceId: plan.id,
        branchId,
        dedupeKey: notificationDedupeKey(
          NOTIFICATION_TYPES.maintenanceOverdue,
          "maintenance_plan",
          plan.id,
          plan.nextDueAt?.toISOString().slice(0, 10),
        ),
        link: NOTIFICATION_LINKS.maintenancePlans(),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Warranty expiry
// ---------------------------------------------------------------------------

async function detectWarrantyExpiry(
  prisma: PrismaClient,
  summary: DetectorSummary,
  now: Date,
): Promise<void> {
  const threshold = daysFrom(now, EXPIRY_WINDOW_DAYS);
  const assets = await prisma.asset.findMany({
    where: {
      archivedAt: null,
      status: {
        notIn: [AssetLifecycleStatus.DISPOSED, AssetLifecycleStatus.RETIRED],
      },
      warrantyEndDate: { not: null, gte: now, lte: threshold },
    },
    select: {
      id: true,
      assetTag: true,
      branchId: true,
      warrantyEndDate: true,
      custodian: { select: { userId: true } },
      item: { select: { name: true } },
    },
  });
  for (const asset of assets) {
    const custodians = await usersWithPermissionInBranch(
      prisma,
      "asset.update",
      asset.branchId,
    );
    const recipients = [
      ...custodians,
      ...(asset.custodian?.userId ? [asset.custodian.userId] : []),
    ];
    summary.warrantyExpiry += await notifyUsersOnce(prisma, recipients, {
      type: NOTIFICATION_TYPES.warrantyExpiring,
      title: "Warranty expiring",
      message: `${asset.assetTag} (${asset.item.name}) warranty ends ${asset.warrantyEndDate
        ?.toISOString()
        .slice(0, 10)}.`,
      resourceType: "asset",
      resourceId: asset.id,
      branchId: asset.branchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.warrantyExpiring,
        "asset",
        asset.id,
      ),
      link: NOTIFICATION_LINKS.asset(asset.id),
    });
  }
}

// ---------------------------------------------------------------------------
// 5. Overdue asset returns
// ---------------------------------------------------------------------------

async function detectOverdueAssetReturns(
  prisma: PrismaClient,
  summary: DetectorSummary,
  now: Date,
): Promise<void> {
  const assignments = await prisma.assetAssignment.findMany({
    where: {
      status: {
        in: [
          AssetAssignmentStatus.ACTIVE,
          AssetAssignmentStatus.PENDING_ACKNOWLEDGMENT,
        ],
      },
      expectedReturnAt: { not: null, lt: now },
    },
    select: {
      id: true,
      expectedReturnAt: true,
      asset: { select: { id: true, assetTag: true, branchId: true } },
      employee: {
        select: { userId: true, displayName: true, firstName: true, lastName: true },
      },
    },
  });
  for (const assignment of assignments) {
    const managers = await usersWithPermissionInBranch(
      prisma,
      "asset.assign",
      assignment.asset.branchId,
    );
    const recipients = [
      ...managers,
      ...(assignment.employee?.userId ? [assignment.employee.userId] : []),
    ];
    const custodianName =
      assignment.employee?.displayName ??
      `${assignment.employee?.firstName ?? ""} ${assignment.employee?.lastName ?? ""}`.trim();
    summary.overdueReturns += await notifyUsersOnce(prisma, recipients, {
      type: NOTIFICATION_TYPES.assetReturnOverdue,
      title: "Asset return overdue",
      message: `${assignment.asset.assetTag} was due back ${assignment.expectedReturnAt
        ?.toISOString()
        .slice(0, 10)}${custodianName ? ` from ${custodianName}` : ""}.`,
      resourceType: "asset_assignment",
      resourceId: assignment.id,
      branchId: assignment.asset.branchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.assetReturnOverdue,
        "asset_assignment",
        assignment.id,
      ),
      link: NOTIFICATION_LINKS.asset(assignment.asset.id),
    });
  }
}

// ---------------------------------------------------------------------------
// 6. Unreceived inter-branch transfers (in transit too long)
// ---------------------------------------------------------------------------

async function detectUnreceivedTransfers(
  prisma: PrismaClient,
  summary: DetectorSummary,
  now: Date,
): Promise<void> {
  const threshold = daysFrom(now, -UNRECEIVED_TRANSFER_DAYS);
  const transfers = await prisma.transfer.findMany({
    where: {
      status: TransferStatus.IN_TRANSIT,
      dispatchedAt: { not: null, lt: threshold },
    },
    select: {
      id: true,
      transferNumber: true,
      dispatchedAt: true,
      destinationBranchId: true,
      sourceBranch: { select: { code: true } },
      destinationBranch: { select: { code: true } },
    },
  });
  for (const transfer of transfers) {
    const recipients = await usersWithPermissionInBranch(
      prisma,
      "transfer.receive",
      transfer.destinationBranchId,
    );
    summary.unreceivedTransfers += await notifyUsersOnce(prisma, recipients, {
      type: NOTIFICATION_TYPES.transferUnreceived,
      title: "Transfer awaiting receipt",
      message: `${transfer.transferNumber} (${transfer.sourceBranch.code} → ${transfer.destinationBranch.code}) has been in transit since ${transfer.dispatchedAt
        ?.toISOString()
        .slice(0, 10)} — receive and inspect it.`,
      resourceType: "transfer",
      resourceId: transfer.id,
      branchId: transfer.destinationBranchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.transferUnreceived,
        "transfer",
        transfer.id,
      ),
      link: NOTIFICATION_LINKS.transfer(transfer.id),
    });
  }
}
