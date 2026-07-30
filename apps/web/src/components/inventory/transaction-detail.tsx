'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  CircleAlert,
  Send,
  ThumbsDown,
  Undo2,
  UploadCloud,
} from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage, isApiClientError, type ApiClientError } from '@/lib/api';
import {
  approveStockTransaction,
  cancelStockTransaction,
  getStockTransaction,
  postStockTransaction,
  rejectStockTransaction,
  reverseStockTransaction,
  submitStockTransaction,
} from '@/lib/endpoints';
import { useIdempotencyKey } from '@/lib/idempotency';
import {
  employeeName,
  formatMoney,
  formatQuantity,
  itemRefLabel,
  ledgerQuantity,
  ledgerTimestamp,
  lotNumber,
  refLabel,
  stockTransactionApprovals,
  stockTransactionNumber,
  stockTransactionReasonLabel,
  type StockTransactionLine,
} from '@/lib/types';
import {
  stockTransactionActionPermissions,
  stockTransactionActionsFor,
  stockTransactionTypeLabel,
  type StockTransactionAction,
} from '@/lib/status-maps';
import { formatDateTime, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { SignedQuantity, stockTransactionStatusBadge } from '@/components/inventory/badges';

/** Per-line messages parsed from a VALIDATION/INSUFFICIENT_STOCK error. */
function parseLineErrors(error: ApiClientError, lines: StockTransactionLine[]): Record<number, string> {
  const result: Record<number, string> = {};
  for (const detail of error.details ?? []) {
    const field = detail.field ?? '';
    const indexMatch = /^lines[.[](\d+)/.exec(field);
    if (indexMatch) {
      const index = Number(indexMatch[1]);
      if (!(index in result)) result[index] = detail.message;
      continue;
    }
    // Some servers reference the line id or item id instead of an index.
    const byId = lines.findIndex(
      (line) => (line.id && field.includes(line.id)) || (line.itemId && field.includes(line.itemId)),
    );
    if (byId >= 0 && !(byId in result)) result[byId] = detail.message;
  }
  return result;
}

function TimelineRow({ label, at, by }: { label: string; at?: string | null; by?: string | null }) {
  if (!at) return null;
  return (
    <li className="flex items-start gap-3">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(at)}
          {by ? ` · ${by}` : ''}
        </p>
      </div>
    </li>
  );
}

export function TransactionDetail({ transactionId }: { transactionId: string }) {
  const queryClient = useQueryClient();
  const { canAny } = useSession();
  const { toast } = useToast();

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [lineErrors, setLineErrors] = React.useState<Record<number, string>>({});
  const [confirmAction, setConfirmAction] = React.useState<'submit' | 'approve' | 'post' | null>(null);
  const [reasonAction, setReasonAction] = React.useState<'reject' | 'cancel' | 'reverse' | null>(null);

  const txnQuery = useQuery({
    queryKey: ['stock-transactions', 'detail', transactionId],
    queryFn: ({ signal }) => getStockTransaction(transactionId, signal),
  });
  const txn = txnQuery.data;

  // Stable per-attempt idempotency keys; rotate only after success.
  const postKey = useIdempotencyKey(transactionId);
  const reverseKey = useIdempotencyKey(transactionId);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['stock-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['stock-balances'] });
    queryClient.invalidateQueries({ queryKey: ['stock-ledger'] });
    queryClient.invalidateQueries({ queryKey: ['low-stock'] });
    queryClient.invalidateQueries({ queryKey: ['lots'] });
  }, [queryClient]);

  const handleActionError = React.useCallback(
    (error: unknown) => {
      if (isApiClientError(error)) {
        if (error.code === 'INSUFFICIENT_STOCK' && txn?.lines) {
          setLineErrors(parseLineErrors(error, txn.lines));
        }
        if (error.code === 'INVALID_STATE_TRANSITION') {
          toast({
            title: 'Status changed',
            description: 'This transaction was updated elsewhere. Reloading the latest state.',
            variant: 'destructive',
          });
          invalidate();
        }
      }
      setActionError(getErrorMessage(error));
    },
    [txn, toast, invalidate],
  );

  const runAction = useMutation({
    mutationFn: async (input: { action: StockTransactionAction; reason?: string }) => {
      const { action, reason } = input;
      switch (action) {
        case 'submit':
          return submitStockTransaction(transactionId);
        case 'approve':
          return approveStockTransaction(transactionId);
        case 'reject':
          return rejectStockTransaction(transactionId, reason ?? '');
        case 'post':
          return postStockTransaction(transactionId, postKey.key);
        case 'cancel':
          return cancelStockTransaction(transactionId, reason ?? '');
        case 'reverse':
          return reverseStockTransaction(transactionId, reason ?? '', reverseKey.key);
      }
    },
    onSuccess: (_result, input) => {
      if (input.action === 'post') postKey.rotate();
      if (input.action === 'reverse') reverseKey.rotate();
      setActionError(null);
      setLineErrors({});
      const doneLabels: Record<StockTransactionAction, string> = {
        submit: 'submitted',
        approve: 'approved',
        reject: 'rejected',
        post: 'posted',
        cancel: 'canceled',
        reverse: 'reversed',
      };
      toast({ title: `Transaction ${doneLabels[input.action]}`, variant: 'success' });
      invalidate();
    },
    onError: handleActionError,
  });

  const actions = txn ? stockTransactionActionsFor(txn.status) : [];
  const visibleActions = txn
    ? actions.filter((action) => canAny(stockTransactionActionPermissions(action, txn.type)))
    : [];

  const canViewCostColumn = canAny([PERMISSIONS.inventory.viewCost]);
  const showCosts =
    canViewCostColumn && (txn?.lines ?? []).some((line) => line.unitCost !== undefined && line.unitCost !== null);

  const actionButton = (action: StockTransactionAction) => {
    switch (action) {
      case 'submit':
        return (
          <Button key={action} onClick={() => setConfirmAction('submit')}>
            <Send aria-hidden /> Submit
          </Button>
        );
      case 'approve':
        return (
          <Button key={action} onClick={() => setConfirmAction('approve')}>
            <CheckCircle2 aria-hidden /> Approve
          </Button>
        );
      case 'reject':
        return (
          <Button key={action} variant="outline" onClick={() => setReasonAction('reject')}>
            <ThumbsDown aria-hidden /> Reject
          </Button>
        );
      case 'post':
        return (
          <Button key={action} onClick={() => setConfirmAction('post')}>
            <UploadCloud aria-hidden /> Post
          </Button>
        );
      case 'cancel':
        return (
          <Button key={action} variant="outline" onClick={() => setReasonAction('cancel')}>
            <Ban aria-hidden /> Cancel
          </Button>
        );
      case 'reverse':
        return (
          <Button key={action} variant="destructive" onClick={() => setReasonAction('reverse')}>
            <Undo2 aria-hidden /> Reverse
          </Button>
        );
    }
  };

  if (txnQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (txnQuery.isError || !txn) {
    return <ErrorState error={txnQuery.error} onRetry={() => txnQuery.refetch()} />;
  }

  const approvals = stockTransactionApprovals(txn);

  return (
    <>
      <PageHeader
        title={stockTransactionNumber(txn)}
        description={stockTransactionTypeLabel(txn.type)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/inventory/transactions" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All transactions
            </Link>
            {visibleActions.map((action) => actionButton(action))}
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Details</CardTitle>
            {stockTransactionStatusBadge(txn.status)}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                <dt className="text-muted-foreground">Branch</dt>
                <dd>{txn.branch ? refLabel(txn.branch) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                <dt className="text-muted-foreground">Warehouse</dt>
                <dd>{txn.warehouse ? refLabel(txn.warehouse) : '—'}</dd>
              </div>
              <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                <dt className="text-muted-foreground">Transaction date</dt>
                <dd>{formatDateTime(txn.transactionDate ?? txn.createdAt)}</dd>
              </div>
              <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                <dt className="text-muted-foreground">Posted</dt>
                <dd>{txn.postedAt ? formatDateTime(txn.postedAt) : 'Not posted'}</dd>
              </div>
              {txn.employee ? (
                <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                  <dt className="text-muted-foreground">Employee</dt>
                  <dd>{employeeName(txn.employee)}</dd>
                </div>
              ) : null}
              {txn.department ? (
                <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                  <dt className="text-muted-foreground">Department</dt>
                  <dd>{txn.department.name ?? '—'}</dd>
                </div>
              ) : null}
              {stockTransactionReasonLabel(txn) ? (
                <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                  <dt className="text-muted-foreground">Reason</dt>
                  <dd>{stockTransactionReasonLabel(txn)}</dd>
                </div>
              ) : null}
              {txn.notes ? (
                <div className="flex justify-between gap-2 border-b py-1.5 text-sm sm:col-span-2">
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="whitespace-pre-wrap text-right">{txn.notes}</dd>
                </div>
              ) : null}
              {txn.reversalOfId ? (
                <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                  <dt className="text-muted-foreground">Reversal of</dt>
                  <dd>
                    <Link
                      href={`/inventory/transactions/${txn.reversalOfId}`}
                      className="text-primary hover:underline"
                    >
                      View original
                    </Link>
                  </dd>
                </div>
              ) : null}
              {txn.reversedByTransactionId ? (
                <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                  <dt className="text-muted-foreground">Reversed by</dt>
                  <dd>
                    <Link
                      href={`/inventory/transactions/${txn.reversedByTransactionId}`}
                      className="text-primary hover:underline"
                    >
                      View reversal
                    </Link>
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <TimelineRow label="Created" at={txn.createdAt} by={txn.createdBy?.displayName} />
              <TimelineRow label="Submitted" at={txn.submittedAt} />
              <TimelineRow label="Approved" at={txn.approvedAt} by={txn.approvedBy?.displayName} />
              <TimelineRow label="Rejected" at={txn.rejectedAt} />
              <TimelineRow label="Posted" at={txn.postedAt} by={txn.postedBy?.displayName} />
              <TimelineRow label="Canceled" at={txn.canceledAt} />
              <TimelineRow label="Reversed" at={txn.reversedAt} />
            </ul>
            {approvals.length > 0 ? (
              <div className="mt-4 space-y-2 border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Approval trail
                </p>
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
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {(txn.lines ?? []).length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">No lines on this transaction.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Entered qty</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Base qty</TableHead>
                  <TableHead className="hidden md:table-cell">Lot</TableHead>
                  <TableHead className="hidden lg:table-cell">Location</TableHead>
                  {showCosts ? <TableHead className="text-right">Unit cost</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(txn.lines ?? []).map((line, index) => (
                  <React.Fragment key={line.id ?? index}>
                    <TableRow className={lineErrors[index] ? 'bg-destructive/5' : undefined}>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {line.lineNumber ?? index + 1}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {line.item?.id ? (
                          <Link href={`/items/${line.item.id}`} className="hover:underline">
                            {itemRefLabel(line.item)}
                          </Link>
                        ) : (
                          itemRefLabel(line.item ?? { id: line.itemId })
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatQuantity(line.enteredQuantity ?? line.quantity)}{' '}
                        {line.uom?.code ?? ''}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                        {formatQuantity(line.baseQuantity)}{' '}
                        {line.baseUom?.code ?? line.item?.baseUom?.code ?? ''}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {line.lot ? lotNumber(line.lot) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {line.location ? refLabel(line.location) : '—'}
                      </TableCell>
                      {showCosts ? (
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {formatMoney(line.unitCost)}
                        </TableCell>
                      ) : null}
                    </TableRow>
                    {lineErrors[index] ? (
                      <TableRow className="bg-destructive/5 hover:bg-destructive/5">
                        <TableCell colSpan={showCosts ? 7 : 6}>
                          <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
                            <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {lineErrors[index]}
                          </p>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {(txn.ledgerEntries ?? []).length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Ledger entries</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="hidden md:table-cell">Lot</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="hidden sm:table-cell">Posted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(txn.ledgerEntries ?? []).map((entry, index) => (
                  <TableRow key={entry.id ?? index}>
                    <TableCell className="text-sm">{itemRefLabel(entry.item ?? null)}</TableCell>
                    <TableCell className="text-right">
                      <SignedQuantity value={ledgerQuantity(entry)} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {entry.lot ? lotNumber(entry.lot) : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {entry.location ? refLabel(entry.location) : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                      {formatDateTime(ledgerTimestamp(entry))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {/* Confirm dialogs (submit / approve / post) */}
      <ConfirmDialog
        open={confirmAction === 'submit'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Submit for approval"
        description="Submits this draft into the approval workflow (or straight to Approved when no workflow applies)."
        confirmLabel="Submit"
        onConfirm={() => runAction.mutateAsync({ action: 'submit' })}
      />
      <ConfirmDialog
        open={confirmAction === 'approve'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Approve transaction"
        description="Approving allows this transaction to be posted. You cannot approve your own submission."
        confirmLabel="Approve"
        onConfirm={() => runAction.mutateAsync({ action: 'approve' })}
      />
      <ConfirmDialog
        open={confirmAction === 'post'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Post transaction"
        description="Posting writes immutable ledger entries and updates stock balances. Availability is validated at posting time — this cannot be edited afterwards, only reversed."
        confirmLabel="Post to ledger"
        onConfirm={() => runAction.mutateAsync({ action: 'post' })}
      />

      {/* Reason dialogs (reject / cancel / reverse) */}
      <ReasonDialog
        open={reasonAction === 'reject'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Reject transaction"
        description="A rejection comment is mandatory and is kept in the approval history."
        reasonLabel="Rejection comment"
        confirmLabel="Reject"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'reject', reason })}
      />
      <ReasonDialog
        open={reasonAction === 'cancel'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Cancel transaction"
        description="Canceling stops this document before posting. This cannot be undone."
        confirmLabel="Cancel transaction"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'cancel', reason })}
      />
      <ReasonDialog
        open={reasonAction === 'reverse'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Reverse posted transaction"
        description="Creates and posts a linked opposite-entry reversal. The original document is never edited."
        confirmLabel="Reverse"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'reverse', reason })}
      />
    </>
  );
}
