/**
 * Notification write + recipient-resolution helpers shared by the worker's
 * scheduled detectors (Phase 6, spec §20).
 *
 * Dedup contract (mirrors apps/api notifications/notification-rules.ts):
 * the DB enforces a unique (recipient_user_id, dedupe_key); detectors use
 * ONE-SHOT semantics — if any row exists for the key (read or unread) the
 * alert already happened and the detector skips. This is what makes every
 * detector idempotent across repeatable-job re-runs: keys are derived from
 * the stable identity of the condition (lot id, work order id, transfer
 * id, item+warehouse, plan+due date), never from the run.
 */
import { Prisma, PrismaClient } from "@prisma/client";

export interface WorkerNotification {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  resourceType?: string;
  /** Must be a UUID (DB column is uuid) — scope extra identity into the dedupe key. */
  resourceId?: string;
  branchId?: string;
  dedupeKey: string;
  link?: string;
}

/**
 * Insert once per (recipient, dedupeKey); returns true when a row was
 * created. Existing rows (read or unread) and concurrent-writer races are
 * both "already notified".
 */
export async function writeNotificationOnce(
  prisma: PrismaClient,
  notification: WorkerNotification,
): Promise<boolean> {
  const existing = await prisma.notification.findUnique({
    where: {
      recipientId_dedupeKey: {
        recipientId: notification.recipientId,
        dedupeKey: notification.dedupeKey,
      },
    },
    select: { id: true },
  });
  if (existing) {
    return false;
  }
  try {
    await prisma.notification.create({
      data: {
        recipientId: notification.recipientId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        resourceType: notification.resourceType ?? null,
        resourceId: notification.resourceId ?? null,
        branchId: notification.branchId ?? null,
        link: notification.link ?? null,
        dedupeKey: notification.dedupeKey,
      },
    });
    return true;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return false; // concurrent run won the unique race — already notified
    }
    throw error;
  }
}

/** Fan one notification out; returns how many rows were actually created. */
export async function notifyUsersOnce(
  prisma: PrismaClient,
  recipientIds: readonly string[],
  notification: Omit<WorkerNotification, "recipientId">,
): Promise<number> {
  let created = 0;
  for (const recipientId of [...new Set(recipientIds)]) {
    if (await writeNotificationOnce(prisma, { ...notification, recipientId })) {
      created += 1;
    }
  }
  return created;
}

/**
 * Recipient rule: active users holding `permissionCode` through an active
 * role AND explicit access to `branchId`. Super admins without explicit
 * branch access are deliberately not spammed — they configure the alerts.
 */
export async function usersWithPermissionInBranch(
  prisma: PrismaClient,
  permissionCode: string,
  branchId: string,
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      branchAccess: { some: { branchId } },
      userRoles: {
        some: {
          role: {
            isActive: true,
            rolePermissions: {
              some: { permission: { code: permissionCode } },
            },
          },
        },
      },
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

/** Active super admins — recipients of failed-job notices. */
export async function superAdminUserIds(
  prisma: PrismaClient,
): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      userRoles: { some: { role: { code: "SUPER_ADMIN" } } },
    },
    select: { id: true },
  });
  return users.map((user) => user.id);
}
