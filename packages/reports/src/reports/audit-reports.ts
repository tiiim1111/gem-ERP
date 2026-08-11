/**
 * Audit activity report (api-outline §8). Requires audit.view. Mirrors the
 * GET /audit-logs scope rule: non-super-admin callers see rows from their
 * accessible branches PLUS branch-less system events.
 */
import { Prisma } from '@prisma/client';
import { PERMISSIONS } from '@gemerp/shared';
import { dateRange, effectiveBranchIds, isoDateTime } from '../filters';
import type { ReportContext, ReportDefinition, ReportPrisma } from '../types';

export const auditActivity: ReportDefinition = {
  key: 'audit-activity',
  title: 'Audit activity',
  description:
    'Append-only audit trail entries: actor, action, resource, branch, and reason.',
  permission: PERMISSIONS.audit.view,
  filters: ['branchId', 'from', 'to'],
  columns: [
    { key: 'occurredAt', header: 'Occurred at', width: 1.2 },
    { key: 'actor', header: 'Actor', width: 1.2 },
    { key: 'action', header: 'Action', width: 1.4 },
    { key: 'resourceType', header: 'Resource type' },
    { key: 'resourceId', header: 'Resource id', width: 1.4 },
    { key: 'branch', header: 'Branch', width: 0.7 },
    { key: 'reason', header: 'Reason', width: 1.4 },
    { key: 'ipAddress', header: 'IP' },
  ],
  async run(prisma: ReportPrisma, ctx: ReportContext) {
    const f = ctx.filters;
    const occurred = dateRange(f);
    const scope = effectiveBranchIds(ctx);
    const where: Prisma.AuditLogWhereInput = {
      // Accessible branches plus branch-less system events; an explicit
      // branchId filter narrows to that branch only.
      ...(scope === null
        ? {}
        : f.branchId
          ? { branchId: { in: scope } }
          : { OR: [{ branchId: { in: scope } }, { branchId: null }] }),
      ...(occurred ? { occurredAt: occurred } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: ctx.skip,
        take: ctx.take,
        select: {
          occurredAt: true,
          action: true,
          resourceType: true,
          resourceId: true,
          reason: true,
          ipAddress: true,
          actorUser: { select: { displayName: true, email: true } },
          branch: { select: { code: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);
    return {
      rows: rows.map((entry) => ({
        occurredAt: isoDateTime(entry.occurredAt),
        actor: entry.actorUser
          ? `${entry.actorUser.displayName} <${entry.actorUser.email}>`
          : null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        branch: entry.branch?.code ?? null,
        reason: entry.reason,
        ipAddress: entry.ipAddress,
      })),
      total,
    };
  },
};
