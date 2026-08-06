import { Injectable } from '@nestjs/common';
import type { ApiErrorDetail, Paginated } from '@gemerp/shared';
import { ApprovalApproverType, ApprovalStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import { pageArgs, paginated, parseSort } from '../common/pagination';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { PrismaService } from '../prisma/prisma.service';
import {
  toWorkflowDetailView,
  toWorkflowView,
  WORKFLOW_DETAIL_SELECT,
  WORKFLOW_LIST_SELECT,
  WorkflowDetailView,
  WorkflowView,
} from './approval-views';
import {
  ApprovalStepDto,
  CreateApprovalWorkflowDto,
  QueryApprovalWorkflowsDto,
  UpdateApprovalWorkflowDto,
} from './dto/approval-workflow.dto';

const SORTABLE = {
  code: 'code',
  name: 'name',
  documentType: 'resourceType',
  createdAt: 'createdAt',
};

interface NormalizedStep {
  sequence: number;
  name: string | null;
  approverType: ApprovalApproverType;
  approverRoleId: string | null;
  approverPositionId: string | null;
  approverUserId: string | null;
}

/**
 * Approval workflow configuration (api-outline 7.2): document type, branch
 * scope, amount/quantity thresholds, ordered steps whose approvers resolve
 * by ROLE | POSITION | DEPT_HEAD | USER at request time. Gated by
 * approval.manage; every mutation audited.
 */
@Injectable()
export class ApprovalWorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: QueryApprovalWorkflowsDto,
  ): Promise<Paginated<WorkflowView>> {
    const { page, pageSize, skip, take } = pageArgs(query);
    const orderBy = parseSort(query.sort, SORTABLE, {
      field: 'createdAt',
      direction: 'desc',
    });
    const where: Prisma.ApprovalWorkflowWhereInput = {
      ...(query.documentType ? { resourceType: query.documentType } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.approvalWorkflow.findMany({
        where,
        orderBy,
        skip,
        take,
        select: WORKFLOW_LIST_SELECT,
      }),
      this.prisma.approvalWorkflow.count({ where }),
    ]);
    return paginated(rows.map(toWorkflowView), page, pageSize, total);
  }

  async getById(id: string): Promise<WorkflowDetailView> {
    const row = await this.prisma.approvalWorkflow.findUnique({
      where: { id },
      select: WORKFLOW_DETAIL_SELECT,
    });
    if (!row) {
      throw AppException.notFound('Approval workflow not found.');
    }
    return toWorkflowDetailView(row);
  }

  async create(
    user: AuthUser,
    dto: CreateApprovalWorkflowDto,
    ctx: AuditContext,
  ): Promise<WorkflowDetailView> {
    const code = dto.code.toUpperCase();
    const existing = await this.prisma.approvalWorkflow.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing) {
      throw AppException.duplicateCode(
        `An approval workflow with code ${code} already exists.`,
      );
    }
    await this.requireBranch(dto.branchId ?? null);
    this.assertThresholds(dto);
    const steps = await this.normalizeSteps(dto.steps);

    const created = await this.prisma.approvalWorkflow.create({
      data: {
        code,
        name: dto.name,
        description: dto.description ?? null,
        resourceType: dto.documentType,
        documentSubtypes: dto.documentSubtypes ?? [],
        branchId: dto.branchId ?? null,
        minAmount: this.decimal(dto.minAmount),
        maxAmount: this.decimal(dto.maxAmount),
        minQuantity: this.decimal(dto.minQuantity),
        maxQuantity: this.decimal(dto.maxQuantity),
        steps: { create: steps },
      },
      select: { id: true },
    });
    await this.audit.log({
      action: 'approval_workflow.created',
      resourceType: 'approval_workflow',
      resourceId: created.id,
      branchId: dto.branchId ?? undefined,
      newValues: {
        code,
        documentType: dto.documentType,
        steps: steps.map((step) => ({
          sequence: step.sequence,
          approverType: step.approverType,
        })),
      },
      ...ctx,
    });
    void user;
    return this.getById(created.id);
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateApprovalWorkflowDto,
    ctx: AuditContext,
  ): Promise<WorkflowDetailView> {
    const existing = await this.prisma.approvalWorkflow.findUnique({
      where: { id },
      select: { id: true, code: true, branchId: true },
    });
    if (!existing) {
      throw AppException.notFound('Approval workflow not found.');
    }
    if (dto.branchId !== undefined && dto.branchId !== null) {
      await this.requireBranch(dto.branchId);
    }
    this.assertThresholds(dto);

    let steps: NormalizedStep[] | null = null;
    if (dto.steps) {
      // Replacing steps under a live request would orphan its resolved
      // assignments (approval_request_steps FK) — refuse while pending.
      const pending = await this.prisma.approvalRequest.count({
        where: { workflowId: id, status: ApprovalStatus.PENDING },
      });
      if (pending > 0) {
        throw AppException.inUse(
          `Cannot replace steps: ${pending} approval request(s) are pending on this workflow. Decide or cancel them first.`,
        );
      }
      steps = await this.normalizeSteps(dto.steps);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.approvalWorkflow.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined
            ? { description: dto.description }
            : {}),
          ...(dto.documentSubtypes !== undefined
            ? { documentSubtypes: dto.documentSubtypes }
            : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.minAmount !== undefined
            ? { minAmount: this.decimal(dto.minAmount) }
            : {}),
          ...(dto.maxAmount !== undefined
            ? { maxAmount: this.decimal(dto.maxAmount) }
            : {}),
          ...(dto.minQuantity !== undefined
            ? { minQuantity: this.decimal(dto.minQuantity) }
            : {}),
          ...(dto.maxQuantity !== undefined
            ? { maxQuantity: this.decimal(dto.maxQuantity) }
            : {}),
        },
      });
      if (steps) {
        await tx.approvalStep.deleteMany({ where: { workflowId: id } });
        for (const step of steps) {
          await tx.approvalStep.create({ data: { workflowId: id, ...step } });
        }
      }
    });

    await this.audit.log({
      action: 'approval_workflow.updated',
      resourceType: 'approval_workflow',
      resourceId: id,
      branchId: existing.branchId ?? undefined,
      newValues: { ...dto, stepsReplaced: Boolean(steps) },
      ...ctx,
    });
    void user;
    return this.getById(id);
  }

  async setActive(
    user: AuthUser,
    id: string,
    isActive: boolean,
    ctx: AuditContext,
  ): Promise<WorkflowDetailView> {
    const existing = await this.prisma.approvalWorkflow.findUnique({
      where: { id },
      select: { id: true, isActive: true, branchId: true, code: true },
    });
    if (!existing) {
      throw AppException.notFound('Approval workflow not found.');
    }
    await this.prisma.approvalWorkflow.update({
      where: { id },
      data: { isActive },
    });
    await this.audit.log({
      action: isActive
        ? 'approval_workflow.activated'
        : 'approval_workflow.deactivated',
      resourceType: 'approval_workflow',
      resourceId: id,
      branchId: existing.branchId ?? undefined,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive },
      ...ctx,
    });
    void user;
    return this.getById(id);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private decimal(value: string | null | undefined): Prisma.Decimal | null {
    return value === undefined || value === null
      ? null
      : new Prisma.Decimal(value);
  }

  private assertThresholds(dto: {
    minAmount?: string | null;
    maxAmount?: string | null;
    minQuantity?: string | null;
    maxQuantity?: string | null;
  }): void {
    const errors: ApiErrorDetail[] = [];
    if (
      dto.minAmount != null &&
      dto.maxAmount != null &&
      new Prisma.Decimal(dto.minAmount).gt(new Prisma.Decimal(dto.maxAmount))
    ) {
      errors.push({
        field: 'maxAmount',
        message: 'maxAmount must be greater than or equal to minAmount.',
      });
    }
    if (
      dto.minQuantity != null &&
      dto.maxQuantity != null &&
      new Prisma.Decimal(dto.minQuantity).gt(
        new Prisma.Decimal(dto.maxQuantity),
      )
    ) {
      errors.push({
        field: 'maxQuantity',
        message: 'maxQuantity must be greater than or equal to minQuantity.',
      });
    }
    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
  }

  private async requireBranch(branchId: string | null): Promise<void> {
    if (!branchId) {
      return;
    }
    const branch = await this.prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true },
    });
    if (!branch) {
      throw AppException.validation([
        { field: 'branchId', message: 'Branch does not exist.' },
      ]);
    }
  }

  /**
   * Normalize + validate steps: contiguous sequences, exactly the approver
   * reference the type requires, and referenced role/position/user existing.
   */
  private async normalizeSteps(
    dtos: ApprovalStepDto[],
  ): Promise<NormalizedStep[]> {
    const errors: ApiErrorDetail[] = [];
    const steps: NormalizedStep[] = dtos.map((step, index) => {
      const field = (name: string) => `steps[${index}].${name}`;
      const refs = {
        [ApprovalApproverType.ROLE]: step.approverRoleId,
        [ApprovalApproverType.POSITION]: step.approverPositionId,
        [ApprovalApproverType.USER]: step.approverUserId,
        [ApprovalApproverType.DEPT_HEAD]: undefined,
      };
      for (const [type, ref] of Object.entries(refs)) {
        const required =
          type === step.approverType && type !== ApprovalApproverType.DEPT_HEAD;
        if (required && !ref) {
          errors.push({
            field: field(
              type === ApprovalApproverType.ROLE
                ? 'approverRoleId'
                : type === ApprovalApproverType.POSITION
                  ? 'approverPositionId'
                  : 'approverUserId',
            ),
            message: `approverType ${type} requires this reference.`,
          });
        }
        if (!required && type !== step.approverType && ref) {
          errors.push({
            field: field('approverType'),
            message: `Only the reference matching approverType ${step.approverType} may be set.`,
          });
        }
      }
      return {
        sequence: step.sequence ?? index + 1,
        name: step.name ?? null,
        approverType: step.approverType,
        approverRoleId:
          step.approverType === ApprovalApproverType.ROLE
            ? (step.approverRoleId ?? null)
            : null,
        approverPositionId:
          step.approverType === ApprovalApproverType.POSITION
            ? (step.approverPositionId ?? null)
            : null,
        approverUserId:
          step.approverType === ApprovalApproverType.USER
            ? (step.approverUserId ?? null)
            : null,
      };
    });

    const sequences = new Set(steps.map((step) => step.sequence));
    if (sequences.size !== steps.length) {
      errors.push({
        field: 'steps',
        message: 'Step sequences must be unique.',
      });
    }
    if (errors.length > 0) {
      throw AppException.validation(errors);
    }
    steps.sort((a, b) => a.sequence - b.sequence);
    steps.forEach((step, index) => {
      step.sequence = index + 1;
    });

    const roleIds = steps
      .map((step) => step.approverRoleId)
      .filter((id): id is string => id !== null);
    const positionIds = steps
      .map((step) => step.approverPositionId)
      .filter((id): id is string => id !== null);
    const userIds = steps
      .map((step) => step.approverUserId)
      .filter((id): id is string => id !== null);
    const [roles, positions, users] = await Promise.all([
      roleIds.length
        ? this.prisma.role.findMany({
            where: { id: { in: roleIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
      positionIds.length
        ? this.prisma.position.findMany({
            where: { id: { in: positionIds } },
            select: { id: true },
          })
        : Promise.resolve([]),
      userIds.length
        ? this.prisma.user.findMany({
            where: { id: { in: userIds }, isActive: true, archivedAt: null },
            select: { id: true },
          })
        : Promise.resolve([]),
    ]);
    const missing: ApiErrorDetail[] = [];
    const roleSet = new Set(roles.map((role) => role.id));
    const positionSet = new Set(positions.map((position) => position.id));
    const userSet = new Set(users.map((found) => found.id));
    steps.forEach((step, index) => {
      if (step.approverRoleId && !roleSet.has(step.approverRoleId)) {
        missing.push({
          field: `steps[${index}].approverRoleId`,
          message: 'Role does not exist.',
        });
      }
      if (step.approverPositionId && !positionSet.has(step.approverPositionId)) {
        missing.push({
          field: `steps[${index}].approverPositionId`,
          message: 'Position does not exist.',
        });
      }
      if (step.approverUserId && !userSet.has(step.approverUserId)) {
        missing.push({
          field: `steps[${index}].approverUserId`,
          message: 'User does not exist or is inactive.',
        });
      }
    });
    if (missing.length > 0) {
      throw AppException.validation(missing);
    }
    return steps;
  }
}
