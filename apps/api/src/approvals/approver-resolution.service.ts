import { Injectable } from '@nestjs/common';
import { ApprovalApproverType, EmployeeStatus, Prisma } from '@prisma/client';
import { AppException } from '../common/errors/app.exception';

/** The step fields resolution needs. */
export interface ResolvableStep {
  id: string;
  sequence: number;
  name: string | null;
  approverType: ApprovalApproverType;
  approverRoleId: string | null;
  approverPositionId: string | null;
  approverUserId: string | null;
}

/**
 * Parameterized approver resolution — THE core GemCor requirement
 * (confirmed 2026-07-27). Each approval_steps row resolves to concrete user
 * ids AT REQUEST TIME by exactly one of:
 *
 * - ROLE:      every active user holding the role, branch-scoped (explicit
 *              branch access to the document's branch; super admins qualify
 *              without explicit access).
 * - POSITION:  every active user whose ACTIVE employee record holds the
 *              position (branch-scoped through the employee's branch).
 * - DEPT_HEAD: the REQUESTER's department head via
 *              departments.head_employee_id → employees.user_id.
 * - USER:      the specific named person (must still be active).
 *
 * A step that resolves to nobody blocks submission with a VALIDATION_ERROR —
 * routing a document into a dead end would strand it in Pending forever.
 */
@Injectable()
export class ApproverResolutionService {
  async resolveStepAssignees(
    tx: Prisma.TransactionClient,
    step: ResolvableStep,
    ctx: { requesterId: string; branchId: string | null },
  ): Promise<string[]> {
    switch (step.approverType) {
      case ApprovalApproverType.ROLE:
        return this.resolveRole(tx, step, ctx.branchId);
      case ApprovalApproverType.POSITION:
        return this.resolvePosition(tx, step, ctx.branchId);
      case ApprovalApproverType.DEPT_HEAD:
        return this.resolveDeptHead(tx, ctx.requesterId);
      case ApprovalApproverType.USER:
        return this.resolveUser(tx, step);
    }
  }

  /** Resolve every step or fail the submit with per-step details. */
  async resolveAllSteps(
    tx: Prisma.TransactionClient,
    steps: readonly ResolvableStep[],
    ctx: { requesterId: string; branchId: string | null },
  ): Promise<Map<string, string[]>> {
    const bySequence = [...steps].sort((a, b) => a.sequence - b.sequence);
    const resolved = new Map<string, string[]>();
    const empty: { sequence: number; type: string }[] = [];
    for (const step of bySequence) {
      const assignees = await this.resolveStepAssignees(tx, step, ctx);
      if (assignees.length === 0) {
        empty.push({ sequence: step.sequence, type: step.approverType });
      }
      resolved.set(step.id, assignees);
    }
    if (empty.length > 0) {
      throw AppException.validation(
        empty.map((step) => ({
          field: `steps[${step.sequence}]`,
          message: `Approval step ${step.sequence} (${step.type}) resolves to no active approver — fix the workflow, the requester's employee/department links, or the approver's account before submitting.`,
        })),
        'The approval workflow cannot route this document.',
      );
    }
    return resolved;
  }

  private async resolveRole(
    tx: Prisma.TransactionClient,
    step: ResolvableStep,
    branchId: string | null,
  ): Promise<string[]> {
    if (!step.approverRoleId) {
      return [];
    }
    const users = await tx.user.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        userRoles: { some: { roleId: step.approverRoleId } },
        ...(branchId
          ? { branchAccess: { some: { branchId } } }
          : {}),
      },
      select: { id: true },
    });
    // Super admins hold roles without needing explicit branch access rows.
    const superAdmins = branchId
      ? await tx.user.findMany({
          where: {
            isActive: true,
            archivedAt: null,
            userRoles: {
              some: {
                roleId: step.approverRoleId,
                role: { code: 'SUPER_ADMIN' },
              },
            },
          },
          select: { id: true },
        })
      : [];
    return [...new Set([...users, ...superAdmins].map((user) => user.id))];
  }

  private async resolvePosition(
    tx: Prisma.TransactionClient,
    step: ResolvableStep,
    branchId: string | null,
  ): Promise<string[]> {
    if (!step.approverPositionId) {
      return [];
    }
    const employees = await tx.employee.findMany({
      where: {
        positionId: step.approverPositionId,
        status: EmployeeStatus.ACTIVE,
        archivedAt: null,
        userId: { not: null },
        ...(branchId ? { branchId } : {}),
        user: { is: { isActive: true, archivedAt: null } },
      },
      select: { userId: true },
    });
    return [
      ...new Set(
        employees
          .map((employee) => employee.userId)
          .filter((id): id is string => id !== null),
      ),
    ];
  }

  private async resolveDeptHead(
    tx: Prisma.TransactionClient,
    requesterId: string,
  ): Promise<string[]> {
    const requesterEmployee = await tx.employee.findUnique({
      where: { userId: requesterId },
      select: {
        department: {
          select: {
            headEmployee: {
              select: {
                userId: true,
                status: true,
                archivedAt: true,
                user: { select: { isActive: true, archivedAt: true } },
              },
            },
          },
        },
      },
    });
    const head = requesterEmployee?.department?.headEmployee;
    if (
      !head ||
      !head.userId ||
      head.status !== EmployeeStatus.ACTIVE ||
      head.archivedAt !== null ||
      !head.user?.isActive ||
      head.user.archivedAt !== null
    ) {
      return [];
    }
    return [head.userId];
  }

  private async resolveUser(
    tx: Prisma.TransactionClient,
    step: ResolvableStep,
  ): Promise<string[]> {
    if (!step.approverUserId) {
      return [];
    }
    const user = await tx.user.findFirst({
      where: { id: step.approverUserId, isActive: true, archivedAt: null },
      select: { id: true },
    });
    return user ? [user.id] : [];
  }
}
