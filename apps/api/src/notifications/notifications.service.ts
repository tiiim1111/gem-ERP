import { Injectable, Logger } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated } from '../common/pagination';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { decideNotificationWrite } from './notification-rules';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

/** One in-app notification as the API serves it (always self-scoped). */
export interface NotificationView {
  id: string;
  type: string;
  title: string;
  message: string;
  resourceType: string | null;
  resourceId: string | null;
  branchId: string | null;
  link: string | null;
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

/** Input for one notification write (dedup handled inside). */
export interface NotifyInput {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  branchId?: string;
  /** Canonical key from @gemerp/shared notificationDedupeKey(). */
  dedupeKey?: string;
  /** Deep-link path from @gemerp/shared NOTIFICATION_LINKS. */
  link?: string;
  /**
   * When a READ notification with the same key exists, re-surface it as
   * unread (event-driven alerts). Defaults to true; recurring detectors set
   * false so an acknowledged condition does not nag.
   */
  reopenAfterRead?: boolean;
}

export type NotifyOutcome = 'created' | 'skipped' | 'reopened';

/**
 * A delivery channel beyond the in-app store. Email/SMS/Viber are ON HOLD
 * per GemCor (2026-07-27); the interface exists so they can be registered
 * later without touching call sites. The in-app store is NOT a channel —
 * it is the system of record every channel fans out from.
 */
export interface NotificationChannel {
  readonly name: string;
  deliver(notification: NotifyInput & { id: string }): Promise<void>;
}

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  resourceType: true,
  resourceId: true,
  branchId: true,
  link: true,
  readAt: true,
  createdAt: true,
} satisfies Prisma.NotificationSelect;

type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof NOTIFICATION_SELECT;
}>;

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    branchId: row.branchId,
    link: row.link,
    read: row.readAt !== null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * In-app notification store (api-outline 7.3). Strictly self-scoped: every
 * read/mutation filters on the authenticated recipient — there is no
 * cross-user access path, with or without permissions.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  /** External channels (empty until email/SMS come off hold). */
  private readonly channels: NotificationChannel[] = [];

  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Emission (used by the approval engine and future producers)
  // -------------------------------------------------------------------------

  /**
   * Write one notification honoring the dedup rules; failures are logged,
   * never thrown — a broken notification must not break the business
   * operation that emitted it.
   */
  async notify(input: NotifyInput): Promise<NotifyOutcome> {
    try {
      return await this.write(input);
    } catch (error) {
      this.logger.error(
        `Failed to write ${input.type} notification for ${input.recipientId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'skipped';
    }
  }

  /** Fan one notification out to many recipients (dedup per recipient). */
  async notifyMany(
    recipientIds: readonly string[],
    input: Omit<NotifyInput, 'recipientId'>,
  ): Promise<void> {
    for (const recipientId of [...new Set(recipientIds)]) {
      await this.notify({ ...input, recipientId });
    }
  }

  private async write(input: NotifyInput): Promise<NotifyOutcome> {
    const reopenAfterRead = input.reopenAfterRead ?? true;
    const existing = input.dedupeKey
      ? await this.prisma.notification.findUnique({
          where: {
            recipientId_dedupeKey: {
              recipientId: input.recipientId,
              dedupeKey: input.dedupeKey,
            },
          },
          select: { id: true, readAt: true },
        })
      : null;

    const decision = decideNotificationWrite(existing, {
      hasDedupeKey: Boolean(input.dedupeKey),
      reopenAfterRead,
    });
    if (decision === 'skip') {
      return 'skipped';
    }

    let id: string;
    if (decision === 'reopen' && existing) {
      const updated = await this.prisma.notification.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          message: input.message,
          link: input.link ?? null,
          readAt: null,
          createdAt: new Date(),
        },
        select: { id: true },
      });
      id = updated.id;
    } else {
      try {
        const created = await this.prisma.notification.create({
          data: {
            recipientId: input.recipientId,
            type: input.type,
            title: input.title,
            message: input.message,
            resourceType: input.resourceType ?? null,
            resourceId: input.resourceId ?? null,
            branchId: input.branchId ?? null,
            link: input.link ?? null,
            dedupeKey: input.dedupeKey ?? null,
          },
          select: { id: true },
        });
        id = created.id;
      } catch (error) {
        // Concurrent writer won the (recipient, dedupeKey) race — the
        // notification exists, which is exactly the dedup guarantee.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          return 'skipped';
        }
        throw error;
      }
    }

    for (const channel of this.channels) {
      try {
        await channel.deliver({ ...input, id });
      } catch (error) {
        this.logger.error(
          `Notification channel ${channel.name} failed for ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return decision === 'reopen' ? 'reopened' : 'created';
  }

  // -------------------------------------------------------------------------
  // Self-scoped reads / mutations (api-outline 7.3)
  // -------------------------------------------------------------------------

  async list(
    user: AuthUser,
    query: QueryNotificationsDto,
  ): Promise<Paginated<NotificationView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const where: Prisma.NotificationWhereInput = {
      recipientId: user.id,
      ...(query.read !== undefined
        ? { readAt: query.read ? { not: null } : null }
        : {}),
      ...(query.type ? { type: query.type } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: NOTIFICATION_SELECT,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return paginated(rows.map(toView), page, pageSize, total);
  }

  async unreadCount(user: AuthUser): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { recipientId: user.id, readAt: null },
    });
    return { unread };
  }

  async markRead(user: AuthUser, id: string): Promise<NotificationView> {
    // Self-scope inside the WHERE — another user's notification is a 404,
    // never a 403 (no existence leak).
    const claimed = await this.prisma.notification.updateMany({
      where: { id, recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id, recipientId: user.id },
      select: NOTIFICATION_SELECT,
    });
    if (!row) {
      throw AppException.notFound('Notification not found.');
    }
    void claimed;
    return toView(row);
  }

  async markAllRead(user: AuthUser): Promise<{ marked: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { marked: result.count };
  }
}
