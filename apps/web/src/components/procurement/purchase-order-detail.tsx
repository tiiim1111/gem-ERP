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
  Lock,
  MoveRight,
  PackageCheck,
  Pencil,
  Send,
  ThumbsDown,
} from 'lucide-react';
import { PERMISSIONS, PurchaseOrderStatus } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  approvePurchaseOrder,
  ATTACHMENT_RESOURCE_TYPES,
  cancelPurchaseOrder,
  closePurchaseOrder,
  fetchPurchaseOrderPdf,
  getPurchaseOrder,
  listPurchaseOrderReceipts,
  rejectPurchaseOrder,
  submitPurchaseOrder,
  unwrapList,
} from '@/lib/endpoints';
import {
  decimalValue,
  formatMoney,
  formatQuantity,
  goodsReceiptDate,
  goodsReceiptNumber,
  itemRefLabel,
  poCurrency,
  poDestinationWarehouse,
  poExpectedDate,
  poGrandTotal,
  poLineDiscount,
  poLineOutstanding,
  poLineTax,
  poLineTotal,
  purchaseOrderApprovals,
  purchaseOrderNumber,
  refLabel,
  supplierRefLabel,
  type PurchaseOrder,
} from '@/lib/types';
import {
  PROCUREMENT_COST_PERMISSIONS,
  PURCHASE_ORDER_STEPS,
  purchaseOrderActionPermissions,
  purchaseOrderActionsFor,
  type PurchaseOrderAction,
} from '@/lib/status-maps';
import { cn, formatDate, formatDateTime, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { AttachmentsPanel } from '@/components/attachments/attachments-panel';
import { poStatusBadge, receiptStatusBadge } from '@/components/procurement/badges';
import { PrintDocumentButton } from '@/components/reports/print-document-button';

function PoStepper({ po }: { po: PurchaseOrder }) {
  const terminalBad = po.status === PurchaseOrderStatus.CANCELED || po.status === 'REJECTED';
  const closed = po.status === PurchaseOrderStatus.CLOSED;
  const currentIndex = closed
    ? PURCHASE_ORDER_STEPS.length - 1
    : PURCHASE_ORDER_STEPS.findIndex((step) => step.status === po.status);

  if (terminalBad) {
    return (
      <div className="flex items-center gap-2">
        {poStatusBadge(po.status)}
        <span className="text-sm text-muted-foreground">
          {po.status === PurchaseOrderStatus.CANCELED
            ? 'This purchase order was canceled. Corrections require a new PO.'
            : 'This purchase order was rejected by an approver.'}
        </span>
      </div>
    );
  }

  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Purchase order progress">
      {PURCHASE_ORDER_STEPS.map((step, index) => {
        const done = currentIndex > index || (closed && index < PURCHASE_ORDER_STEPS.length - 1);
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
            {index < PURCHASE_ORDER_STEPS.length - 1 ? (
              <MoveRight className="mx-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ReceiptsCard({ poId }: { poId: string }) {
  const receiptsQuery = useQuery({
    queryKey: ['goods-receipts', 'by-po', poId],
    queryFn: ({ signal }) => listPurchaseOrderReceipts(poId, signal),
  });
  const receipts = receiptsQuery.data ? unwrapList(receiptsQuery.data) : [];

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Goods receipts</CardTitle>
        <CardDescription>Receipts recorded against this purchase order.</CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {receiptsQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : receiptsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={receiptsQuery.error} onRetry={() => receiptsQuery.refetch()} />
          </div>
        ) : receipts.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No receipts yet"
            description="Nothing has been received against this PO."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Receipt date</TableHead>
                <TableHead className="hidden md:table-cell">Supplier ref</TableHead>
                <TableHead className="hidden lg:table-cell">Posted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell>
                    <Link
                      href={`/procurement/receipts/${receipt.id}`}
                      className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {goodsReceiptNumber(receipt)}
                    </Link>
                  </TableCell>
                  <TableCell>{receiptStatusBadge(receipt.status)}</TableCell>
                  <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                    {formatDate(goodsReceiptDate(receipt))}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {receipt.supplierReference ?? receipt.deliveryRefNo ?? '—'}
                  </TableCell>
                  <TableCell className="hidden text-sm tabular-nums text-muted-foreground lg:table-cell">
                    {receipt.postedAt ? formatDateTime(receipt.postedAt) : 'Not posted'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function PurchaseOrderDetail({ poId }: { poId: string }) {
  const queryClient = useQueryClient();
  const { canAny, can } = useSession();
  const { toast } = useToast();

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [confirmAction, setConfirmAction] = React.useState<'submit' | 'approve' | 'close' | null>(null);
  const [reasonAction, setReasonAction] = React.useState<'reject' | 'cancel' | 'close-short' | null>(null);

  const poQuery = useQuery({
    queryKey: ['purchase-orders', 'detail', poId],
    queryFn: ({ signal }) => getPurchaseOrder(poId, signal),
  });
  const po = poQuery.data;

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-history'] });
  }, [queryClient]);

  const handleActionError = React.useCallback(
    (error: unknown) => {
      if (isApiClientError(error)) {
        if (error.code === 'SELF_APPROVAL_FORBIDDEN') {
          setActionError(
            'You cannot approve a purchase order you submitted yourself — a different approver must decide on it.',
          );
          return;
        }
        if (error.code === 'INVALID_STATE_TRANSITION') {
          toast({
            title: 'Status changed',
            description: 'This purchase order was updated elsewhere. Reloading the latest state.',
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
    mutationFn: async (input: {
      action: Exclude<PurchaseOrderAction, 'edit' | 'receive'>;
      reason?: string;
    }) => {
      switch (input.action) {
        case 'submit':
          return submitPurchaseOrder(poId);
        case 'approve':
          return approvePurchaseOrder(poId);
        case 'reject':
          return rejectPurchaseOrder(poId, input.reason ?? '');
        case 'cancel':
          return cancelPurchaseOrder(poId, input.reason ?? '');
        case 'close':
          return closePurchaseOrder(poId, input.reason);
      }
    },
    onSuccess: (_result, input) => {
      setActionError(null);
      const doneLabels: Record<string, string> = {
        submit: 'submitted',
        approve: 'approved',
        reject: 'rejected — back to draft for revision',
        cancel: 'canceled',
        close: 'closed',
      };
      toast({ title: `Purchase order ${doneLabels[input.action]}`, variant: 'success' });
      invalidate();
    },
    onError: handleActionError,
  });

  if (poQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (poQuery.isError || !po) {
    return <ErrorState error={poQuery.error} onRetry={() => poQuery.refetch()} />;
  }

  const canViewCost = canAny(PROCUREMENT_COST_PERMISSIONS);
  const canViewReceipts = can(PERMISSIONS.procurementReceipt.view);
  const actions = purchaseOrderActionsFor(po.status).filter((action) =>
    canAny(purchaseOrderActionPermissions(action)),
  );
  const approvals = purchaseOrderApprovals(po);
  const warehouse = poDestinationWarehouse(po);
  const showCosts =
    canViewCost && (po.lines ?? []).some((line) => line.unitPrice !== undefined && line.unitPrice !== null);
  const closeNeedsReason = po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED;

  return (
    <>
      <PageHeader
        title={purchaseOrderNumber(po)}
        description={`Purchase order · ${supplierRefLabel(po.supplier)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/procurement/purchase-orders" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All POs
            </Link>
            <PrintDocumentButton
              fetchDocument={() => fetchPurchaseOrderPdf(po.id)}
              fileName={`${purchaseOrderNumber(po)}.pdf`}
            />
            {actions.includes('edit') ? (
              <Link
                href={`/procurement/purchase-orders/${po.id}/edit`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <Pencil aria-hidden /> Edit draft
              </Link>
            ) : null}
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
            {actions.includes('receive') ? (
              <Link
                href={`/procurement/purchase-orders/${po.id}/receive`}
                className={buttonVariants({})}
              >
                <PackageCheck aria-hidden /> Receive
              </Link>
            ) : null}
            {actions.includes('close') ? (
              <Button
                variant="outline"
                onClick={() =>
                  closeNeedsReason ? setReasonAction('close-short') : setConfirmAction('close')
                }
              >
                <Lock aria-hidden /> Close
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
          <PoStepper po={po} />
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <span className="text-muted-foreground">Supplier</span>
              <span className="text-right font-medium">
                {po.supplier ? (
                  <Link href={`/suppliers/${po.supplier.id}`} className="hover:underline">
                    {supplierRefLabel(po.supplier)}
                  </Link>
                ) : (
                  '—'
                )}
              </span>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <span className="text-muted-foreground">Ordering branch</span>
              <span>{po.branch ? refLabel(po.branch) : '—'}</span>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <span className="text-muted-foreground">Destination warehouse</span>
              <span>{warehouse ? refLabel(warehouse) : '—'}</span>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <span className="text-muted-foreground">Order date</span>
              <span className="tabular-nums">{formatDate(po.orderDate)}</span>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <span className="text-muted-foreground">Expected delivery</span>
              <span className="tabular-nums">{formatDate(poExpectedDate(po))}</span>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <span className="text-muted-foreground">Currency</span>
              <span>{poCurrency(po)}</span>
            </div>
            {po.terms ? (
              <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                <span className="text-muted-foreground">Terms</span>
                <span className="text-right">{po.terms}</span>
              </div>
            ) : null}
            {canViewCost && poGrandTotal(po) !== null ? (
              <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
                <span className="text-muted-foreground">Total</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatMoney(poGrandTotal(po))}
                </span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            {po.createdAt ? (
              <span>
                Created {formatDateTime(po.createdAt)}
                {po.createdBy?.displayName ? ` · ${po.createdBy.displayName}` : ''}
              </span>
            ) : null}
            {po.submittedAt ? <span>Submitted {formatDateTime(po.submittedAt)}</span> : null}
            {po.approvedAt ? (
              <span>
                Approved {formatDateTime(po.approvedAt)}
                {po.approvedBy?.displayName ? ` · ${po.approvedBy.displayName}` : ''}
              </span>
            ) : null}
            {po.canceledAt ? <span>Canceled {formatDateTime(po.canceledAt)}</span> : null}
            {po.closedAt ? <span>Closed {formatDateTime(po.closedAt)}</span> : null}
          </div>
          {po.notes ? <p className="text-sm text-muted-foreground">{po.notes}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>Ordered vs received vs outstanding per line.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {(po.lines ?? []).length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">No lines on this purchase order.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Received</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  {showCosts ? (
                    <>
                      <TableHead className="hidden text-right md:table-cell">Unit price</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">Discount</TableHead>
                      <TableHead className="hidden text-right lg:table-cell">Tax</TableHead>
                      <TableHead className="text-right">Line total</TableHead>
                    </>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(po.lines ?? []).map((line, index) => {
                  const outstanding = poLineOutstanding(line);
                  return (
                    <TableRow key={line.id ?? index}>
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
                        {formatQuantity(line.quantity)} {line.uom?.code ?? ''}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                        {formatQuantity(line.receivedQuantity ?? 0)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono text-xs tabular-nums',
                          outstanding > 0 && decimalValue(line.receivedQuantity) > 0
                            ? 'font-semibold text-warning'
                            : undefined,
                        )}
                      >
                        {formatQuantity(outstanding)}
                      </TableCell>
                      {showCosts ? (
                        <>
                          <TableCell className="hidden text-right font-mono text-xs tabular-nums md:table-cell">
                            {formatMoney(line.unitPrice)}
                          </TableCell>
                          <TableCell className="hidden text-right font-mono text-xs tabular-nums lg:table-cell">
                            {formatMoney(poLineDiscount(line))}
                          </TableCell>
                          <TableCell className="hidden text-right font-mono text-xs tabular-nums lg:table-cell">
                            {formatMoney(poLineTax(line))}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {formatMoney(poLineTotal(line))}
                          </TableCell>
                        </>
                      ) : null}
                    </TableRow>
                  );
                })}
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

      {canViewReceipts ? <ReceiptsCard poId={po.id} /> : null}

      {can(PERMISSIONS.attachment.view) ? (
        <AttachmentsPanel
          resourceType={ATTACHMENT_RESOURCE_TYPES.purchaseOrder}
          resourceId={po.id}
          managePermissions={[PERMISSIONS.procurementPo.update]}
          description="Quotations, supplier confirmations, and other order documents."
        />
      ) : null}

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmAction === 'submit'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Submit purchase order"
        description="Submits this draft into the approval workflow — or straight to Approved when no workflow applies to this branch/amount."
        confirmLabel="Submit"
        onConfirm={() => runAction.mutateAsync({ action: 'submit' })}
      />
      <ConfirmDialog
        open={confirmAction === 'approve'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Approve purchase order"
        description="Approved POs are immutable and become receivable. You cannot approve a PO you submitted yourself."
        confirmLabel="Approve"
        onConfirm={() => runAction.mutateAsync({ action: 'approve' })}
      />
      <ConfirmDialog
        open={confirmAction === 'close'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        title="Close purchase order"
        description="All lines are fully received. Closing is final — a closed PO cannot be reopened."
        confirmLabel="Close PO"
        onConfirm={() => runAction.mutateAsync({ action: 'close' })}
      />

      {/* Reason dialogs */}
      <ReasonDialog
        open={reasonAction === 'reject'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Reject purchase order"
        description="A rejection comment is mandatory. The PO returns to Draft and can be revised and resubmitted."
        reasonLabel="Rejection comment"
        confirmLabel="Reject"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'reject', reason })}
      />
      <ReasonDialog
        open={reasonAction === 'cancel'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Cancel purchase order"
        description="Cancellation is only possible before anything is received. This cannot be undone — corrections require a new PO."
        confirmLabel="Cancel PO"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'cancel', reason })}
      />
      <ReasonDialog
        open={reasonAction === 'close-short'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Close short"
        description="Outstanding quantities will be explicitly canceled. Closing is final — a closed PO cannot be reopened."
        reasonLabel="Reason for closing short"
        confirmLabel="Close PO"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'close', reason })}
      />
    </>
  );
}
