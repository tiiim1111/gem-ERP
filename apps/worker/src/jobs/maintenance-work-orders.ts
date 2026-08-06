/**
 * Phase 5: generate maintenance work orders from due plans (spec §18
 * "Scheduled jobs should generate upcoming and overdue maintenance alerts";
 * master prompt maintenance rules).
 *
 * Idempotency invariant: a due plan generates exactly ONE open work order
 * per covered asset. Enforced twice —
 *   1. the candidate query skips assets that already have an open WO for the
 *      plan, and
 *   2. inside the creating transaction a per-(plan, asset) advisory lock +
 *      re-check makes the decision race-free.
 * Re-runs (scheduler fires hourly; retries after crashes) therefore never
 * duplicate. The plan's nextDueAt is NOT advanced at generation time — it
 * advances when the WO completes (the API writes nextMaintenanceAt back) —
 * so a plan stays truthfully "due/overdue" while its WO is open, and the
 * open-WO check is what prevents duplicates.
 *
 * Dueness:
 *  - interval / cron plans: nextDueAt <= now (nextDueAt is maintained by the
 *    API: creation anchors it, completion re-anchors it).
 *  - meter plans: latest reading − baseline >= meterInterval, where the
 *    baseline is the completion_meter_reading snapshot of the last completed
 *    WO of that plan+asset (0 when never serviced).
 *
 * Plans inside their reminder window emit MAINTENANCE_DUE notifications
 * (Phase 6) — deduplicated per plan + due date so hourly re-runs never nag.
 *
 * The decision logic mirrors apps/api/src/maintenance/work-order-generation.ts
 * (pure, unit-tested there); apps cannot import from each other, so the tiny
 * status sets are declared in both places with this cross-reference.
 */
import {
  AssetLifecycleStatus,
  MaintenanceWorkOrderStatus,
  Prisma,
  PrismaClient,
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

/** Mirror of OPEN_WO_STATUSES in apps/api maintenance/work-order-rules.ts. */
const OPEN_WO_STATUSES: MaintenanceWorkOrderStatus[] = [
  MaintenanceWorkOrderStatus.DRAFT,
  MaintenanceWorkOrderStatus.OPEN,
  MaintenanceWorkOrderStatus.ASSIGNED,
  MaintenanceWorkOrderStatus.SCHEDULED,
  MaintenanceWorkOrderStatus.IN_PROGRESS,
  MaintenanceWorkOrderStatus.ON_HOLD,
  MaintenanceWorkOrderStatus.AWAITING_PARTS,
  MaintenanceWorkOrderStatus.AWAITING_VENDOR,
];

/** Mirror of GENERATION_ELIGIBLE_STATUSES in work-order-generation.ts. */
const GENERATION_ELIGIBLE_STATUSES: AssetLifecycleStatus[] = [
  AssetLifecycleStatus.AVAILABLE,
  AssetLifecycleStatus.RESERVED,
  AssetLifecycleStatus.ASSIGNED,
  AssetLifecycleStatus.IN_TRANSFER,
  AssetLifecycleStatus.UNDER_INSPECTION,
  AssetLifecycleStatus.DAMAGED,
];

export interface GenerationSummary {
  plansScanned: number;
  workOrdersCreated: number;
  skippedExistingOpenWo: number;
  skippedIneligibleAsset: number;
  reminderWindowPlans: number;
}

const PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  maintenanceTypeId: true,
  assignedTeam: true,
  vendorId: true,
  createdById: true,
  intervalDays: true,
  meterInterval: true,
  meterType: true,
  nextDueAt: true,
  reminderLeadDays: true,
  tasks: {
    orderBy: { sequence: "asc" as const },
    select: { id: true, sequence: true, name: true, isRequired: true },
  },
  assetLinks: {
    select: {
      asset: {
        select: { id: true, status: true, archivedAt: true, branchId: true },
      },
    },
  },
} satisfies Prisma.MaintenancePlanSelect;

type PlanRow = Prisma.MaintenancePlanGetPayload<{ select: typeof PLAN_SELECT }>;

/** WO-{YYYY}-{SEQ5} from sequence_counters (api-outline 1.9). */
async function nextWorkOrderNumber(
  tx: Prisma.TransactionClient,
  when: Date,
): Promise<string> {
  const key = `WO-${when.getUTCFullYear()}`;
  await tx.sequenceCounter.upsert({ where: { key }, update: {}, create: { key } });
  const rows = await tx.$queryRaw<Array<{ last_value: bigint }>>`
    UPDATE sequence_counters
    SET last_value = last_value + 1, updated_at = NOW()
    WHERE key = ${key}
    RETURNING last_value
  `;
  return `${key}-${String(Number(rows[0].last_value)).padStart(5, "0")}`;
}

