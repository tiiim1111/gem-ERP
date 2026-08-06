import { Injectable } from '@nestjs/common';
import {
  NOTIFICATION_LINKS,
  NOTIFICATION_TYPES,
  notificationDedupeKey,
} from '@gemerp/shared';
import {
  ApprovalActionType,
  ApprovalStatus,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ApprovalDocumentsService,
  ApprovalOutcome,
} from './approval-documents.service';
import {
  ApprovalResourceType,
  MatchContext,
  pickWorkflow,
  resolveActingAuthority,
} from './approval-rules';
import { ApproverResolutionService } from './approver-resolution.service';

const WORKFLOW_MATCH_SELECT = {
  id: true,
  code: true,
  name: true,
  branchId: true,
  documentSubtypes: true,
  minAmount: true,
  maxAmount: true,
  minQuantity: true,
  maxQuantity: true,
  createdAt: true,
  steps: {
    orderBy: { sequence: 'asc' as const },
    select: {
      id: true,
      sequence: true,
      name: true,
      approverType: true,
      approverRoleId: true,
      approverPositionId: true,
      approverUserId: true,
    },
  },
} satisfies Prisma.ApprovalWorkflowSelect;

export type MatchedWorkflow = Prisma.ApprovalWorkflowGetPayload<{
  select: typeof WORKFLOW_MATCH_SELECT;
}>;

export interface RouteSubmitArgs {
  resourceType: ApprovalResourceType;
  resourceId: string;
  /** Human-readable document number for the queue and notifications. */
  resourceNumber: string;
  branchId: string;
  /** Extra branches that satisfy branch-scoped workflows (transfers). */
  extraBranchIds?: readonly string[];
  /** Document sub-type (stock transaction type, transfer type, ...). */
  subtype?: string;
  amount?: Prisma.Decimal | null;
  quantity?: Prisma.Decimal | null;
  requester: AuthUser;
}

export type ApprovalActionKind = 'APPROVE' | 'REJECT' | 'RETURN';

/**
 * THE Phase 6 approval engine (spec §19, api-outline 7.2).
 *
 * Submit side: `routeSubmit` matches the most specific active workflow
 * (branch + sub-type + amount/quantity thresholds), atomically claims the
 * document into Pending Approval (the caller's claim runs inside the SAME
 * database transaction as the request creation) and materializes an
 * approval_request whose steps carry approvers RESOLVED AT REQUEST TIME —
 * ROLE / POSITION / DEPT_HEAD / USER per step (GemCor 2026-07-27).
 *
 * Decision side: `act` authorizes the actor (assignee or delegate inside an
 * active delegation window), refuses self-approval (409
 * SELF_APPROVAL_FORBIDDEN, even via delegation), records the action,
 * advances the step or finalizes, and — on finalization — executes the
 * document's own transition through ApprovalDocumentsService. Every action
 * is audited; approvers and requesters are notified in-app.
 *
 * When no workflow matches, `routeSubmit` returns null and the document
 * keeps its pre-Phase-6 auto-approve behavior (backward compatible).
 */
