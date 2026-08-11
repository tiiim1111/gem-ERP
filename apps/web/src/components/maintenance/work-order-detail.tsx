'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  CircleAlert,
  ClipboardList,
  MoveRight,
  Package,
  Pencil,
  Play,
  PauseCircle,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react';
import { PERMISSIONS, WorkOrderStatus } from '@gemerp/shared';
import { getErrorMessage, isApiClientError, isVersionConflict } from '@/lib/api';
import {
  ATTACHMENT_RESOURCE_TYPES,
  cancelWorkOrder,
  completeWorkOrderTask,
  fetchWorkOrderPdf,
  getWorkOrder,
  listWorkOrderParts,
  resumeWorkOrder,
  setWorkOrderTasks,
  startWorkOrder,
  unwrapList,
  updateWorkOrder,
  verifyWorkOrder,
  type WorkOrderTaskInput,
} from '@/lib/endpoints';
import {
  assetTag,
  conditionLabel,
  formatDowntime,
  formatMoney,
  formatQuantity,
  itemRefLabel,
  refLabel,
  woAssigneeLabel,
  woCompletionCondition,
  woDowntimeMinutes,
  woIsAssignedTo,
  woNextMaintenance,
  woParts,
  woPartTransactionId,
  woPartTransactionStatus,
  woPlannedEnd,
  woPlannedStart,
  woProblem,
  woTaskIsCompleted,
  woTaskIsRequired,
  woTasks,
  woTotalCost,
  woType,
  workOrderNumber,
  type WorkOrder,
  type WorkOrderTask,
} from '@/lib/types';
import {
  MAINTENANCE_COST_PERMISSIONS,
  TECHNICIAN_WORK_ORDER_ACTIONS,
  WORK_ORDER_STEPS,
  WORK_ORDER_WAITING_STATUSES,
  workOrderActionPermissions,
  workOrderActionsFor,
  workOrderStatusLabel,
} from '@/lib/status-maps';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { AttachmentsPanel } from '@/components/attachments/attachments-panel';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { assetStatusBadge, stockTransactionStatusBadge } from '@/components/inventory/badges';
import { woPriorityBadge, woStatusBadge } from '@/components/maintenance/badges';
import { PrintDocumentButton } from '@/components/reports/print-document-button';
import {
  AddPartsDialog,
  AssignWorkOrderDialog,
  CompleteWorkOrderDialog,
  HoldWorkOrderDialog,
  ScheduleWorkOrderDialog,
} from '@/components/maintenance/work-order-dialogs';

/* --------------------------------- Stepper --------------------------------- */

