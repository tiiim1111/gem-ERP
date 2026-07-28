import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { redactSensitive } from '../common/utils/redact';

export interface AuditLogEntry {
  /** Acting user's ID (absent for anonymous events such as failed logins). */
  actor?: string;
  /** Alias for `actor` so an AuditContext spread attributes the actor. */
  actorUserId?: string;
  /** Dot-notation action, e.g. "auth.login", "user.roles_replaced". */
  action: string;
  resourceType?: string;
  resourceId?: string;
  branchId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  reason?: string;
  correlationId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: unknown;
}

/**
 * Append-only audit trail writer. Secrets are always redacted before
 * persistence, and a failed audit write never breaks the business operation —
 * it is logged loudly instead.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: entry.actor ?? entry.actorUserId ?? null,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          branchId: entry.branchId ?? null,
          requestId: entry.correlationId ?? null,
          ipAddress: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          oldValues: this.toJson(entry.oldValues),
          newValues: this.toJson(entry.newValues),
          reason: entry.reason ?? null,
          metadata: this.toJson(entry.metadata),
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write audit log for action "${entry.action}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private toJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    return redactSensitive(value) as Prisma.InputJsonValue;
  }
}
