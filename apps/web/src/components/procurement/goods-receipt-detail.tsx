'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CircleAlert, Undo2, UploadCloud } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  ATTACHMENT_RESOURCE_TYPES,
  cancelGoodsReceipt,
  getGoodsReceipt,
  postGoodsReceipt,
  reverseGoodsReceipt,
} from '@/lib/endpoints';
import { useIdempotencyKey } from '@/lib/idempotency';
import {
  formatQuantity,
  goodsReceiptDate,
  goodsReceiptNumber,
  grLineLocation,
  grLineQuantity,
  grLineSerials,
  itemRefLabel,
  lotNumber,
  purchaseOrderNumber,
  refLabel,
  supplierRefLabel,
} from '@/lib/types';
import {
  goodsReceiptActionPermissions,
  goodsReceiptActionsFor,
  type GoodsReceiptAction,
} from '@/lib/status-maps';
import { formatDate, formatDateTime } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState } from '@/components/ui/error-state';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { AttachmentsPanel } from '@/components/attachments/attachments-panel';
import { receiptStatusBadge } from '@/components/procurement/badges';

export function GoodsReceiptDetail({ receiptId }: { receiptId: string }) {
  const queryClient = useQueryClient();
  const { can, canAny } = useSession();
  const { toast } = useToast();

  const [actionError, setActionError] = React.useState<string | null>(null);
  const [confirmPost, setConfirmPost] = React.useState(false);
  const [reasonAction, setReasonAction] = React.useState<'cancel' | 'reverse' | null>(null);

  const receiptQuery = useQuery({
    queryKey: ['goods-receipts', 'detail', receiptId],
    queryFn: ({ signal }) => getGoodsReceipt(receiptId, signal),
  });
  const receipt = receiptQuery.data;

  const postKey = useIdempotencyKey(receiptId);
  const reverseKey = useIdempotencyKey(receiptId);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-history'] });
    queryClient.invalidateQueries({ queryKey: ['stock-balances'] });
    queryClient.invalidateQueries({ queryKey: ['stock-ledger'] });
    queryClient.invalidateQueries({ queryKey: ['lots'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  }, [queryClient]);

  const runAction = useMutation({
    mutationFn: async (input: { action: GoodsReceiptAction; reason?: string }) => {
      switch (input.action) {
        case 'post':
          return postGoodsReceipt(receiptId, postKey.key);
        case 'cancel':
          return cancelGoodsReceipt(receiptId, input.reason ?? '');
        case 'reverse':
          return reverseGoodsReceipt(receiptId, input.reason ?? '', reverseKey.key);
      }
    },
    onSuccess: (_result, input) => {
      if (input.action === 'post') postKey.rotate();
      if (input.action === 'reverse') reverseKey.rotate();
      setActionError(null);
      const labels: Record<GoodsReceiptAction, string> = {
        post: 'posted — stock and assets updated',
        cancel: 'canceled',
        reverse: 'reversed — offsetting entries created, PO outstanding restored',
      };
      toast({ title: `Receipt ${labels[input.action]}`, variant: 'success' });
      invalidate();
    },
    onError: (error) => {
      if (isApiClientError(error) && error.code === 'INVALID_STATE_TRANSITION') {
        toast({
          title: 'Status changed',
          description: 'This receipt was updated elsewhere. Reloading the latest state.',
          variant: 'destructive',
        });
        invalidate();
      }
      setActionError(getErrorMessage(error));
    },
  });

  if (receiptQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (receiptQuery.isError || !receipt) {
    return <ErrorState error={receiptQuery.error} onRetry={() => receiptQuery.refetch()} />;
  }

  const actions = goodsReceiptActionsFor(receipt.status).filter((action) =>
    canAny(goodsReceiptActionPermissions(action)),
  );
  const poId = receipt.purchaseOrderId ?? receipt.purchaseOrder?.id ?? null;

  return (
    <>
      <PageHeader
        title={goodsReceiptNumber(receipt)}
        description={`Goods receipt${receipt.purchaseOrder ? ` against ${purchaseOrderNumber(receipt.purchaseOrder)}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {poId ? (
              <Link
                href={`/procurement/purchase-orders/${poId}`}
                className={buttonVariants({ variant: 'ghost' })}
              >
                <ArrowLeft aria-hidden /> Purchase order
              </Link>
            ) : null}
            {actions.includes('post') ? (
              <Button onClick={() => setConfirmPost(true)}>
                <UploadCloud aria-hidden /> Post
              </Button>
            ) : null}
            {actions.includes('cancel') ? (
              <Button variant="outline" onClick={() => setReasonAction('cancel')}>
                <Ban aria-hidden /> Cancel
              </Button>
            ) : null}
            {actions.includes('reverse') ? (
              <Button variant="destructive" onClick={() => setReasonAction('reverse')}>
                <Undo2 aria-hidden /> Reverse
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
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Details</CardTitle>
          {receiptStatusBadge(receipt.status)}
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <dt className="text-muted-foreground">Purchase order</dt>
              <dd>
                {poId ? (
                  <Link
                    href={`/procurement/purchase-orders/${poId}`}
                    className="font-mono text-xs font-medium hover:underline"
                  >
                    {receipt.purchaseOrder ? purchaseOrderNumber(receipt.purchaseOrder) : 'View PO'}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <dt className="text-muted-foreground">Supplier</dt>
              <dd>{supplierRefLabel(receipt.supplier ?? receipt.purchaseOrder?.supplier)}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <dt className="text-muted-foreground">Receipt date</dt>
              <dd className="tabular-nums">{formatDate(goodsReceiptDate(receipt))}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <dt className="text-muted-foreground">Warehouse</dt>
              <dd>{receipt.warehouse ? refLabel(receipt.warehouse) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <dt className="text-muted-foreground">Supplier DR / invoice ref</dt>
              <dd>
                {[receipt.supplierReference ?? receipt.deliveryRefNo, receipt.invoiceRefNo]
                  .filter(Boolean)
                  .join(' / ') || '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-2 border-b py-1.5 text-sm">
              <dt className="text-muted-foreground">Posted</dt>
              <dd>
                {receipt.postedAt
                  ? `${formatDateTime(receipt.postedAt)}${receipt.postedBy?.displayName ? ` · ${receipt.postedBy.displayName}` : ''}`
                  : 'Not posted'}
              </dd>
            </div>
          </dl>
          {receipt.notes ? (
            <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{receipt.notes}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {(receipt.lines ?? []).length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted-foreground">No lines on this receipt.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="hidden md:table-cell">Serials / lot</TableHead>
                  <TableHead className="hidden lg:table-cell">Location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(receipt.lines ?? []).map((line, index) => {
                  const serials = grLineSerials(line);
                  const location = grLineLocation(line);
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
                          itemRefLabel(line.item ?? (line.itemId ? { id: line.itemId } : null))
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatQuantity(grLineQuantity(line))} {line.uom?.code ?? ''}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {serials.length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {serials.map((serial) => (
                              <Badge key={serial} variant="outline" className="font-mono text-[11px]">
                                {serial}
                              </Badge>
                            ))}
                          </span>
                        ) : line.lot ? (
                          <span className="font-mono text-xs">{lotNumber(line.lot)}</span>
                        ) : (line.lots ?? []).length > 0 ? (
                          <span className="flex flex-wrap gap-1">
                            {(line.lots ?? []).map((lot, lotIndex) => (
                              <Badge key={lot.id ?? lotIndex} variant="outline" className="font-mono text-[11px]">
                                {lot.lotNo ?? lot.lotNumber ?? 'auto'} ×{' '}
                                {formatQuantity(lot.qty ?? lot.quantity)}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {location ? refLabel(location) : 'Warehouse default'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {can(PERMISSIONS.attachment.view) ? (
        <AttachmentsPanel
          resourceType={ATTACHMENT_RESOURCE_TYPES.goodsReceipt}
          resourceId={receipt.id}
          managePermissions={[PERMISSIONS.procurementReceipt.update]}
          description="Delivery receipts, invoices, and inspection photos."
        />
      ) : null}

      <ConfirmDialog
        open={confirmPost}
        onOpenChange={setConfirmPost}
        title="Post goods receipt"
        description="Posting writes stock ledger entries, creates serialized assets and lot records, and updates the PO status. This cannot be edited afterwards — only reversed."
        confirmLabel="Post receipt"
        onConfirm={() => runAction.mutateAsync({ action: 'post' })}
      />
      <ReasonDialog
        open={reasonAction === 'cancel'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Cancel draft receipt"
        description="Cancels this draft before posting. No stock has moved."
        confirmLabel="Cancel receipt"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'cancel', reason })}
      />
      <ReasonDialog
        open={reasonAction === 'reverse'}
        onOpenChange={(open) => !open && setReasonAction(null)}
        title="Reverse posted receipt"
        description="Creates offsetting ledger entries and restores the PO outstanding quantities. The received stock must still be on hand."
        confirmLabel="Reverse"
        destructive
        onConfirm={(reason) => runAction.mutateAsync({ action: 'reverse', reason })}
      />
    </>
  );
}
