import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import type { Prisma } from '@prisma/client';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuthUser } from '../common/types/auth-request';
import { BranchScopeService } from '../rbac/branch-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueryAuditLogsDto } from './dto/query-audit-logs.dto';

interface AuditLogView {
  id: string;
  actorUserId: string | null;
  actorDisplayName: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  branchId: string | null;
  timestamp: Date;
  ip: string | null;
  userAgent: string | null;
  correlationId: string | null;
  oldValues: unknown;
  newValues: unknown;
  reason: string | null;
}

@ApiTags('audit')
@ApiCookieAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.audit.view)
  @ApiOperation({
    summary:
      'Search the append-only audit trail (branch-scoped for non-super-admins).',
  })
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryAuditLogsDto,
  ): Promise<Paginated<AuditLogView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(
      query.sort,
      { timestamp: 'occurredAt', action: 'action' },
      { field: 'timestamp', direction: 'desc' },
    );

    const where: Prisma.AuditLogWhereInput = {};
    if (query.actor) {
      where.actorUserId = query.actor;
    }
    if (query.action) {
      where.action = { contains: query.action, mode: 'insensitive' };
    }
    if (query.resourceType) {
      where.resourceType = query.resourceType;
    }
    if (query.resourceId) {
      where.resourceId = query.resourceId;
    }
    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    if (query.branchId) {
      // Explicitly requested branch must be accessible (403 on violation).
      this.branchScope.assertBranchAccess(user, query.branchId);
      where.branchId = query.branchId;
    } else {
      const accessible = this.branchScope.branchIdsFor(user);
      if (accessible !== null) {
        // Accessible branches plus branch-less system events (auth, roles, ...).
        where.OR = [{ branchId: { in: accessible } }, { branchId: null }];
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy,
        skip,
        take,
        include: { actorUser: { select: { displayName: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const data: AuditLogView[] = rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorDisplayName: row.actorUser?.displayName ?? null,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      branchId: row.branchId,
      timestamp: row.occurredAt,
      ip: row.ipAddress,
      userAgent: row.userAgent,
      correlationId: row.requestId,
      oldValues: row.oldValues,
      newValues: row.newValues,
      reason: row.reason,
    }));

    return paginated(data, page, pageSize, total);
  }
}
