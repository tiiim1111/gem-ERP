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
  Inbox,
  MoveRight,
  Send,
  ThumbsDown,
  Truck,
} from 'lucide-react';
import { TransferStatus } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  approveTransfer,
  cancelTransfer,
  dispatchTransfer,
  getTransfer,
  receiveTransfer,
  rejectTransfer,
  submitTransfer,
  type TransferReceiveLineInput,
} from '@/lib/endpoints';
import { useIdempotencyKey } from '@/lib/idempotency';
import {
  assetTag,
  decimalValue,
  formatQuantity,
  itemRefLabel,
  lotNumber,
  refLabel,
  transferApprovals,
  transferDestination,
  transferLineQuantity,
  transferNumber,
  transferSource,
  type Transfer,
  type TransferLine,
} from '@/lib/types';
import {
  transferActionPermissions,
  transferActionsFor,
  TRANSFER_STEPS,
  type TransferAction,
} from '@/lib/status-maps';
import { cn, formatDateTime, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { FormError } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { transferStatusBadge } from '@/components/inventory/badges';

function lineLabel(line: TransferLine): string {
  if (line.asset) return assetTag(line.asset);
  if (line.assetId) return `Asset ${line.assetId.slice(0, 8)}`;
  return itemRefLabel(line.item ?? (line.itemId ? { id: line.itemId } : null));
}

/** Per-line receive entry state. */
interface ReceiveEntry {
  received: string;
  damaged: string;
  short: string;
  rejected: string;
  notes: string;
}

function TransferStepper({ transfer }: { transfer: Transfer }) {
  const terminalBad =
    transfer.status === TransferStatus.REJECTED || transfer.status === TransferStatus.CANCELED;
  const currentIndex = TRANSFER_STEPS.findIndex((step) => step.status === transfer.status);

  if (terminalBad) {
    return (
      <div className="flex items-center gap-2">
        {transferStatusBadge(transfer.status)}
        <span className="text-sm text-muted-foreground">
          {transfer.status === TransferStatus.REJECTED
            ? 'This transfer was rejected by an approver.'
            : 'This transfer was canceled before dispatch.'}
        </span>
      </div>
    );
  }

  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Transfer progress">
      {TRANSFER_STEPS.map((step, index) => {
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
            {index < TRANSFER_STEPS.length - 1 ? (
              <MoveRight className="mx-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export function TransferDetail({ transferId }: { transferId: string }) {
  const queryClient = useQueryClient();
  const { user, canAny } = useSession();
  const { toast } = useToast();

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [confirmAction, setConfirmAction] = React.useState<'submit' | 'approve' | 'dispatch' | null>(null);
  const [reasonAction, setReasonAction] = React.useState<'reject' | 'cancel' | null>(null);
  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const [receiveEntries, setReceiveEntries] = React.useState<Record<string, ReceiveEntry>>({});
  const [receiveNotes, setReceiveNotes] = React.useState('');
  const [receiveError, setReceiveError] = React.useState<string | null>(null);

  const transferQuery = useQuery({
    queryKey: ['transfers', 'detail', transferId],
    queryFn: ({ signal }) => getTransfer(transferId, signal),
  });
  const transfer = transferQuery.data;

  const dispatchKey = useIdempotencyKey(transferId);
  const receiveKey = useIdempotencyKey(transferId);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['transfers'] });
    queryClient.invalidateQueries({ queryKey: ['stock-balances'] });
    queryClient.invalidateQueries({ queryKey: ['stock-ledger'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  }, [queryClient]);

  const handleActionError = React.useCallback(
    (error: unknown) => {
      if (isApiClientError(error) && error.code === 'INVALID_STATE_TRANSITION') {
        toast({
          title: 'Status changed',
          description: 'This transfer was updated elsewhere. Reloading the latest state.',
          variant: 'destructive',
        });
        invalidate();
      }
      setActionError(getErrorMessage(error));
    },
    [toast, invalidate],
  );

  const runAction = useMutation({
    mutationFn: async (input: { action: Exclude<TransferAction, 'receive'>; reason?: string }) => {
      switch (input.action) {
        case 'submit':
          return submitTransfer(transferId);
        case 'approve':
          return approveTransfer(transferId);
        case 'reject':
          return rejectTransfer(transferId, input.reason ?? '');
        case 'dispatch':
          return dispatchTransfer(transferId, dispatchKey.key);
        case 'cancel':
          return cancelTransfer(transferId, input.reason ?? '');
      }
    },
    onSuccess: (_result, input) => {
      if (input.action === 'dispatch') dispatchKey.rotate();
      setActionError(null);
      const doneLabels: Record<string, string> = {
        submit: 'submitted',
        approve: 'approved',
        reject: 'rejected',
        dispatch: 'dispatched',
        cancel: 'canceled',
      };
      toast({ title: `Transfer ${doneLabels[input.action]}`, variant: 'success' });
      invalidate();
    },
    onError: handleActionError,
  });

  const receiveMutation = useMutation({
    mutationFn: (body: { lines: TransferReceiveLineInput[]; notes?: string }) =>
      receiveTransfer(transferId, body, receiveKey.key),
    onSuccess: () => {
      receiveKey.rotate();
      setReceiveOpen(false);
      setReceiveError(null);
      toast({ title: 'Transfer received', description: 'Destination stock and custody updated.', variant: 'success' });
      invalidate();
    },
    onError: (error) => setReceiveError(getErrorMessage(error)),
  });

  // Seed receive entries whenever the panel opens.
  React.useEffect(() => {
    if (!receiveOpen || !transfer) return;
    const entries: Record<string, ReceiveEntry> = {};
    for (const [index, line] of (transfer.lines ?? []).entries()) {
      const key = line.id ?? String(index);
      const dispatched =
        line.dispatchedQuantity ?? transferLineQuantity(line) ?? (line.assetId || line.asset ? 1 : 0);
      entries[key] = {
        received: String(decimalValue(dispatched)),
        damaged: '0',
        short: '0',
        rejected: '0',
        notes: '',
      };
    }
    setReceiveEntries(entries);
    setReceiveNotes('');
    setReceiveError(null);
  }, [receiveOpen, transfer]);

  if (transferQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (transferQuery.isError || !transfer) {
    return <ErrorState error={transferQuery.error} onRetry={() => transferQuery.refetch()} />;
  }

  const source = transferSource(transfer);
  const destination = transferDestination(transfer);
  const approvals = transferApprovals(transfer);

  const hasBranchAccess = (branchId: string | undefined) =>
    user.isSuperAdmin || !branchId || user.branchIds.includes(branchId);

  const actions = transferActionsFor(transfer.status).filter((action) => {
    if (!canAny(transferActionPermissions(action))) return false;
    if (action === 'dispatch') return hasBranchAccess(source.branchId);
    if (action === 'receive') return hasBranchAccess(destination.branchId);
    return true;
  });

  const submitReceive = () => {
    setReceiveError(null);
    const lines: TransferReceiveLineInput[] = [];
    for (const [index, line] of (transfer.lines ?? []).entries()) {
      const key = line.id ?? String(index);
      const entry = receiveEntries[key];
      if (!entry) continue;
      const received = Number(entry.received);
      const damaged = Number(entry.damaged);
      const short = Number(entry.short);
      const rejected = Number(entry.rejected);
      for (const [label, value] of [
        ['Received', received],
        ['Damaged', damaged],
        ['Short', short],
        ['Rejected', rejected],
      ] as const) {
        if (!Number.isFinite(value) || value < 0) {
          setReceiveError(`Line ${index + 1}: ${label} must be zero or a positive number.`);
          return;
        }
      }
      if (damaged + short + rejected > 0 && !entry.notes.trim()) {
        setReceiveError(
          `Line ${index + 1}: a reason/note is required when reporting damaged, short, or rejected quantities.`,
        );
        return;
      }
      lines.push({
        lineId: line.id ?? String(index),
        received: entry.received,
        damaged: entry.damaged,
        short: entry.short,
        rejected: entry.rejected,
        notes: entry.notes.trim() || undefined,
      });
    }
    if (lines.length === 0) {
      setReceiveError('There are no lines to receive.');
      return;
    }
    receiveMutation.mutate({ lines, notes: receiveNotes.trim() || undefined });
  };

  return (
    <>
      <PageHeader
        title={transferNumber(transfer)}
        description={transfer.kind ? `${humanize(transfer.kind)} transfer` : 'Transfer'}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/inventory/transfers" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All transfers
            </Link>
            {actions.includes('submit') ? (
              <Button onClick={() => setConfirmAction('submit')}>
                <Send aria-hidden /> Submit
              </Button>
            ) : null}
            {actions.includes('approve') ? (
              <Button onClick={() => setConfirmAction('approve')}>
                <CheckCircle2 aria-hidden /> Approve
              </Button>
            ) : null}
            {actions.includes('reject') ? (
              <Button variant="outline" onClick={() => setReasonAction('reject')}>
                <ThumbsDown aria-hidden /> Reject
              </Button>
            ) : null}
            {actions.includes('dispatch') ? (
              <Button onClick={() => setConfirmAction('dispatch')}>
                <Truck aria-hidden /> Dispatch
              </Button>
            ) : null}
            {actions.includes('receive') ? (
              <Button onClick={() => setReceiveOpen(true)}>
                <Inbox aria-hidden /> Receive
              </Button>
            ) : null}
            {actions.includes('cancel') ? (
              <Button variant="outline" onClick={() => setReasonAction('cancel')}>
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
          <TransferStepper transfer={transfer} />
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</p>
              <p className="font-medium">{source.branch ? refLabel(source.branch) : '—'}</p>
              <p className="text-muted-foreground">
                {source.warehouse ? refLabel(source.warehouse) : '—'}
                {source.location ? ` · ${refLabel(source.location)}` : ''}
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Destination
              </p>
              <p className="font-medium">{destination.branch ? refLabel(destination.branch) : '—'}</p>
              <p className="text-muted-foreground">
                {destination.warehouse ? refLabel(destination.warehouse) : '—'}
                {destination.location ? ` · ${refLabel(destination.location)}` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            {transfer.createdAt ? <span>Created {formatDateTime(transfer.createdAt)}</span> : null}
            {transfer.submittedAt ? <span>Submitted {formatDateTime(transfer.submittedAt)}</span> : null}
            {transfer.approvedAt ? <span>Approved {formatDateTime(transfer.approvedAt)}</span> : null}
            {transfer.dispatchedAt ? <span>Dispatched {formatDateTime(transfer.dispatchedAt)}</span> : null}
            {transfer.receivedAt ? <span>Received {formatDateTime(transfer.receivedAt)}</span> : null}
          </div>
          {transfer.notes ? <p className="text-sm text-muted-foreground">{transfer.notes}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {(transfer.lines ?? []).length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">No lines on this transfer.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Item / asset</TableHead>
                  <TableHead className="hidden md:table-cell">Lot</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Dispatched</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Short</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Damaged</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Rejected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(transfer.lines ?? []).map((line, index) => (
                  <TableRow key={line.id ?? index}>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">
                      {line.lineNumber ?? index + 1}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {line.asset?.id || line.assetId ? (
                        <Link
                          href={`/assets/${line.asset?.id ?? line.assetId}`}
                          className="hover:underline"
                        >
                          {lineLabel(line)}
                        </Link>
                      ) : (
                        lineLabel(line)
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {line.lot ? lotNumber(line.lot) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {line.assetId || line.asset ? '1' : formatQuantity(transferLineQuantity(line))}{' '}
                      {line.uom?.code ?? ''}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                      {formatQuantity(line.dispatchedQuantity)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                      {formatQuantity(line.receivedQuantity)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-xs tabular-nums lg:table-cell">
                      {formatQuantity(line.shortQuantity)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-xs tabular-nums lg:table-cell">
                      {formatQuantity(line.damagedQuantity)}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-xs tabular-nums lg:table-cell">
                      {formatQuantity(line.rejectedQuantity)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {approvals.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Approval trail</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {approvals.map((entry, index) => (
                <li key={entry.id ?? index} className="text-sm">
                  <span className="font-medium">
                    {entry.actorDisplayName ?? entry.actor?.displayName ?? 'Approver'}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    {humanize(entry.decision ?? entry.action ?? entry.status ?? 'decided').toLowerCase()}
                  </span>
                  {entry.comment ? (
                    <span className="block text-xs text-muted-foreground">“{entry.comment}”</span>
                  ) : null}
                  {entry.decidedAt ?? entry.createdAt ? (
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(entry.decidedAt ?? entry.createdAt)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Receive screen */}
      {receiveOpen ? (
        <Card className="mt-4 border-primary/40">
          <CardHeader>
            <CardTitle>Receive at destination</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter the accepted, short, damaged, and rejected quantity per line. A note is required for
              any exception quantity.
            </p>
            <FormError message={receiveError} />
            <div className="space-y-3">
              {(transfer.lines ?? []).map((line, index) => {
                const key = line.id ?? String(index);
                const entry = receiveEntries[key];
                if (!entry) return null;
                const update = (patch: Partial<ReceiveEntry>) =>
                  setReceiveEntries((current) => ({ ...current, [key]: { ...current[key]!, ...patch } }));
                const hasException =
                  Number(entry.damaged) > 0 || Number(entry.short) > 0 || Number(entry.rejected) > 0;
                return (
                  <div key={key} className="space-y-2 rounded-md border p-3">
                    <p className="text-sm font-semibold">
                      Line {index + 1} · {lineLabel(line)}
                      <span className="ml-2 font-normal text-muted-foreground">
                        dispatched{' '}
                        {formatQuantity(
                          line.dispatchedQuantity ?? transferLineQuantity(line) ?? (line.assetId ? 1 : 0),
                        )}
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <label className="space-y-1 text-xs font-medium">
                        Accepted
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={entry.received}
                          onChange={(event) => update({ received: event.target.value })}
                          aria-label={`Line ${index + 1} accepted quantity`}
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium">
                        Short
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={entry.short}
                          onChange={(event) => update({ short: event.target.value })}
                          aria-label={`Line ${index + 1} short quantity`}
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium">
                        Damaged
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={entry.damaged}
                          onChange={(event) => update({ damaged: event.target.value })}
                          aria-label={`Line ${index + 1} damaged quantity`}
                        />
                      </label>
                      <label className="space-y-1 text-xs font-medium">
                        Rejected
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={entry.rejected}
                          onChange={(event) => update({ rejected: event.target.value })}
                          aria-label={`Line ${index + 1} rejected quantity`}
                        />
                      </label>
                    </div>
                    {hasException ? (
                      <label className="block space-y-1 text-xs font-medium">
                        Exception reason (required)
                        <Input
                          value={entry.notes}
                          onChange={(event) => update({ notes: event.target.value })}
                          placeholder="Why is stock short / damaged / rejected?"
                          aria-label={`Line ${index + 1} exception reason`}
                        />
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <label className="block space-y-1 text-xs font-medium">
              Inspection notes
              <Textarea
                rows={2}
                value={receiveNotes}
                onChange={(event) => setReceiveNotes(event.target.value)}
                aria-label="Inspection notes"
              />
            </label>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setReceiveOpen(false)} disabled={receiveMutation.isPending}>
                Cancel
              </Button>
              <Button onClick={submitReceive} loading={receiveMutation.isPending}>
                <Inbox aria-hidden /> Post receipt
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmAction === 'submit'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Submit transfer"
        description="Submits this draft for approval. Inter-branch transfers always require an approver."
        confirmLabel="Submit"
        onConfirm={() => runAction.mutateAsync({ action: 'submit' })}
      />
      <ConfirmDialog
        open={confirmAction === 'approve'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Approve transfer"
        description="Approving reserves the stock/assets at the source until dispatch. You cannot approve your own submission."
        confirmLabel="Approve"
        onConfirm={() => runAction.mutateAsync({ action: 'approve' })}
      />
      <ConfirmDialog
        open={confirmAction === 'dispatch'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Dispatch transfer"
        description="Posts the source-out movement and marks stock and assets as In Transfer. Availability is hard-checked at dispatch."
        confirmLabel="Dispatch"
        onConfirm={() => runAction.mutateAsync({ action: 'dispatch' })}
      />

      {/* Reason dialogs */}
      <ReasonDialog
        open={reasonAction === 'reject'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Reject transfer"
        description="A rejection comment is mandatory and is kept in the approval history."
        reasonLabel="Rejection comment"
        confirmLabel="Reject"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'reject', reason })}
      />
      <ReasonDialog
        open={reasonAction === 'cancel'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Cancel transfer"
        description="Transfers can only be canceled before dispatch. Reservations are released."
        confirmLabel="Cancel transfer"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'cancel', reason })}
      />
    </>
  );
}