function WoStepper({ wo }: { wo: WorkOrder }) {
  const canceled = wo.status === WorkOrderStatus.CANCELED;
  const waiting = WORK_ORDER_WAITING_STATUSES.includes(wo.status);
  // Waiting side-states pin to the In Progress position.
  const effectiveStatus = waiting ? WorkOrderStatus.IN_PROGRESS : wo.status;
  const currentIndex = WORK_ORDER_STEPS.findIndex((step) => step.status === effectiveStatus);

  if (canceled) {
    return (
      <div className="flex items-center gap-2">
        {woStatusBadge(wo.status)}
        <span className="text-sm text-muted-foreground">
          This work order was canceled{wo.cancelReason ? ` — ${wo.cancelReason}` : ''}. The asset
          reverted to its pre-work-order status.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Work order progress">
        {WORK_ORDER_STEPS.map((step, index) => {
          const done = currentIndex > index;
          const active = currentIndex === index;
          return (
            <li key={step.status} className="flex items-center gap-1.5">
              <span
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                  done
                    ? 'bg-success text-success-foreground'
                    : active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
              </span>
              <span className={cn('text-xs', active ? 'font-semibold' : 'text-muted-foreground')}>
                {step.label}
              </span>
              {index < WORK_ORDER_STEPS.length - 1 ? (
                <MoveRight className="mx-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
      {waiting ? (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <PauseCircle className="h-3.5 w-3.5" aria-hidden />
          Currently {workOrderStatusLabel(wo.status).toLowerCase()} — resume to continue the work.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------- Info row ---------------------------------- */

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right">{value ?? '—'}</dd>
    </div>
  );
}

/* ------------------------------ Findings card ------------------------------- */

/** Diagnosis / action taken / resolution — version-guarded PATCH. */
function FindingsCard({ wo, editable }: { wo: WorkOrder; editable: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [diagnosis, setDiagnosis] = React.useState('');
  const [actionTaken, setActionTaken] = React.useState('');
  const [resolution, setResolution] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const startEdit = () => {
    setDiagnosis(wo.diagnosis ?? '');
    setActionTaken(wo.actionTaken ?? '');
    setResolution(wo.resolution ?? '');
    setError(null);
    setEditing(true);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      updateWorkOrder(wo.id, {
        diagnosis: diagnosis.trim() || null,
        actionTaken: actionTaken.trim() || null,
        resolution: resolution.trim() || null,
        version: wo.version,
      }),
    onSuccess: () => {
      toast({ title: 'Findings saved', variant: 'success' });
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['maintenance-work-orders'] });
    },
    onError: (err) => {
      if (isVersionConflict(err)) {
        toast({
          title: 'Work order changed',
          description:
            'This work order was modified by someone else. The latest version has been reloaded — please reapply your changes.',
          variant: 'destructive',
        });
        setEditing(false);
        queryClient.invalidateQueries({ queryKey: ['maintenance-work-orders'] });
        return;
      }
      setError(getErrorMessage(err));
    },
  });

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Findings</CardTitle>
          <CardDescription>Diagnosis, action taken, and resolution.</CardDescription>
        </div>
        {editable && !editing ? (
          <Button variant="outline" size="sm" onClick={startEdit}>
            <Pencil aria-hidden /> Edit
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <>
            <FormError message={error} />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div>
                <label htmlFor="wo-diagnosis" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Diagnosis
                </label>
                <Textarea
                  id="wo-diagnosis"
                  rows={3}
                  value={diagnosis}
                  onChange={(event) => setDiagnosis(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="wo-action" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Action taken
                </label>
                <Textarea
                  id="wo-action"
                  rows={3}
                  value={actionTaken}
                  onChange={(event) => setActionTaken(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="wo-resolution" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Resolution
                </label>
                <Textarea
                  id="wo-resolution"
                  rows={3}
                  value={resolution}
                  onChange={(event) => setResolution(event.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
                <Save aria-hidden /> Save findings
              </Button>
            </div>
          </>
        ) : (
          <dl className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {(
              [
                ['Diagnosis', wo.diagnosis],
                ['Action taken', wo.actionTaken],
                ['Resolution', wo.resolution],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {label}
                </dt>
                <dd className={cn('mt-1 whitespace-pre-wrap text-sm', !value && 'text-muted-foreground')}>
                  {value || 'Not recorded yet.'}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Checklist card ------------------------------ */

interface TaskDraft {
  key: string;
  name: string;
  isRequired: boolean;
}

let woTaskKeyCounter = 1;

function ChecklistCard({
  wo,
  canTick,
  canEditChecklist,
}: {
  wo: WorkOrder;
  canTick: boolean;
  canEditChecklist: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<TaskDraft[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const tasks = woTasks(wo);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['maintenance-work-orders'] });
  }, [queryClient]);

  const tickMutation = useMutation({
    mutationFn: (task: WorkOrderTask) => completeWorkOrderTask(wo.id, task.id as string),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      setWorkOrderTasks(
        wo.id,
        // Order comes from array position — the server assigns sequences.
        draft.map(
          (task): WorkOrderTaskInput => ({
            name: task.name.trim(),
            isRequired: task.isRequired,
          }),
        ),
      ),
    onSuccess: () => {
      toast({ title: 'Checklist updated', variant: 'success' });
      setEditing(false);
      setError(null);
      invalidate();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const startEdit = () => {
    setDraft(
      tasks.map((task) => ({
        key: `wo-task-${woTaskKeyCounter++}`,
        name: task.name ?? '',
        isRequired: woTaskIsRequired(task),
      })),
    );
    setError(null);
    setEditing(true);
  };

  const handleSave = () => {
    for (const [index, task] of draft.entries()) {
      if (!task.name.trim()) return setError(`Task ${index + 1}: name is required.`);
    }
    saveMutation.mutate();
  };

  const doneCount = tasks.filter(woTaskIsCompleted).length;

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Checklist</CardTitle>
          <CardDescription>
            {tasks.length > 0
              ? `${doneCount} of ${tasks.length} tasks done. Required tasks must be completed before the work order can be closed.`
              : 'Tasks to perform on this work order.'}
          </CardDescription>
        </div>
        {canEditChecklist && !editing ? (
          <Button variant="outline" size="sm" onClick={startEdit}>
            <Pencil aria-hidden /> Edit checklist
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <FormError message={error} />
        {editing ? (
          <>
            {draft.map((task, index) => (
              <div key={task.key} className="flex flex-wrap items-center gap-2 rounded-md border p-2.5">
                <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                  {index + 1}.
                </span>
                <Input
                  aria-label={`Task ${index + 1} name`}
                  className="min-w-[12rem] flex-1"
                  value={task.name}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.map((entry) =>
                        entry.key === task.key ? { ...entry, name: event.target.value } : entry,
                      ),
                    )
                  }
                />
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={task.isRequired}
                    onChange={(event) =>
                      setDraft((current) =>
                        current.map((entry) =>
                          entry.key === task.key ? { ...entry, isRequired: event.target.checked } : entry,
                        ),
                      )
                    }
                  />
                  Required
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft((current) => current.filter((entry) => entry.key !== task.key))}
                  aria-label={`Remove task ${index + 1}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((current) => [
                    ...current,
                    { key: `wo-task-${woTaskKeyCounter++}`, name: '', isRequired: true },
                  ])
                }
              >
                <Plus aria-hidden /> Add task
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saveMutation.isPending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} loading={saveMutation.isPending}>
                  <Save aria-hidden /> Save checklist
                </Button>
              </div>
            </div>
          </>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No checklist tasks on this work order.</p>
        ) : (
          <ul className="space-y-1.5">
            {tasks.map((task, index) => {
              const completed = woTaskIsCompleted(task);
              return (
                <li
                  key={task.id ?? index}
                  className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <Checkbox
                      checked={completed}
                      disabled={completed || !canTick || !task.id || tickMutation.isPending}
                      onChange={() => tickMutation.mutate(task)}
                      aria-label={`Mark "${task.name}" complete`}
                    />
                    <div className="min-w-0">
                      <p className={cn('text-sm', completed && 'text-muted-foreground line-through')}>
                        {task.name}
                        {woTaskIsRequired(task) ? (
                          <Badge variant="outline" className="ml-1.5 align-middle">
                            Required
                          </Badge>
                        ) : null}
                      </p>
                      {completed && (task.completedAt || task.completedBy) ? (
                        <p className="text-xs text-muted-foreground">
                          Done {task.completedAt ? formatDateTime(task.completedAt) : ''}
                          {task.completedBy?.displayName ? ` · ${task.completedBy.displayName}` : ''}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* -------------------------------- Parts card -------------------------------- */

function PartsCard({
  wo,
  canViewCost,
  canAddParts,
  onAddParts,
}: {
  wo: WorkOrder;
  canViewCost: boolean;
  canAddParts: boolean;
  onAddParts: () => void;
}) {
  const partsQuery = useQuery({
    queryKey: ['maintenance-work-orders', 'parts', wo.id],
    queryFn: ({ signal }) => listWorkOrderParts(wo.id, signal),
    retry: false,
  });
  // Endpoint payload wins; fall back to parts embedded on the WO detail.
  const parts = partsQuery.data ? unwrapList(partsQuery.data) : woParts(wo);
  const showCosts = canViewCost && parts.some((part) => part.unitCost !== undefined && part.unitCost !== null);

  return (
    <Card className="mt-4">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Parts</CardTitle>
          <CardDescription>
            Spare parts consumed via linked stock issues — costs roll into the work order when posted.
          </CardDescription>
        </div>
        {canAddParts ? (
          <Button variant="outline" size="sm" onClick={onAddParts}>
            <Plus aria-hidden /> Add parts
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {partsQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : parts.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No parts issued"
            description="No spare parts have been drafted or consumed for this work order yet."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                {showCosts ? (
                  <>
                    <TableHead className="hidden text-right md:table-cell">Unit cost</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </>
                ) : null}
                <TableHead className="hidden sm:table-cell">Stock issue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parts.map((part, index) => {
                const txnId = woPartTransactionId(part);
                const txnStatus = woPartTransactionStatus(part);
                return (
                  <TableRow key={part.id ?? index}>
                    <TableCell className="text-sm font-medium">
                      {part.item?.id ? (
                        <Link href={`/items/${part.item.id}`} className="hover:underline">
                          {itemRefLabel(part.item)}
                        </Link>
                      ) : (
                        itemRefLabel(part.item ?? null)
                      )}
                      {part.lot?.lotNumber ? (
                        <span className="block font-mono text-xs text-muted-foreground">
                          Lot {part.lot.lotNumber}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatQuantity(part.quantity)} {part.uom?.code ?? ''}
                    </TableCell>
                    {showCosts ? (
                      <>
                        <TableCell className="hidden text-right font-mono text-xs tabular-nums md:table-cell">
                          {formatMoney(part.unitCost)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {formatMoney(part.totalCost)}
                        </TableCell>
                      </>
                    ) : null}
                    <TableCell className="hidden sm:table-cell">
                      {txnId ? (
                        <span className="inline-flex items-center gap-2">
                          <Link
                            href={`/inventory/transactions/${txnId}`}
                            className="font-mono text-xs hover:underline"
                          >
                            {part.stockTransaction?.number ??
                              part.stockTransaction?.transactionNumber ??
                              'View issue'}
                          </Link>
                          {txnStatus ? stockTransactionStatusBadge(txnStatus) : null}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/* --------------------------------- Detail ----------------------------------- */

export function WorkOrderDetail({ workOrderId }: { workOrderId: string }) {
  const queryClient = useQueryClient();
  const { user, can, canAny } = useSession();
  const { toast } = useToast();

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [confirmAction, setConfirmAction] = React.useState<'start' | 'resume' | 'verify' | null>(null);
  const [dialog, setDialog] = React.useState<
    'assign' | 'schedule' | 'hold' | 'complete' | 'cancel' | 'parts' | null
  >(null);

  const woQuery = useQuery({
    queryKey: ['maintenance-work-orders', 'detail', workOrderId],
    queryFn: ({ signal }) => getWorkOrder(workOrderId, signal),
  });
  const wo = woQuery.data;

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['maintenance-work-orders'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  }, [queryClient]);

  const handleActionError = React.useCallback(
    (error: unknown) => {
      if (isApiClientError(error)) {
        if (error.code === 'SELF_APPROVAL_FORBIDDEN') {
          setActionError(
            'You cannot verify a work order you completed yourself — a different supervisor must sign it off.',
          );
          return;
        }
        if (error.code === 'INVALID_STATE_TRANSITION') {
          toast({
            title: 'Status changed',
            description: 'This work order was updated elsewhere. Reloading the latest state.',
            variant: 'destructive',
          });
          invalidate();
        }
        if (error.code === 'VERSION_CONFLICT') {
          toast({
            title: 'Work order changed',
            description: 'This work order was modified by someone else. Reloading the latest state.',
            variant: 'destructive',
          });
          invalidate();
        }
      }
      setActionError(getErrorMessage(error));
    },
    [toast, invalidate],
  );

  const runAction = useMutation({
    mutationFn: async (input: { action: 'start' | 'resume' | 'verify' | 'cancel'; reason?: string }) => {
      switch (input.action) {
        case 'start':
          return startWorkOrder(workOrderId);
        case 'resume':
          return resumeWorkOrder(workOrderId);
        case 'verify':
          return verifyWorkOrder(workOrderId);
        case 'cancel':
          return cancelWorkOrder(workOrderId, input.reason ?? '');
      }
    },
    onSuccess: (_result, input) => {
      setActionError(null);
      const doneLabels: Record<string, string> = {
        start: 'started — asset moved to Under Maintenance',
        resume: 'resumed',
        verify: 'verified',
        cancel: 'canceled — asset reverted to its previous status',
      };
      toast({ title: `Work order ${doneLabels[input.action]}`, variant: 'success' });
      invalidate();
    },
    onError: handleActionError,
  });

  if (woQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (woQuery.isError || !wo) {
    return <ErrorState error={woQuery.error} onRetry={() => woQuery.refetch()} />;
  }

  const isTechnician = woIsAssignedTo(wo, user);
  const canViewCost = canAny(MAINTENANCE_COST_PERMISSIONS);
  const actions = workOrderActionsFor(wo.status).filter(
    (action) =>
      canAny(workOrderActionPermissions(action)) ||
      (isTechnician && TECHNICIAN_WORK_ORDER_ACTIONS.has(action)),
  );

  const canManage = can(PERMISSIONS.maintenanceWorkOrder.manage);
  const editableStatuses: string[] = [
    WorkOrderStatus.DRAFT,
    WorkOrderStatus.OPEN,
    WorkOrderStatus.ASSIGNED,
    WorkOrderStatus.SCHEDULED,
    WorkOrderStatus.IN_PROGRESS,
    WorkOrderStatus.ON_HOLD,
    WorkOrderStatus.AWAITING_PARTS,
    WorkOrderStatus.AWAITING_VENDOR,
  ];
  const isEditable = editableStatuses.includes(wo.status);
  const canEditFindings = isEditable && (actions.includes('edit') || isTechnician);
  // Task tick-off is only legal once work is under way (work-order-rules).
  const tickableStatuses: string[] = [
    WorkOrderStatus.IN_PROGRESS,
    WorkOrderStatus.ON_HOLD,
    WorkOrderStatus.AWAITING_PARTS,
    WorkOrderStatus.AWAITING_VENDOR,
  ];
  const canTickTasks = tickableStatuses.includes(wo.status) && (canManage || isTechnician);
  const checklistEditableStatuses: string[] = [
    WorkOrderStatus.DRAFT,
    WorkOrderStatus.OPEN,
    WorkOrderStatus.ASSIGNED,
    WorkOrderStatus.SCHEDULED,
  ];
  const canEditChecklist = canManage && checklistEditableStatuses.includes(wo.status);
  // Parts issues may only be drafted while In Progress or Awaiting Parts.
  const partsIssueStatuses: string[] = [WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.AWAITING_PARTS];
  const canAddParts =
    partsIssueStatuses.includes(wo.status) &&
    (can(PERMISSIONS.inventory.issue) || canManage || isTechnician);

  const resumeLabel =
    wo.status === WorkOrderStatus.AWAITING_PARTS
      ? 'Parts received'
      : wo.status === WorkOrderStatus.AWAITING_VENDOR
        ? 'Vendor done'
        : 'Resume';

  const downtime = woDowntimeMinutes(wo);

  return (
    <>
      <PageHeader
        title={workOrderNumber(wo)}
        description={`Work order · ${wo.asset ? assetTag(wo.asset) : 'asset'} · ${woType(wo)?.name ?? 'maintenance'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/maintenance/work-orders" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All work orders
            </Link>
            <PrintDocumentButton
              fetchDocument={() => fetchWorkOrderPdf(wo.id)}
              fileName={`${workOrderNumber(wo)}.pdf`}
            />
            {actions.includes('assign') ? (
              <Button onClick={() => setDialog('assign')}>
                <UserRound aria-hidden /> {woAssigneeLabel(wo) ? 'Reassign' : 'Assign'}
              </Button>
            ) : null}
            {actions.includes('schedule') ? (
              <Button variant="outline" onClick={() => setDialog('schedule')}>
                <ClipboardList aria-hidden /> Schedule
              </Button>
            ) : null}
            {actions.includes('start') ? (
              <Button onClick={() => setConfirmAction('start')}>
                <Play aria-hidden /> Start work
              </Button>
            ) : null}
            {actions.includes('hold') ? (
              <Button variant="outline" onClick={() => setDialog('hold')}>
                <PauseCircle aria-hidden /> Hold
              </Button>
            ) : null}
            {actions.includes('resume') ? (
              <Button onClick={() => setConfirmAction('resume')}>
                <Play aria-hidden /> {resumeLabel}
              </Button>
            ) : null}
            {actions.includes('complete') ? (
              <Button onClick={() => setDialog('complete')}>
                <CheckCircle2 aria-hidden /> Complete
              </Button>
            ) : null}
            {actions.includes('verify') ? (
              <Button onClick={() => setConfirmAction('verify')}>
                <ShieldCheck aria-hidden /> Verify
              </Button>
            ) : null}
            {actions.includes('cancel') ? (
              <Button variant="outline" onClick={() => setDialog('cancel')}>
                <Ban aria-hidden /> Cancel
              </Button>
            ) : null}
          </div>
        }
      />

      {actionError ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{actionError}</span>
        </div>
      ) : null}

      <Card className="mb-4">
        <CardContent className="space-y-4 pt-4 sm:pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <WoStepper wo={wo} />
            <div className="flex items-center gap-2">
              {woStatusBadge(wo.status)}
              {woPriorityBadge(wo.priority)}
            </div>
          </div>
          {woProblem(wo) ? (
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <span className="font-medium">Problem:</span> {woProblem(wo)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Asset</CardTitle>
          </CardHeader>
          <CardContent>
            {wo.asset ? (
              <dl>
                <InfoRow
                  label="Asset"
                  value={
                    <Link href={`/assets/${wo.asset.id}`} className="font-mono text-xs text-primary hover:underline">
                      {assetTag(wo.asset)}
                    </Link>
                  }
                />
                <InfoRow label="Item" value={itemRefLabel(wo.asset.item ?? null)} />
                <InfoRow label="Lifecycle" value={assetStatusBadge(wo.asset.status)} />
                <InfoRow
                  label="Condition"
                  value={conditionLabel(wo.asset.condition) ?? '—'}
                />
                <InfoRow label="Branch" value={wo.branch ? refLabel(wo.branch) : wo.asset.branch ? refLabel(wo.asset.branch) : '—'} />
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Asset details unavailable.</p>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <InfoRow label="Type" value={woType(wo)?.name ?? '—'} />
              <InfoRow
                label="Plan"
                value={
                  wo.plan ? (
                    <Link href={`/maintenance/plans/${wo.plan.id}`} className="text-primary hover:underline">
                      {wo.plan.name ?? wo.plan.code ?? 'Maintenance plan'}
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <InfoRow
                label="Reported"
                value={
                  wo.reportedAt || wo.reportedBy
                    ? `${wo.reportedAt ? formatDateTime(wo.reportedAt) : ''}${
                        wo.reportedBy?.displayName ? ` · ${wo.reportedBy.displayName}` : ''
                      }`
                    : formatDateTime(wo.createdAt)
                }
              />
              <InfoRow label="Assigned to" value={woAssigneeLabel(wo) ?? '—'} />
              <InfoRow
                label="Planned window"
                value={
                  woPlannedStart(wo)
                    ? `${formatDateTime(woPlannedStart(wo))} → ${
                        woPlannedEnd(wo) ? formatDateTime(woPlannedEnd(wo)) : '—'
                      }`
                    : '—'
                }
              />
              <InfoRow
                label="Actual window"
                value={
                  wo.actualStartAt
                    ? `${formatDateTime(wo.actualStartAt)} → ${
                        wo.actualEndAt ? formatDateTime(wo.actualEndAt) : 'in progress'
                      }`
                    : '—'
                }
              />
              <InfoRow label="Downtime" value={formatDowntime(downtime)} />
              <InfoRow label="Next maintenance" value={formatDate(woNextMaintenance(wo))} />
              {woCompletionCondition(wo) ? (
                <InfoRow label="Final condition" value={woCompletionCondition(wo)?.name ?? '—'} />
              ) : null}
              {wo.verifiedAt ? (
                <InfoRow
                  label="Verified"
                  value={`${formatDateTime(wo.verifiedAt)}${
                    wo.verifiedBy?.displayName ? ` · ${wo.verifiedBy.displayName}` : ''
                  }`}
                />
              ) : null}
              {wo.cancelReason ? <InfoRow label="Cancel reason" value={wo.cancelReason} /> : null}
            </dl>
          </CardContent>
        </Card>
      </div>

      {canViewCost ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Costs</CardTitle>
            <CardDescription>Labor, parts (from posted issues), and external services.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  ['Labor', wo.laborCost],
                  ['Parts', wo.partsCost],
                  ['External', wo.externalCost],
                  ['Total', woTotalCost(wo)],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className={cn('mt-0.5 font-mono text-lg tabular-nums', label === 'Total' && 'font-semibold')}>
                    {value !== undefined && value !== null ? formatMoney(value) : '—'}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <FindingsCard wo={wo} editable={canEditFindings} />
      <ChecklistCard wo={wo} canTick={canTickTasks} canEditChecklist={canEditChecklist} />
      <PartsCard
        wo={wo}
        canViewCost={canViewCost}
        canAddParts={canAddParts}
        onAddParts={() => setDialog('parts')}
      />

      {can(PERMISSIONS.attachment.view) ? (
        <AttachmentsPanel
          resourceType={ATTACHMENT_RESOURCE_TYPES.workOrder}
          resourceId={wo.id}
          managePermissions={[
            PERMISSIONS.maintenanceWorkOrder.update,
            PERMISSIONS.maintenanceWorkOrder.manage,
          ]}
          description="Service reports, vendor quotes, and before/after photos."
        />
      ) : null}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmAction === 'start'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Start work"
        description="Records the actual start and moves the asset to Under Maintenance — it cannot be issued or transferred until the work order is completed or canceled."
        confirmLabel="Start work"
        onConfirm={() => runAction.mutateAsync({ action: 'start' })}
      />
      <ConfirmDialog
        open={confirmAction === 'resume'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title={resumeLabel}
        description={
          wo.status === WorkOrderStatus.AWAITING_PARTS
            ? 'Confirms the linked parts issue is posted and work continues.'
            : wo.status === WorkOrderStatus.AWAITING_VENDOR
              ? 'Confirms the vendor service is done and work continues.'
              : 'Puts the work order back in progress.'
        }
        confirmLabel={resumeLabel}
        onConfirm={() => runAction.mutateAsync({ action: 'resume' })}
      />
      <ConfirmDialog
        open={confirmAction === 'verify'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Verify work order"
        description="Supervisor sign-off — closes the work order for edits. The verifier must be different from the technician who completed it."
        confirmLabel="Verify"
        onConfirm={() => runAction.mutateAsync({ action: 'verify' })}
      />

      {/* Reason dialog for cancel */}
      <ReasonDialog
        open={dialog === 'cancel'}
        onOpenChange={(open) => !open && setDialog(null)}
        title="Cancel work order"
        description="The asset reverts to the status it held before this work order. Any posted parts issues must be reversed first."
        confirmLabel="Cancel work order"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'cancel', reason })}
      />

      {/* Action dialogs */}
      <AssignWorkOrderDialog wo={wo} open={dialog === 'assign'} onOpenChange={(open) => !open && setDialog(null)} />
      <ScheduleWorkOrderDialog wo={wo} open={dialog === 'schedule'} onOpenChange={(open) => !open && setDialog(null)} />
      <HoldWorkOrderDialog wo={wo} open={dialog === 'hold'} onOpenChange={(open) => !open && setDialog(null)} />
      <CompleteWorkOrderDialog wo={wo} open={dialog === 'complete'} onOpenChange={(open) => !open && setDialog(null)} />
      <AddPartsDialog wo={wo} open={dialog === 'parts'} onOpenChange={(open) => !open && setDialog(null)} />
    </>
  );
}
