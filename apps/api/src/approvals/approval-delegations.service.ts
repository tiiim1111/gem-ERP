import { Injectable } from '@nestjs/common';
import type { Paginated } from '@gemerp/shared';
import { PERMISSIONS } from '@gemerp/shared';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import {
  DELEGATION_SELECT,
  DelegationView,
  toDelegationView,
} from './approval-views';
import {
  CreateApprovalDelegationDto,
  QueryApprovalDelegationsDto,
} from './dto/approval-delegation.dto';

/**
 * Approval delegations with time windows (spec §19). Self-service: a user
 * delegates their OWN approval authority for a date range; viewing/revoking
 * beyond one's own requires approval.manage. Deleting is a soft revoke
 * (isActive=false) so history stays explainable.
 */
@Injectable()
export class ApprovalDelegationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthUser,
    query: QueryApprovalDelegationsDto,
  ): Promise<Paginated<DelegationView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const manage =
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.approval.manage);
    if (query.all && !manage) {
      throw AppException.forbidden(
        'Listing everyone’s delegations requires approval.manage.',
      );
    }
    const where: Prisma.ApprovalDelegationWhereInput = {
      ...(query.all
        ? {}
        : { OR: [{ delegatorId: user.id }, { delegateId: user.id }] }),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.approvalDelegation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: DELEGATION_SELECT,
      }),
      this.prisma.approvalDelegation.count({ where }),
    ]);
    return paginated(rows.map(toDelegationView), page, pageSize, total);
  }

  async create(
    user: AuthUser,
    dto: CreateApprovalDelegationDto,
    ctx: AuditContext,
  ): Promise<DelegationView> {
    if (dto.delegateUserId === user.id) {
      throw AppException.validation([
        {
          field: 'delegateUserId',
          message: 'You cannot delegate approvals to yourself.',
        },
      ]);
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (endsAt.getTime() <= startsAt.getTime()) {
      throw AppException.validation([
        { field: 'endsAt', message: 'endsAt must be after startsAt.' },
      ]);
    }
    const delegate = await this.prisma.user.findFirst({
      where: { id: dto.delegateUserId, isActive: true, archivedAt: null },
      select: { id: true },
    });
    if (!delegate) {
      throw AppException.validation([
        {
          field: 'delegateUserId',
          message: 'Delegate user does not exist or is inactive.',
        },
      ]);
    }

    const created = await this.prisma.approvalDelegation.create({
      data: {
        delegatorId: user.id,
        delegateId: dto.delegateUserId,
        startsAt,
        endsAt,
        reason: dto.reason ?? null,
      },
      select: DELEGATION_SELECT,
    });
    await this.audit.log({
      action: 'approval_delegation.created',
      resourceType: 'approval_delegation',
      resourceId: created.id,
      newValues: {
        delegateUserId: dto.delegateUserId,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
      },
      reason: dto.reason,
      ...ctx,
    });
    return toDelegationView(created);
  }

  async revoke(user: AuthUser, id: string, ctx: AuditContext): Promise<void> {
    const delegation = await this.prisma.approvalDelegation.findUnique({
      where: { id },
      select: { id: true, delegatorId: true, isActive: true },
    });
    const manage =
      user.isSuperAdmin ||
      user.permissions.includes(PERMISSIONS.approval.manage);
    if (!delegation || (delegation.delegatorId !== user.id && !manage)) {
      throw AppException.notFound('Delegation not found.');
    }
    if (delegation.isActive) {
      await this.prisma.approvalDelegation.update({
        where: { id },
        data: { isActive: false },
      });
    }
    await this.audit.log({
      action: 'approval_delegation.revoked',
      resourceType: 'approval_delegation',
      resourceId: id,
      oldValues: { isActive: delegation.isActive },
      newValues: { isActive: false },
      ...ctx,
    });
  }
}
