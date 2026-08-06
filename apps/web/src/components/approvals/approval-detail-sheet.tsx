'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Ban,
  Check,
  CircleAlert,
  CornerUpLeft,
  MessageSquareText,
  ShieldAlert,
  X,
} from 'lucide-react';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  approveApprovalRequest,
  getApprovalRequest,
  listApprovalDelegations,
  rejectApprovalRequest,
  returnApprovalRequest,
  unwrapList,
} from '@/lib/endpoints';
import {
  approvalActionAt,
  approvalActions,
  approvalDocumentId,
  approvalDocumentLabel,
  approvalDocumentType,
  approvalRequestSteps,
  approvalStepApproverLabel,
  delegationIsCurrent,
  formatMoney,
  formatQuantity,
  refLabel,
  workflowSteps,
  type ApprovalStep,
  type UserRef,
} from '@/lib/types';
import {
  APPROVAL_ACT_PERMISSIONS,
  approvalDocumentTypeLabel,
} from '@/lib/status-maps';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { approvalStatusBadge } from '@/components/approvals/badges';
import { resourceHref } from '@/components/approvals/document-links';

/* ------------------------ Approve (optional comment) ----------------------- */

function ApproveDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (comment?: string) => Promise<unknown>;
}) {
  const [comment, setComment] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fieldId = React.useId();

  React.useEffect(() => {
    if (!open) {
      setComment('');
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleConfirm = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(comment.trim() || undefined);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Approve this request?</DialogTitle>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void handleConfirm();
        }}
      >
        <DialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Approving advances the request to the next step, or finalizes it when this is the last
            step.
          </p>
          <FormField label="Comment" htmlFor={fieldId} hint="Optional.">
            <Textarea
              id={fieldId}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              data-autofocus
            />
          </FormField>
          <FormError message={error} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            <Check aria-hidden /> Approve
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* -------------------------------- The sheet -------------------------------- */

const ACTION_LABELS: Record<string, string> = {
  APPROVE: 'Approved',
  REJECT: 'Rejected',
  RETURN: 'Returned for revision',
  CANCEL: 'Canceled',
  COMMENT: 'Commented',
};

export function ApprovalDetailSheet({
  requestId,
  open,
  onOpenChange,
}: {
  requestId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, canAny } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [selfApprovalBlocked, setSelfApprovalBlocked] = React.useState(false);

  React.useEffect(() => {
    setSelfApprovalBlocked(false);
  }, [requestId]);

  const requestQuery = useQuery({
    queryKey: ['approval-requests', requestId],
    queryFn: ({ signal }) => getApprovalRequest(requestId!, signal),
    enabled: open && !!requestId,
  });

  // Own delegations (given + received) — a delegate of a current assignee may
  // act inside the window, so they get the action buttons too.
  const delegationsQuery = useQuery({
    queryKey: ['approval-delegations', 'list'],
    queryFn: ({ signal }) => listApprovalDelegations({ page: 1, pageSize: 100 }, signal),
    enabled: open,
    retry: false,
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['approval-requests'] });
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }, [queryClient]);

  /** Maps SELF_APPROVAL_FORBIDDEN to the friendly banner; rethrows the rest. */
  const guardSelfApproval = (err: unknown): never => {
    if (isApiClientError(err) && err.code === 'SELF_APPROVAL_FORBIDDEN') {
      setSelfApprovalBlocked(true);
      throw new Error('You cannot approve your own request.');
    }
    throw err;
  };

  const approveMutation = useMutation({
    mutationFn: (comment?: string) => approveApprovalRequest(requestId!, comment),
    onSuccess: () => {
      toast({ title: 'Request approved', variant: 'success' });
      invalidate();
    },
  });

  const request = requestQuery.data;
  const documentType = request ? approvalDocumentType(request) : '';
  const documentId = request ? approvalDocumentId(request) : null;
  const documentLink = request ? resourceHref(documentType, documentId) : null;
  const actions = request ? approvalActions(request) : [];

  /** Unified step-progress rows — per-request snapshots win over the template. */
  interface StepRow {
    key: string;
    label: string;
    approver: string;
    status: 'done' | 'current' | 'upcoming' | 'terminal';
    resolvedNote: string | null;
  }
  const requestSteps = request ? approvalRequestSteps(request) : [];
  const templateSteps = request?.workflow ? workflowSteps(request.workflow) : [];
  const APPROVER_TYPE_LABELS: Record<string, string> = {
    ROLE: 'By role',
    POSITION: 'By position',
    DEPT_HEAD: "Requester's department head",
    USER: 'Named approver',
  };
  const approverText = (row: {
    step?: ApprovalStep | null;
    approverType?: string;
    assignees?: UserRef[];
  }): string => {
    const parts: string[] = [];
    const approverType = row.approverType ?? row.step?.approverType;
    if (approverType) parts.push(APPROVER_TYPE_LABELS[approverType] ?? humanize(approverType));
    if (row.assignees && row.assignees.length > 0) {
      parts.push(row.assignees.map((entry) => entry.displayName ?? entry.email ?? entry.id).join(', '));
    } else if (row.step && !row.approverType) {
      return approvalStepApproverLabel(row.step);
    }
    return parts.length > 0 ? parts.join(': ') : 'Assigned approver';
  };
  const stepRows: StepRow[] =
    requestSteps.length > 0
      ? requestSteps.map((row, index) => {
          const sequence = row.sequence ?? index + 1;
          // The detail view carries no step ids — the current step matches by
          // sequence (fallback: id when a richer payload provides one).
          const isCurrent =
            request!.status === 'PENDING' &&
            (request!.currentStep?.sequence !== undefined
              ? request!.currentStep.sequence === sequence
              : row.stepId === request!.currentStepId || row.step?.id === request!.currentStepId);
          const status: StepRow['status'] =
            row.status === 'APPROVED'
              ? 'done'
              : row.status && row.status !== 'PENDING'
                ? 'terminal'
                : isCurrent
                  ? 'current'
                  : 'upcoming';
          return {
            key: row.id ?? `seq-${sequence}`,
            label: row.name || row.step?.name || `Step ${sequence}`,
            approver: approverText(row),
            status,
            resolvedNote:
              row.actedBy || row.actedAt
                ? `${row.status === 'APPROVED' ? 'Approved' : humanize(row.status ?? 'Acted')} by ${
                    row.actedBy?.displayName ?? 'unknown'
                  } · ${formatDateTime(row.actedAt)}`
                : null,
          };
        })
      : templateSteps.map((step, index) => {
          const isCurrent =
            request!.status === 'PENDING' &&
            (step.id === request!.currentStepId || step.id === request!.currentStep?.id);
          const resolvedAction = actions.find(
            (action) =>
              action.action === 'APPROVE' &&
              (action.stepId === step.id || action.step?.id === step.id),
          );
          return {
            key: step.id ?? String(index),
            label: step.name || `Step ${step.sequence ?? index + 1}`,
            approver: approvalStepApproverLabel(step),
            status: resolvedAction ? 'done' : isCurrent ? 'current' : 'upcoming',
            resolvedNote: resolvedAction
              ? `Approved by ${resolvedAction.actor?.displayName ?? 'unknown'}${
                  resolvedAction.delegatedFor
                    ? ` (for ${resolvedAction.delegatedFor.displayName ?? 'delegator'})`
                    : ''
                } · ${formatDateTime(approvalActionAt(resolvedAction))}`
              : null,
          };
        });
  const isRequester = !!request && (request.requestedById === user.id || request.requestedBy?.id === user.id);

  // Acting requires being the CURRENT step's resolved assignee or an
  // in-window delegate — permissions alone are never enough (spec §19). The
  // server re-checks; this only drives button visibility.
  const currentSequence = request?.currentStep?.sequence;
  const currentStepRow =
    requestSteps.find((row) =>
      currentSequence !== undefined
        ? row.sequence === currentSequence
        : row.status === 'PENDING',
    ) ?? null;
  const currentAssigneeIds = [
    ...(currentStepRow?.assignees?.map((entry) => entry.id) ?? []),
    ...(currentStepRow?.assigneeUserIds ?? []),
  ];
  const isCurrentAssignee = currentAssigneeIds.includes(user.id);
  const receivedDelegations = delegationsQuery.data ? unwrapList(delegationsQuery.data) : [];
  const isActiveDelegateOfAssignee = receivedDelegations.some(
    (delegation) =>
      (delegation.delegateId ?? delegation.delegateUserId ?? delegation.delegate?.id) === user.id &&
      delegationIsCurrent(delegation) &&
      currentAssigneeIds.includes(delegation.delegatorId ?? delegation.delegator?.id ?? ''),
  );
  const showActions =
    !!request &&
    request.status === 'PENDING' &&
    !isRequester &&
    (isCurrentAssignee ||
      isActiveDelegateOfAssignee ||
      // Assignee data missing from the payload — fall back to the permission hint.
      (currentAssigneeIds.length === 0 && canAny(APPROVAL_ACT_PERMISSIONS)));

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={request ? `${approvalDocumentTypeLabel(documentType)} — ${approvalDocumentLabel(request)}` : 'Approval request'}
      description={request ? `Requested by ${request.requestedBy?.displayName ?? 'unknown'} · ${formatDateTime(request.requestedAt ?? request.createdAt)}` : undefined}
    >
      {requestQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : requestQuery.isError ? (
        <ErrorState error={requestQuery.error} onRetry={() => requestQuery.refetch()} />
      ) : request ? (
        <div className="space-y-5">
          {/* Status + self-approval banner */}
          <div className="flex flex-wrap items-center gap-2">
            {approvalStatusBadge(request.status)}
            {isRequester ? <span className="text-xs text-muted-foreground">You raised this request.</span> : null}
          </div>

          {selfApprovalBlocked ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm text-warning"
            >
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                A requester can never approve their own transaction. Another assigned approver (or
                an active delegate) has to act on this request.
              </span>
            </div>
          ) : null}

          {/* Document summary */}
          <section className="rounded-md border">
            <h3 className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Document
            </h3>
            <dl className="divide-y px-3 text-sm">
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Type</dt>
                <dd>{approvalDocumentTypeLabel(documentType)}</dd>
              </div>
              <div className="flex justify-between gap-3 py-2">
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="font-mono text-xs">{approvalDocumentLabel(request)}</dd>
              </div>
              {request.amount !== undefined && request.amount !== null ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-muted-foreground">Amount</dt>
                  <dd className="font-mono text-xs tabular-nums">{formatMoney(request.amount)}</dd>
                </div>
              ) : null}
              {request.quantity !== undefined && request.quantity !== null ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-muted-foreground">Quantity</dt>
                  <dd className="font-mono text-xs tabular-nums">{formatQuantity(request.quantity)}</dd>
                </div>
              ) : null}
              {request.branch ? (
                <div className="flex justify-between gap-3 py-2">
                  <dt className="text-muted-foreground">Branch</dt>
                  <dd>{refLabel(request.branch)}</dd>
                </div>
              ) : null}
              {request.notes ? (
                <div className="py-2">
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{request.notes}</dd>
                </div>
              ) : null}
            </dl>
            {documentLink ? (
              <div className="border-t p-3">
                <Link
                  href={documentLink}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full')}
                  onClick={() => onOpenChange(false)}
                >
                  <ArrowUpRight aria-hidden /> Open document
                </Link>
              </div>
            ) : null}
          </section>

          {/* Step progress */}
          <section className="rounded-md border">
            <h3 className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Approval steps{request.workflow?.name ? ` — ${request.workflow.name}` : ''}
            </h3>
            {stepRows.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">
                {request.currentStep
                  ? approvalStepApproverLabel(request.currentStep)
                  : 'Single-step approval.'}
              </p>
            ) : (
              <ol className="divide-y">
                {stepRows.map((row, index) => (
                  <li
                    key={row.key}
                    className={cn('flex items-start gap-3 px-3 py-2.5', row.status === 'current' && 'bg-primary/5')}
                    aria-current={row.status === 'current' ? 'step' : undefined}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                        row.status === 'done'
                          ? 'bg-success text-success-foreground'
                          : row.status === 'current'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {row.status === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{row.label}</span>
                      <span className="block text-xs text-muted-foreground">{row.approver}</span>
                      {row.resolvedNote ? (
                        <span
                          className={cn(
                            'block text-xs',
                            row.status === 'done' ? 'text-success' : 'text-muted-foreground',
                          )}
                        >
                          {row.resolvedNote}
                        </span>
                      ) : row.status === 'current' ? (
                        <span className="block text-xs text-primary">Awaiting action</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* History timeline */}
          <section className="rounded-md border">
            <h3 className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              History
            </h3>
            {actions.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">No actions recorded yet.</p>
            ) : (
              <ol className="divide-y">
                {actions.map((action) => (
                  <li key={action.id} className="flex items-start gap-2.5 px-3 py-2.5">
                    {action.action === 'APPROVE' ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
                    ) : action.action === 'REJECT' ? (
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                    ) : action.action === 'RETURN' ? (
                      <CornerUpLeft className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                    ) : action.action === 'CANCEL' ? (
                      <Ban className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : (
                      <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        <span className="font-medium">{action.actor?.displayName ?? 'Unknown'}</span>{' '}
                        <span className="text-muted-foreground">
                          {(ACTION_LABELS[action.action] ?? humanize(action.action)).toLowerCase()}
                        </span>
                        {action.delegatedFor ? (
                          <span className="text-muted-foreground">
                            {' '}
                            as delegate of {action.delegatedFor.displayName ?? 'unknown'}
                          </span>
                        ) : null}
                      </span>
                      {action.comment ? (
                        <span className="mt-0.5 block whitespace-pre-wrap rounded-md bg-muted px-2 py-1 text-xs">
                          {action.comment}
                        </span>
                      ) : null}
                      <time className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                        {formatDateTime(approvalActionAt(action))}
                      </time>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {/* Actions */}
          {showActions ? (
            <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t bg-background px-1 pb-1 pt-3 sm:flex-row">
              <Button className="flex-1" onClick={() => setApproveOpen(true)}>
                <Check aria-hidden /> Approve
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => setReturnOpen(true)}>
                <CornerUpLeft aria-hidden /> Return for revision
              </Button>
              <Button variant="destructive" className="flex-1" onClick={() => setRejectOpen(true)}>
                <X aria-hidden /> Reject
              </Button>
            </div>
          ) : request.status === 'PENDING' && !isRequester ? (
            <p className="flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm text-muted-foreground">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Only the assigned approver (or their active delegate) can act on this request.
            </p>
          ) : null}
        </div>
      ) : null}

      <ApproveDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        onConfirm={async (comment) => {
          try {
            await approveMutation.mutateAsync(comment);
          } catch (err) {
            guardSelfApproval(err);
          }
        }}
      />

      <ReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        title="Reject this request?"
        description="Rejection ends the approval and sends the document back to its requester. A comment is required."
        reasonLabel="Rejection comment"
        confirmLabel="Reject"
        destructive
        onConfirm={async (comment) => {
          try {
            await rejectApprovalRequest(requestId!, comment);
          } catch (err) {
            guardSelfApproval(err);
          }
          toast({ title: 'Request rejected', variant: 'success' });
          invalidate();
        }}
      />

      <ReasonDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        title="Return for revision?"
        description="The document goes back to Draft so the requester can fix it and resubmit."
        reasonLabel="Revision comment"
        confirmLabel="Return for revision"
        onConfirm={async (comment) => {
          try {
            await returnApprovalRequest(requestId!, comment);
          } catch (err) {
            guardSelfApproval(err);
          }
          toast({ title: 'Returned for revision', variant: 'success' });
          invalidate();
        }}
      />
    </Sheet>
  );
}