@Injectable()
export class ApprovalEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolution: ApproverResolutionService,
    private readonly documents: ApprovalDocumentsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Matching + request creation (document submit hooks)
  // -------------------------------------------------------------------------

  async matchWorkflow(
    resourceType: ApprovalResourceType,
    ctx: MatchContext,
  ): Promise<MatchedWorkflow | null> {
    const candidates = await this.prisma.approvalWorkflow.findMany({
      where: {
        resourceType,
        isActive: true,
        steps: { some: {} },
      },
      select: WORKFLOW_MATCH_SELECT,
    });
    return pickWorkflow(candidates, ctx);
  }

  /**
   * Route a submitted document through approval. `claimDocument` is the
   * caller's own status claim (Draft → Pending Approval) and runs inside the
   * engine's database transaction so document flip + request creation are
   * atomic. Returns null (claim NOT executed) when no workflow matches.
   */
  async routeSubmit(
    args: RouteSubmitArgs,
    claimDocument: (tx: Prisma.TransactionClient) => Promise<void>,
    ctx: AuditContext,
  ): Promise<{ workflowId: string; workflowCode: string; requestId: string } | null> {
    const workflow = await this.matchWorkflow(args.resourceType, {
      branchId: args.branchId,
      extraBranchIds: args.extraBranchIds,
      subtype: args.subtype,
      amount: args.amount ?? null,
      quantity: args.quantity ?? null,
    });
    if (!workflow) {
      return null;
    }

    const { requestId, firstAssignees } = await this.prisma.$transaction(
      async (tx) => {
        await claimDocument(tx);
        const assigneesByStep = await this.resolution.resolveAllSteps(
          tx,
          workflow.steps,
          { requesterId: args.requester.id, branchId: args.branchId },
        );
        const firstStep = workflow.steps[0];
        const request = await tx.approvalRequest.create({
          data: {
            workflowId: workflow.id,
            resourceType: args.resourceType,
            resourceId: args.resourceId,
            resourceNumber: args.resourceNumber,
            status: ApprovalStatus.PENDING,
            currentStepId: firstStep.id,
            amount: args.amount ?? null,
            quantity: args.quantity ?? null,
            branchId: args.branchId,
            requestedById: args.requester.id,
          },
          select: { id: true },
        });
        for (const step of workflow.steps) {
          await tx.approvalRequestStep.create({
            data: {
              requestId: request.id,
              stepId: step.id,
              sequence: step.sequence,
              status: ApprovalStatus.PENDING,
              assigneeUserIds: assigneesByStep.get(step.id) ?? [],
            },
          });
        }
        return {
          requestId: request.id,
          firstAssignees: assigneesByStep.get(firstStep.id) ?? [],
        };
      },
    );

    await this.audit.log({
      action: 'approval_request.created',
      resourceType: 'approval_request',
      resourceId: requestId,
      branchId: args.branchId,
      newValues: {
        workflowCode: workflow.code,
        documentType: args.resourceType,
        documentId: args.resourceId,
        documentNumber: args.resourceNumber,
        steps: workflow.steps.length,
      },
      ...ctx,
    });
    await this.notifyPending(requestId, 1, firstAssignees, args);
    return { workflowId: workflow.id, workflowCode: workflow.code, requestId };
  }

  private async notifyPending(
    requestId: string,
    stepSequence: number,
    assignees: readonly string[],
    doc: {
      resourceType: string;
      resourceNumber: string;
      branchId: string;
    },
  ): Promise<void> {
    await this.notifications.notifyMany(assignees, {
      type: NOTIFICATION_TYPES.approvalPending,
      title: 'Approval requested',
      message: `${doc.resourceType.replaceAll('_', ' ').toLowerCase()} ${doc.resourceNumber} is waiting for your approval (step ${stepSequence}).`,
      resourceType: 'approval_request',
      resourceId: requestId,
      branchId: doc.branchId,
      dedupeKey: notificationDedupeKey(
        NOTIFICATION_TYPES.approvalPending,
        'approval_request',
        requestId,
        `step-${stepSequence}`,
      ),
      link: NOTIFICATION_LINKS.approvalRequest(requestId),
    });
  }

  // -------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------

  /**
   * Legacy-endpoint bridge: when the document has a PENDING request, the
   * document's own approve/reject endpoint delegates here. Returns false
   * when no request exists (caller keeps its pre-Phase-6 behavior).
   */
  async actOnResource(
    user: AuthUser,
    resourceType: ApprovalResourceType,
    resourceId: string,
    action: ApprovalActionKind,
    comment: string | undefined,
    ctx: AuditContext,
  ): Promise<boolean> {
    const request = await this.prisma.approvalRequest.findFirst({
      where: { resourceType, resourceId, status: ApprovalStatus.PENDING },
      select: { id: true },
    });
    if (!request) {
      return false;
    }
    await this.act(user, request.id, action, comment, ctx);
    return true;
  }

  /** Approve / reject / return the request's current step as `user`. */
  async act(
    user: AuthUser,
    requestId: string,
    action: ApprovalActionKind,
    comment: string | undefined,
    ctx: AuditContext,
  ): Promise<void> {
    if ((action === 'REJECT' || action === 'RETURN') && !comment?.trim()) {
      throw AppException.validation([
        {
          field: 'comment',
          message: `A comment is required to ${action.toLowerCase()} (spec §19).`,
        },
      ]);
    }

    const request = await this.prisma.approvalRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        resourceType: true,
        resourceId: true,
        resourceNumber: true,
        branchId: true,
        requestedById: true,
        currentStepId: true,
        steps: {
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            stepId: true,
            sequence: true,
            status: true,
            assigneeUserIds: true,
          },
        },
      },
    });
    if (!request) {
      throw AppException.notFound('Approval request not found.');
    }
    if (request.status !== ApprovalStatus.PENDING || !request.currentStepId) {
      throw AppException.invalidStateTransition(
        `This approval request is already ${request.status.toLowerCase()}.`,
      );
    }
    const currentStep = request.steps.find(
      (step) => step.stepId === request.currentStepId,
    );
    if (!currentStep) {
      throw AppException.invalidStateTransition(
        'The approval request has no pending step.',
      );
    }

    // Self-approval is refused outright — before authority resolution, so a
    // requester cannot sneak through even as somebody's delegate (spec §19).
    if (request.requestedById === user.id) {
      throw new AppException(
        409,
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot approve, reject, or return your own request.',
      );
    }

    const now = new Date();
    const delegations = await this.prisma.approvalDelegation.findMany({
      where: {
        delegateId: user.id,
        isActive: true,
        startsAt: { lte: now },
        endsAt: { gte: now },
        delegatorId: { in: currentStep.assigneeUserIds },
      },
      select: {
        delegatorId: true,
        delegateId: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
      },
    });
    const authority = resolveActingAuthority(
      currentStep.assigneeUserIds,
      user.id,
      delegations,
      now,
    );
    if (!authority.authorized) {
      throw AppException.forbidden(
        'This approval step is not assigned to you (and no active delegation covers it).',
      );
    }
    // A delegation can never launder self-approval: acting for a delegator
    // who IS the requester is still the requester's own document.
    if (authority.delegatedForId === request.requestedById) {
      throw new AppException(
        409,
        'SELF_APPROVAL_FORBIDDEN',
        'You cannot approve, reject, or return your own request.',
      );
    }

    const nextRequestStep =
      action === 'APPROVE'
        ? (request.steps.find(
            (step) => step.sequence > currentStep.sequence,
          ) ?? null)
        : null;
    const finalizes = action !== 'APPROVE' || nextRequestStep === null;
    const outcome: ApprovalOutcome = action;
    const requestStatus: ApprovalStatus =
      action === 'APPROVE'
        ? finalizes
          ? ApprovalStatus.APPROVED
          : ApprovalStatus.PENDING
        : action === 'REJECT'
          ? ApprovalStatus.REJECTED
          : ApprovalStatus.RETURNED;
    const actionType: ApprovalActionType =
      action === 'APPROVE'
        ? ApprovalActionType.APPROVE
        : action === 'REJECT'
          ? ApprovalActionType.REJECT
          : ApprovalActionType.RETURN;

    let applyingDocumentOutcome = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        // Claim the request state transition atomically.
        const claimed = await tx.approvalRequest.updateMany({
          where: {
            id: request.id,
            status: ApprovalStatus.PENDING,
            currentStepId: request.currentStepId,
          },
          data: {
            status: requestStatus,
            currentStepId: finalizes
              ? null
              : (nextRequestStep?.stepId ?? null),
            ...(finalizes ? { completedAt: now } : {}),
          },
        });
        if (claimed.count === 0) {
          throw AppException.invalidStateTransition(
            'The approval request was actioned concurrently. Refetch and retry.',
          );
        }
        await tx.approvalRequestStep.update({
          where: { id: currentStep.id },
          data: {
            status:
              action === 'APPROVE'
                ? ApprovalStatus.APPROVED
                : action === 'REJECT'
                  ? ApprovalStatus.REJECTED
                  : ApprovalStatus.RETURNED,
            actedById: user.id,
            actedAt: now,
            comment: comment ?? null,
          },
        });
        if (finalizes && action !== 'APPROVE') {
          // Later steps never activate on reject/return.
          await tx.approvalRequestStep.updateMany({
            where: {
              requestId: request.id,
              sequence: { gt: currentStep.sequence },
              status: ApprovalStatus.PENDING,
            },
            data: { status: ApprovalStatus.CANCELED },
          });
        }
        await tx.approvalAction.create({
          data: {
            requestId: request.id,
            stepId: currentStep.stepId,
            actorId: user.id,
            action: actionType,
            comment: comment ?? null,
            delegatedForId: authority.delegatedForId,
            actedAt: now,
          },
        });
        if (finalizes) {
          applyingDocumentOutcome = true;
          await this.documents.applyOutcome(
            tx,
            request.resourceType as ApprovalResourceType,
            request.resourceId,
            outcome,
            user.id,
            comment,
          );
          applyingDocumentOutcome = false;
        }
      });
    } catch (error) {
      // The document left Pending Approval behind the request's back (e.g.
      // withdrawn/canceled). Close the zombie request so the queue heals,
      // then surface the conflict.
      if (
        applyingDocumentOutcome &&
        error instanceof AppException &&
        error.getStatus() === 409
      ) {
        await this.prisma.approvalRequest.updateMany({
          where: { id: request.id, status: ApprovalStatus.PENDING },
          data: { status: ApprovalStatus.CANCELED, completedAt: new Date() },
        });
        await this.audit.log({
          action: 'approval_request.canceled_document_conflict',
          resourceType: 'approval_request',
          resourceId: request.id,
          branchId: request.branchId ?? undefined,
          reason:
            'Document was no longer pending approval when the decision finalized.',
          ...ctx,
        });
      }
      throw error;
    }

    await this.audit.log({
      action:
        action === 'APPROVE'
          ? finalizes
            ? 'approval_request.approved'
            : 'approval_request.step_approved'
          : action === 'REJECT'
            ? 'approval_request.rejected'
            : 'approval_request.returned',
      resourceType: 'approval_request',
      resourceId: request.id,
      branchId: request.branchId ?? undefined,
      oldValues: { status: ApprovalStatus.PENDING, step: currentStep.sequence },
      newValues: {
        status: requestStatus,
        documentType: request.resourceType,
        documentId: request.resourceId,
        documentNumber: request.resourceNumber,
        ...(authority.delegatedForId
          ? { delegatedFor: authority.delegatedForId }
          : {}),
      },
      reason: comment,
      ...ctx,
    });

    const docInfo = {
      resourceType: request.resourceType,
      resourceNumber: request.resourceNumber ?? request.resourceId,
      branchId: request.branchId ?? '',
    };
    if (!finalizes && nextRequestStep) {
      await this.notifyPending(
        request.id,
        nextRequestStep.sequence,
        nextRequestStep.assigneeUserIds,
        docInfo,
      );
      return;
    }

    const requesterNotice =
      action === 'APPROVE'
        ? {
            type: NOTIFICATION_TYPES.approvalApproved,
            title: 'Request approved',
            message: `Your ${docInfo.resourceType.replaceAll('_', ' ').toLowerCase()} ${docInfo.resourceNumber} was approved.`,
          }
        : action === 'REJECT'
          ? {
              type: NOTIFICATION_TYPES.approvalRejected,
              title: 'Request rejected',
              message: `Your ${docInfo.resourceType.replaceAll('_', ' ').toLowerCase()} ${docInfo.resourceNumber} was rejected: ${comment}`,
            }
          : {
              type: NOTIFICATION_TYPES.approvalReturned,
              title: 'Request returned for revision',
              message: `Your ${docInfo.resourceType.replaceAll('_', ' ').toLowerCase()} ${docInfo.resourceNumber} was returned for revision: ${comment}`,
            };
    await this.notifications.notify({
      recipientId: request.requestedById,
      ...requesterNotice,
      resourceType: 'approval_request',
      resourceId: request.id,
      branchId: request.branchId ?? undefined,
      dedupeKey: notificationDedupeKey(
        requesterNotice.type,
        'approval_request',
        request.id,
      ),
      link: NOTIFICATION_LINKS.approvalRequest(request.id),
    });
  }
}