/**
 * Fallback system actor for generated WOs when the plan has no recorded
 * creator: any active super-admin account (created_by_id is NOT NULL by
 * design — every work order is attributable).
 */
async function findFallbackActor(prisma: PrismaClient): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: {
      isActive: true,
      archivedAt: null,
      userRoles: { some: { role: { code: "SUPER_ADMIN" } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/** Meter dueness for one covered asset (see module doc). */
async function isMeterDue(
  prisma: PrismaClient,
  plan: PlanRow,
  assetId: string,
): Promise<boolean> {
  if (plan.meterInterval === null) {
    return false;
  }
  const latest = await prisma.assetMeterReading.findFirst({
    where: {
      assetId,
      ...(plan.meterType ? { meterType: plan.meterType } : {}),
    },
    orderBy: { readingAt: "desc" },
    select: { readingValue: true },
  });
  if (!latest) {
    return false;
  }
  const lastService = await prisma.maintenanceWorkOrder.findFirst({
    where: {
      planId: plan.id,
      assetId,
      status: {
        in: [
          MaintenanceWorkOrderStatus.COMPLETED,
          MaintenanceWorkOrderStatus.VERIFIED,
        ],
      },
    },
    orderBy: { actualEndAt: "desc" },
    select: { completionMeterReading: true },
  });
  const baseline =
    lastService?.completionMeterReading ?? new Prisma.Decimal(0);
  return latest.readingValue.sub(baseline).gte(plan.meterInterval);
}

/**
 * Create ONE work order for (plan, asset) unless an open one already exists.
 * The advisory lock serializes concurrent runs on the same pair; the
 * re-check inside the lock makes the create race-free.
 */
async function createWorkOrderOnce(
  prisma: PrismaClient,
  plan: PlanRow,
  asset: { id: string; branchId: string },
  actorId: string,
  priorityId: string | null,
  now: Date,
): Promise<"created" | "skipped-open"> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`wo-gen|${plan.id}|${asset.id}`}::text, 0)
      )::text
    `;
    const open = await tx.maintenanceWorkOrder.findFirst({
      where: {
        planId: plan.id,
        assetId: asset.id,
        status: { in: OPEN_WO_STATUSES },
      },
      select: { id: true },
    });
    if (open) {
      return "skipped-open" as const;
    }
    const workOrderNumber = await nextWorkOrderNumber(tx, now);
    const dueText = plan.nextDueAt
      ? ` — due ${plan.nextDueAt.toISOString().slice(0, 10)}`
      : "";
    const workOrder = await tx.maintenanceWorkOrder.create({
      data: {
        workOrderNumber,
        assetId: asset.id,
        planId: plan.id,
        branchId: asset.branchId,
        typeId: plan.maintenanceTypeId,
        priorityId,
        status: MaintenanceWorkOrderStatus.OPEN,
        problemDescription: `[preventive] Generated from plan ${plan.code} (${plan.name})${dueText}`,
        reportedAt: now,
        assignedTeam: plan.assignedTeam,
        assignedVendorId: plan.vendorId,
        createdById: actorId,
      },
      select: { id: true },
    });
    // The plan's checklist template becomes the WO checklist.
    for (const task of plan.tasks) {
      await tx.maintenanceWorkOrderTask.create({
        data: {
          workOrderId: workOrder.id,
          planTaskId: task.id,
          sequence: task.sequence,
          name: task.name,
          isRequired: task.isRequired,
        },
      });
    }
    // Generation is a system action — still audited (spec §22).
    await tx.auditLog.create({
      data: {
        actorUserId: actorId,
        action: "maintenance_work_order.generated",
        resourceType: "maintenance_work_order",
        resourceId: workOrder.id,
        branchId: asset.branchId,
        newValues: {
          workOrderNumber,
          planId: plan.id,
          planCode: plan.code,
          assetId: asset.id,
          source: "worker:maintenance-reminders",
        },
      },
    });
    return "created" as const;
  });
}

export async function generateWorkOrdersFromDuePlans(
  prisma: PrismaClient,
  logger: Logger,
  now: Date = new Date(),
): Promise<GenerationSummary> {
  const summary: GenerationSummary = {
    plansScanned: 0,
    workOrdersCreated: 0,
    skippedExistingOpenWo: 0,
    skippedIneligibleAsset: 0,
    reminderWindowPlans: 0,
  };

  const [calendarDue, meterCandidates, fallbackActorId, defaultPriority] =
    await Promise.all([
      prisma.maintenancePlan.findMany({
        where: { isActive: true, archivedAt: null, nextDueAt: { lte: now } },
        select: PLAN_SELECT,
      }),
      prisma.maintenancePlan.findMany({
        where: {
          isActive: true,
          archivedAt: null,
          meterInterval: { not: null },
          OR: [{ nextDueAt: null }, { nextDueAt: { gt: now } }],
        },
        select: PLAN_SELECT,
      }),
      findFallbackActor(prisma),
      prisma.lookupValue.findFirst({
        where: { category: "MAINTENANCE_PRIORITY", code: "MEDIUM", isActive: true },
        select: { id: true },
      }),
    ]);

  const work: Array<{ plan: PlanRow; assetIds: string[] }> = [];

  for (const plan of calendarDue) {
    summary.plansScanned += 1;
    const assetIds: string[] = [];
    for (const link of plan.assetLinks) {
      const asset = link.asset;
      if (
        asset.archivedAt !== null ||
        !GENERATION_ELIGIBLE_STATUSES.includes(asset.status)
      ) {
        summary.skippedIneligibleAsset += 1;
        continue;
      }
      assetIds.push(asset.id);
    }
    work.push({ plan, assetIds });
  }

  for (const plan of meterCandidates) {
    summary.plansScanned += 1;
    const assetIds: string[] = [];
    for (const link of plan.assetLinks) {
      const asset = link.asset;
      if (
        asset.archivedAt !== null ||
        !GENERATION_ELIGIBLE_STATUSES.includes(asset.status)
      ) {
        summary.skippedIneligibleAsset += 1;
        continue;
      }
      if (await isMeterDue(prisma, plan, asset.id)) {
        assetIds.push(asset.id);
      }
    }
    if (assetIds.length > 0) {
      work.push({ plan, assetIds });
    }
  }

  for (const { plan, assetIds } of work) {
    const actorId = plan.createdById ?? fallbackActorId;
    if (!actorId) {
      logger.error(
        { planId: plan.id, planCode: plan.code },
        "cannot generate work orders: plan has no creator and no active super-admin exists",
      );
      continue;
    }
    const assetById = new Map(
      plan.assetLinks.map((link) => [link.asset.id, link.asset]),
    );
    for (const assetId of assetIds) {
      const asset = assetById.get(assetId);
      if (!asset) {
        continue;
      }
      const result = await createWorkOrderOnce(
        prisma,
        plan,
        asset,
        actorId,
        defaultPriority?.id ?? null,
        now,
      );
      if (result === "created") {
        summary.workOrdersCreated += 1;
      } else {
        summary.skippedExistingOpenWo += 1;
      }
    }
  }

  // Reminder window → MAINTENANCE_DUE notifications (Phase 6, spec §20).
  // Idempotent through the dedup key (plan + due date): the hourly re-run
  // never duplicates a reminder, and a NEW due date alerts again.
  const reminderPlans = await prisma.maintenancePlan.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      nextDueAt: { not: null, gt: now },
      reminderLeadDays: { not: null },
    },
    select: {
      id: true,
      code: true,
      name: true,
      nextDueAt: true,
      reminderLeadDays: true,
      assetLinks: { select: { asset: { select: { branchId: true } } } },
    },
  });
  for (const plan of reminderPlans) {
    if (!plan.nextDueAt || plan.reminderLeadDays === null) {
      continue;
    }
    const windowStart = new Date(
      plan.nextDueAt.getTime() - plan.reminderLeadDays * 24 * 60 * 60 * 1000,
    );
    if (windowStart > now) {
      continue;
    }
    summary.reminderWindowPlans += 1;
    const dueDate = plan.nextDueAt.toISOString().slice(0, 10);
    const branchIds = [
      ...new Set(plan.assetLinks.map((link) => link.asset.branchId)),
    ];
    for (const branchId of branchIds) {
      const recipients = await usersWithPermissionInBranch(
        prisma,
        "maintenance.work_order.manage",
        branchId,
      );
      const created = await notifyUsersOnce(prisma, recipients, {
        type: NOTIFICATION_TYPES.maintenanceDue,
        title: "Maintenance due soon",
        message: `Plan ${plan.code} (${plan.name}) is due ${dueDate}.`,
        resourceType: "maintenance_plan",
        resourceId: plan.id,
        branchId,
        dedupeKey: notificationDedupeKey(
          NOTIFICATION_TYPES.maintenanceDue,
          "maintenance_plan",
          plan.id,
          dueDate,
        ),
        link: NOTIFICATION_LINKS.maintenancePlans(),
      });
      if (created > 0) {
        logger.info(
          { planId: plan.id, planCode: plan.code, dueDate, branchId, created },
          "maintenance-due reminders sent",
        );
      }
    }
  }

  return summary;
}
