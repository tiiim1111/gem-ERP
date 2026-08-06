import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { ApprovalStatus, Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import { BranchScopeService } from '../rbac/branch-scope.service';
import {
  REQUEST_DETAIL_SELECT,
  REQUEST_LIST_SELECT,
  RequestDetailView,
  RequestView,
  toRequestDetailView,
  toRequestView,
  UserRef,
} from './approval-views';
import { QueryApprovalRequestsDto } from './dto/approval-request.dto';

const SORTABLE = {
  requestedAt: 'requestedAt',
  completedAt: 'completedAt',
  status: 'status',
  documentType: 'resourceType',
};

/**
 * Approval inbox (api-outline 7.2). Visibility: users ALWAYS see requests
 * they made and requests assigned to them (any step); seeing everything
 * else needs approval.view plus branch scope. assignedToMe resolves the
 * CURRENT step's assignees and honors active delegation windows — the
 * inbox of a delegate shows the delegator's pending items.
 */
@Injectable()
export class ApprovalRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchScope: BranchScopeService,
  ) {}

  async list(
    user: AuthUser,
    query: QueryApprovalRequestsDto,
  ): Promise<Paginated<RequestView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'requestedAt',
      direction: 'desc',
    });
    if (query.branchId) {
      this.branchScope.assertBranchAccess(user, query.branchId);
    }

    const filters: Prisma.ApprovalRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.documentType ? { resourceType: query.documentType } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };

    let where: Prisma.ApprovalRequestWhereInput;
    if (query.assignedToMe) {
      const ids = await this.assignedRequestIds(user);
      where = { AND: [filters, { id: { in: ids } }] };
    } else {
      where = { AND: [filters, this.visibilityFilter(user)] };
    }

    const [rows, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        orderBy,
        skip,
        take,
        select: REQUEST_LIST_SELECT,
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return paginated(rows.map(toRequestView), page, pageSize, total);
  }

  async getById(user: AuthUser, id: string): Promise<RequestDetailView> {
    const row = await this.prisma.approvalRequest.findUnique({
      where: { id },
      select: {
        ...REQUEST_DETAIL_SELECT,
        requestedById: true,
        branchId: true,
      },
    });
    if (!row) {
      throw AppException.notFound('Approval request not found.');
    }
    const assigned = row.steps.some((step) =>
      step.assigneeUserIds.includes(user.id),
    );
    const canViewAll =
      user.isSuperAdmin ||
      (user.permissions.includes(PERMISSIONS.approval.view) &&
        (row.branchId === null || this.branchScope.canAccess(user, row.branchId)));
    if (row.requestedById !== user.id && !assigned && !canViewAll) {
      throw AppException.notFound('Approval request not found.');
    }

    const assigneeIds = [
      ...new Set(row.steps.flatMap((step) => step.assigneeUserIds)),
    ];
    const users = assigneeIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, displayName: true, email: true },
        })
      : [];
    const assigneesById = new Map<string, UserRef>(
      users.map((found) => [found.id, found]),
    );
    return toRequestDetailView(row, assigneesById);
  }

  // -------------------------------------------------------------------------
  // Visibility building blocks
  // -------------------------------------------------------------------------

  private visibilityFilter(user: AuthUser): Prisma.ApprovalRequestWhereInput {
    if (user.isSuperAdmin) {
      return {};
    }
    const own: Prisma.ApprovalRequestWhereInput[] = [
      { requestedById: user.id },
      { steps: { some: { assigneeUserIds: { has: user.id } } } },
    ];
    if (user.permissions.includes(PERMISSIONS.approval.view)) {
      own.push({
        OR: [
          { branchId: null },
          { branchId: this.branchScope.branchFilter(user) ?? undefined },
        ],
      });
    }
    return { OR: own };
  }

  /**
   * Request ids whose CURRENT step is assigned to the caller — directly or
   * via an active delegation (delegator assigned, caller the delegate).
   */
  private async assignedRequestIds(user: AuthUser): Promise<string[]> {
    const now = new Date();
    const delegations = await this.prisma.approvalDelegation.findMany({
      where: {
        delegateId: user.id,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      select: { delegatorId: true },
    });
    const actingFor = [
      user.id,
      ...delegations.map((delegation) => delegation.delegatorId),
    ];
    const candidates = await this.prisma.approvalRequestStep.findMany({
      where: {
        status: ApprovalStatus.PENDING,
        assigneeUserIds: { hasSome: actingFor },
        request: { status: ApprovalStatus.PENDING },
      },
      select: {
        stepId: true,
        requestId: true,
        request: { select: { currentStepId: true } },
      },
    });
    return [
      ...new Set(
        candidates
          .filter(
            (candidate) => candidate.stepId === candidate.request.currentStepId,
          )
          .map((candidate) => candidate.requestId),
      ),
    ];
  }
}
