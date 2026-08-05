'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, PackageCheck, Plus, Save, Trash2 } from 'lucide-react';
import { TrackingMethod } from '@gemerp/shared';
import { getErrorMessage, isApiClientError, type ApiClientError } from '@/lib/api';
import {
  createGoodsReceipt,
  getItem,
  getPurchaseOrder,
  postGoodsReceipt,
  type GoodsReceiptCreateBody,
  type GoodsReceiptLineInput,
} from '@/lib/endpoints';
import { useIdempotencyKey } from '@/lib/idempotency';
import {
  formatQuantity,
  itemRefLabel,
  poDestinationWarehouse,
  poLineOutstanding,
  purchaseOrderNumber,
  supplierRefLabel,
  type Item,
  type PurchaseOrderLine,
} from '@/lib/types';
import { RECEIVABLE_PO_STATUSES } from '@/lib/status-maps';
import { cn, humanize } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { LocationSelect } from '@/components/inventory/pickers';
import { poStatusBadge } from '@/components/procurement/badges';

/* ------------------------------ Entry state -------------------------------- */

interface LotRowDraft {
  key: string;
  lotNo: string;
  expiryDate: string;
  qty: string;
}

interface LineEntry {
  include: boolean;
  quantity: string;
  serials: string[];
  lots: LotRowDraft[];
  locationId: string;
}

let lotKeyCounter = 1;

function newLotRow(qty: string): LotRowDraft {
  return { key: `lot-${lotKeyCounter++}`, lotNo: '', expiryDate: '', qty };
}

function lineTracking(item: Item | null | undefined, line: PurchaseOrderLine): string {
  const method = item?.trackingMethod ?? line.item?.trackingMethod;
  if (method) return String(method);
  if (item?.requiresSerialNumber) return TrackingMethod.SERIAL;
  if (item?.isLotTracked) return TrackingMethod.LOT;
  return TrackingMethod.QUANTITY;
}

/** Resize the serial slot list to `count`, preserving already-typed values. */
function resizeSerials(serials: string[], count: number): string[] {
  if (count <= 0) return [];
  if (serials.length === count) return serials;
  if (serials.length > count) return serials.slice(0, count);
  return [...serials, ...Array.from({ length: count - serials.length }, () => '')];
}

/** Split pasted text on newlines, commas, semicolons, and tabs. */
function splitPastedSerials(text: string): string[] {
  return text
    .split(/[\n\r,;\t]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/* --------------------------------- Screen ---------------------------------- */

export function ReceivePage({ poId }: { poId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const poQuery = useQuery({
    queryKey: ['purchase-orders', 'detail', poId],
    queryFn: ({ signal }) => getPurchaseOrder(poId, signal),
  });
  const po = poQuery.data;

  // Full item payloads so tracking flags (serial/lot/expiry) are authoritative.
  const itemIds = React.useMemo(() => {
    if (!po?.lines) return [] as string[];
    return Array.from(new Set(po.lines.map((line) => line.itemId).filter(Boolean)));
  }, [po]);
  const itemQueries = useQueries({
    queries: itemIds.map((itemId) => ({
      queryKey: ['items', 'detail', itemId],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getItem(itemId, signal),
      staleTime: 60_000,
    })),
  });
  const itemById = React.useMemo(() => {
    const map = new Map<string, Item>();
    for (const query of itemQueries) {
      if (query.data) map.set(query.data.id, query.data);
    }
    return map;
  }, [itemQueries]);
  // Wait for tracking flags before seeding serial/lot capture (errors tolerated
  // — those lines fall back to the PO line's embedded item ref).
  const itemsSettled = itemQueries.every((query) => query.isSuccess || query.isError);

  const [receivedDate, setReceivedDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryRefNo, setDeliveryRefNo] = React.useState('');
  const [invoiceRefNo, setInvoiceRefNo] = React.useState('');
  const [entries, setEntries] = React.useState<Record<string, LineEntry>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [lineErrors, setLineErrors] = React.useState<Record<string, string>>({});
  /** Draft created by a previous attempt — reused so retries never duplicate. */
  const [draftId, setDraftId] = React.useState<string | null>(null);
  const hydratedRef = React.useRef(false);

  const postKey = useIdempotencyKey(poId);

  // Seed one entry per open line (default received = outstanding).
  React.useEffect(() => {
    if (!po || !itemsSettled || hydratedRef.current) return;
    hydratedRef.current = true;
    const seeded: Record<string, LineEntry> = {};
    for (const line of po.lines ?? []) {
      if (!line.id) continue;
      const outstanding = poLineOutstanding(line);
      if (outstanding <= 0) continue;
      const qty = String(outstanding);
      const item = itemById.get(line.itemId);
      const tracking = lineTracking(item, line);
      seeded[line.id] = {
        include: true,
        quantity: qty,
        serials:
          tracking === TrackingMethod.SERIAL
            ? resizeSerials([], Math.floor(outstanding))
            : [],
        lots: tracking === TrackingMethod.LOT ? [newLotRow(qty)] : [],
        locationId: '',
      };
    }
    setEntries(seeded);
  }, [po, itemsSettled, itemById]);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
    queryClient.invalidateQueries({ queryKey: ['goods-receipts'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-history'] });
    queryClient.invalidateQueries({ queryKey: ['stock-balances'] });
    queryClient.invalidateQueries({ queryKey: ['stock-ledger'] });
    queryClient.invalidateQueries({ queryKey: ['lots'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  }, [queryClient]);

  /** Map server error details onto lines (over-receipt, serial issues, …). */
  const applyServerLineErrors = React.useCallback(
    (error: ApiClientError, sentPoLineIds: string[]) => {
      const next: Record<string, string> = {};
      for (const detail of error.details ?? []) {
        const field = detail.field ?? '';
        const indexMatch = /^lines[.[](\d+)/.exec(field);
        if (indexMatch) {
          const poLineId = sentPoLineIds[Number(indexMatch[1])];
          if (poLineId && !(poLineId in next)) next[poLineId] = detail.message;
          continue;
        }
        const byId = sentPoLineIds.find((lineId) => field.includes(lineId));
        if (byId && !(byId in next)) next[byId] = detail.message;
      }
      setLineErrors(next);
    },
    [],
  );

  const saveMutation = useMutation({
    mutationFn: async (input: { post: boolean }) => {
      const { body, sentPoLineIds } = buildBody();
      let receiptId = draftId;
      if (!receiptId) {
        try {
          const created = await createGoodsReceipt(body);
          receiptId = created.id;
          setDraftId(created.id);
        } catch (error) {
          if (isApiClientError(error)) applyServerLineErrors(error, sentPoLineIds);
          throw error;
        }
      }
      if (!input.post) return { receiptId, posted: false as const };
      try {
        const posted = await postGoodsReceipt(receiptId, postKey.key);
        return { receiptId: posted.id ?? receiptId, posted: true as const };
      } catch (error) {
        if (isApiClientError(error)) applyServerLineErrors(error, sentPoLineIds);
        throw error;
      }
    },
    onSuccess: (result) => {
      setFormError(null);
      setLineErrors({});
      if (result.posted) {
        postKey.rotate();
        toast({
          title: 'Receipt posted',
          description: 'Stock updated, serialized assets and lots created, PO status refreshed.',
          variant: 'success',
        });
        invalidate();
        router.push(`/procurement/purchase-orders/${poId}`);
      } else {
        toast({
          title: 'Draft receipt saved',
          description: 'Stock moves only when the receipt is posted.',
          variant: 'success',
        });
        invalidate();
        router.push(`/procurement/receipts/${result.receiptId}`);
      }
    },
    onError: (error) => setFormError(getErrorMessage(error)),
  });

  if (poQuery.isPending || (po && !itemsSettled)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (poQuery.isError || !po) {
    return <ErrorState error={poQuery.error} onRetry={() => poQuery.refetch()} />;
  }

  const warehouse = poDestinationWarehouse(po);
  const warehouseId = po.destinationWarehouseId ?? warehouse?.id ?? '';
  const receivable = RECEIVABLE_PO_STATUSES.includes(po.status);
  const openLines = (po.lines ?? []).filter((line) => line.id && poLineOutstanding(line) > 0);
  const doneLines = (po.lines ?? []).filter((line) => !line.id || poLineOutstanding(line) <= 0);

  function updateEntry(poLineId: string, patch: Partial<LineEntry>) {
    setEntries((current) => {
      const existing = current[poLineId];
      if (!existing) return current;
      return { ...current, [poLineId]: { ...existing, ...patch } };
    });
  }

  function buildBody(): { body: GoodsReceiptCreateBody; sentPoLineIds: string[] } {
    const sentPoLineIds: string[] = [];
    const lines: GoodsReceiptLineInput[] = [];
    for (const line of openLines) {
      const entry = entries[line.id as string];
      if (!entry || !entry.include) continue;
      const quantity = Number(entry.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      const item = itemById.get(line.itemId);
      const tracking = lineTracking(item, line);
      const input: GoodsReceiptLineInput = {
        poLineId: line.id as string,
        quantity: entry.quantity,
        uomId: line.uomId ?? line.uom?.id ?? '',
      };
      if (tracking === TrackingMethod.SERIAL) {
        input.serials = entry.serials.map((serial) => serial.trim()).filter(Boolean);
      }
      if (tracking === TrackingMethod.LOT) {
        input.lots = entry.lots
          .filter((lot) => Number(lot.qty) > 0)
          .map((lot) => ({
            lotNo: lot.lotNo.trim() || undefined,
            expiryDate: lot.expiryDate || undefined,
            qty: lot.qty,
          }));
      }
      if (entry.locationId) input.locationId = entry.locationId;
      sentPoLineIds.push(line.id as string);
      lines.push(input);
    }
    return {
      body: {
        purchaseOrderId: po!.id,
        receivedDate,
        deliveryRefNo: deliveryRefNo.trim() || undefined,
        invoiceRefNo: invoiceRefNo.trim() || undefined,
        lines,
      },
      sentPoLineIds,
    };
  }

  function validate(): string | null {
    if (!receivedDate) return 'Received date is required.';
    let anyLine = false;
    for (const [index, line] of openLines.entries()) {
      const entry = entries[line.id as string];
      if (!entry || !entry.include) continue;
      const label = `Line ${line.lineNumber ?? index + 1}`;
      const quantity = Number(entry.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `${label}: received quantity must be greater than zero (or untick the line).`;
      }
      anyLine = true;
      const item = itemById.get(line.itemId);
      const tracking = lineTracking(item, line);
      if (tracking === TrackingMethod.SERIAL) {
        if (!Number.isInteger(quantity)) {
          return `${label}: serialized items must be received in whole units.`;
        }
        const serials = entry.serials.map((serial) => serial.trim()).filter(Boolean);
        if (serials.length !== quantity) {
          return `${label}: enter ${quantity} serial number${quantity === 1 ? '' : 's'} (${serials.length} provided).`;
        }
        if (new Set(serials).size !== serials.length) {
          return `${label}: duplicate serial numbers entered.`;
        }
      }
      if (tracking === TrackingMethod.LOT) {
        const rows = entry.lots.filter((lot) => lot.lotNo.trim() || lot.expiryDate || Number(lot.qty) > 0);
        if (rows.length === 0) return `${label}: add at least one lot allocation.`;
        let sum = 0;
        for (const lot of rows) {
          const lotQty = Number(lot.qty);
          if (!Number.isFinite(lotQty) || lotQty <= 0) {
            return `${label}: every lot allocation needs a quantity above zero.`;
          }
          if (item?.isExpiryTracked && !lot.expiryDate) {
            return `${label}: expiry date is required for this expiry-tracked item.`;
          }
          sum += lotQty;
        }
        if (Math.abs(sum - quantity) > 1e-9) {
          return `${label}: lot quantities (${sum}) must add up to the received quantity (${quantity}).`;
        }
      }
    }
    if (!anyLine) return 'Enter a received quantity on at least one line.';
    return null;
  }

  const handleSave = (post: boolean) => {
    setFormError(null);
    setLineErrors({});
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    saveMutation.mutate({ post });
  };

  if (!receivable) {
    return (
      <>
        <PageHeader
          title={`Receive against ${purchaseOrderNumber(po)}`}
          description={`Purchase order · ${supplierRefLabel(po.supplier)}`}
          actions={
            <Link href={`/procurement/purchase-orders/${po.id}`} className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> Back to PO
            </Link>
          }
        />
        <Card>
          <CardContent className="flex items-center gap-3 pt-5">
            {poStatusBadge(po.status)}
            <p className="text-sm text-muted-foreground">
              Goods can only be received against an approved or partially received purchase order — this
              one is {humanize(po.status).toLowerCase()}.
            </p>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`Receive against ${purchaseOrderNumber(po)}`}
        description={`${supplierRefLabel(po.supplier)} → ${warehouse ? (warehouse.name ?? warehouse.code ?? '') : 'destination warehouse'}`}
        actions={
          <Link href={`/procurement/purchase-orders/${po.id}`} className={buttonVariants({ variant: 'ghost' })}>
            <ArrowLeft aria-hidden /> Back to PO
          </Link>
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Delivery details</CardTitle>
          <CardDescription>
            Stock, serialized assets, and lots are created only when the receipt is posted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormError message={formError} className="mb-3" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Received date" htmlFor="gr-date" required>
              <Input
                id="gr-date"
                type="date"
                value={receivedDate}
                onChange={(event) => setReceivedDate(event.target.value)}
              />
            </FormField>
            <FormField label="Supplier DR reference" htmlFor="gr-dr" hint="Delivery receipt number.">
              <Input
                id="gr-dr"
                value={deliveryRefNo}
                onChange={(event) => setDeliveryRefNo(event.target.value)}
              />
            </FormField>
            <FormField label="Supplier invoice reference" htmlFor="gr-invoice">
              <Input
                id="gr-invoice"
                value={invoiceRefNo}
                onChange={(event) => setInvoiceRefNo(event.target.value)}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
          <CardDescription>
            Received quantity defaults to the outstanding amount. Untick a line to skip it in this
            delivery.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {openLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every line on this purchase order is already fully received.
            </p>
          ) : null}

          {openLines.map((line, index) => {
            const entry = entries[line.id as string];
            if (!entry) return null;
            const item = itemById.get(line.itemId);
            const tracking = lineTracking(item, line);
            const outstanding = poLineOutstanding(line);
            const quantity = Number(entry.quantity);
            const overReceipt = Number.isFinite(quantity) && quantity > outstanding;
            const serverError = lineErrors[line.id as string];

            return (
              <div
                key={line.id}
                className={cn(
                  'space-y-3 rounded-md border p-3',
                  serverError ? 'border-destructive/50 bg-destructive/5' : undefined,
                  !entry.include ? 'opacity-60' : undefined,
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <label className="flex items-start gap-2">
                    <Checkbox
                      checked={entry.include}
                      onChange={(event) => updateEntry(line.id as string, { include: event.target.checked })}
                      aria-label={`Include line ${line.lineNumber ?? index + 1}`}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-semibold">
                        Line {line.lineNumber ?? index + 1} ·{' '}
                        {itemRefLabel(item ?? line.item ?? { id: line.itemId })}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        Ordered {formatQuantity(line.quantity)} {line.uom?.code ?? ''} · received{' '}
                        {formatQuantity(line.receivedQuantity ?? 0)} · outstanding{' '}
                        <span className="font-medium text-foreground">{formatQuantity(outstanding)}</span>
                      </span>
                    </span>
                  </label>
                  {tracking !== TrackingMethod.QUANTITY ? (
                    <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {tracking === TrackingMethod.SERIAL ? 'Serialized' : 'Lot-tracked'}
                    </span>
                  ) : null}
                </div>

                {serverError ? (
                  <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
                    <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {serverError}
                  </p>
                ) : null}

                {entry.include ? (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FormField
                        label={`Received quantity (${line.uom?.code ?? 'units'})`}
                        htmlFor={`gr-qty-${line.id}`}
                        required
                        hint={
                          overReceipt
                            ? 'Exceeds the outstanding quantity — the server rejects this unless an over-receipt tolerance applies.'
                            : undefined
                        }
                      >
                        <Input
                          id={`gr-qty-${line.id}`}
                          type="number"
                          min="0"
                          step={tracking === TrackingMethod.SERIAL ? '1' : 'any'}
                          inputMode="decimal"
                          value={entry.quantity}
                          aria-invalid={overReceipt || undefined}
                          className={overReceipt ? 'border-warning' : undefined}
                          onChange={(event) => {
                            const nextQty = event.target.value;
                            const patch: Partial<LineEntry> = { quantity: nextQty };
                            if (tracking === TrackingMethod.SERIAL) {
                              const count = Math.max(Math.floor(Number(nextQty) || 0), 0);
                              patch.serials = resizeSerials(entry.serials, count);
                            }
                            updateEntry(line.id as string, patch);
                          }}
                        />
                      </FormField>
                      <FormField
                        label="Destination location"
                        htmlFor={`gr-loc-${line.id}`}
                        hint="Optional — defaults to the warehouse receiving location."
                      >
                        <LocationSelect
                          id={`gr-loc-${line.id}`}
                          warehouseId={warehouseId}
                          value={entry.locationId}
                          onChange={(locationId) => updateEntry(line.id as string, { locationId })}
                          allowEmptyLabel="Warehouse default"
                        />
                      </FormField>
                    </div>

                    {tracking === TrackingMethod.SERIAL ? (
                      <div className="space-y-2 rounded-md bg-muted/40 p-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Serial numbers ({entry.serials.length} of{' '}
                          {Math.max(Math.floor(Number(entry.quantity) || 0), 0)} required)
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Paste a list into any field — values split on newlines or commas.
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {entry.serials.map((serial, serialIndex) => (
                            <Input
                              key={serialIndex}
                              value={serial}
                              placeholder={`Serial ${serialIndex + 1}`}
                              aria-label={`Line ${line.lineNumber ?? index + 1} serial ${serialIndex + 1}`}
                              className="font-mono"
                              onChange={(event) => {
                                const next = [...entry.serials];
                                next[serialIndex] = event.target.value;
                                updateEntry(line.id as string, { serials: next });
                              }}
                              onPaste={(event) => {
                                const text = event.clipboardData.getData('text');
                                const tokens = splitPastedSerials(text);
                                if (tokens.length <= 1) return;
                                event.preventDefault();
                                const next = [...entry.serials];
                                for (const [offset, token] of tokens.entries()) {
                                  const target = serialIndex + offset;
                                  if (target >= next.length) break;
                                  next[target] = token;
                                }
                                updateEntry(line.id as string, { serials: next });
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {tracking === TrackingMethod.LOT ? (
                      <div className="space-y-2 rounded-md bg-muted/40 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Lot allocations (must add up to the received quantity)
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              updateEntry(line.id as string, {
                                lots: [...entry.lots, newLotRow('')],
                              })
                            }
                          >
                            <Plus aria-hidden /> Add lot
                          </Button>
                        </div>
                        {entry.lots.map((lot, lotIndex) => (
                          <div key={lot.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_8rem_auto]">
                            <Input
                              value={lot.lotNo}
                              placeholder="Lot number (blank = auto)"
                              aria-label={`Line ${line.lineNumber ?? index + 1} lot ${lotIndex + 1} number`}
                              className="font-mono"
                              onChange={(event) => {
                                const lots = entry.lots.map((row) =>
                                  row.key === lot.key ? { ...row, lotNo: event.target.value } : row,
                                );
                                updateEntry(line.id as string, { lots });
                              }}
                            />
                            <Input
                              type="date"
                              value={lot.expiryDate}
                              aria-label={`Line ${line.lineNumber ?? index + 1} lot ${lotIndex + 1} expiry date`}
                              onChange={(event) => {
                                const lots = entry.lots.map((row) =>
                                  row.key === lot.key ? { ...row, expiryDate: event.target.value } : row,
                                );
                                updateEntry(line.id as string, { lots });
                              }}
                            />
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={lot.qty}
                              placeholder="Qty"
                              aria-label={`Line ${line.lineNumber ?? index + 1} lot ${lotIndex + 1} quantity`}
                              onChange={(event) => {
                                const lots = entry.lots.map((row) =>
                                  row.key === lot.key ? { ...row, qty: event.target.value } : row,
                                );
                                updateEntry(line.id as string, { lots });
                              }}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={entry.lots.length <= 1}
                              aria-label={`Remove lot ${lotIndex + 1}`}
                              onClick={() =>
                                updateEntry(line.id as string, {
                                  lots: entry.lots.filter((row) => row.key !== lot.key),
                                })
                              }
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          </div>
                        ))}
                        {item?.isExpiryTracked ? (
                          <p className="text-xs text-muted-foreground">
                            Expiry date is required — this item is expiry-tracked.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}

          {doneLines.length > 0 ? (
            <div className="rounded-md border border-dashed p-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fully received lines
              </p>
              <ul className="space-y-0.5 text-sm text-muted-foreground">
                {doneLines.map((line, index) => (
                  <li key={line.id ?? index}>
                    {itemRefLabel(line.item ?? { id: line.itemId })} — {formatQuantity(line.quantity)}{' '}
                    {line.uom?.code ?? ''} received in full
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {openLines.length > 0 ? (
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => handleSave(false)}
                disabled={saveMutation.isPending || !!draftId}
                loading={saveMutation.isPending && saveMutation.variables?.post === false}
              >
                <Save aria-hidden /> Save draft only
              </Button>
              <Button
                onClick={() => handleSave(true)}
                loading={saveMutation.isPending && saveMutation.variables?.post !== false}
              >
                <PackageCheck aria-hidden /> {draftId ? 'Retry post' : 'Save & post receipt'}
              </Button>
            </div>
          ) : null}
          {draftId ? (
            <p className="text-xs text-muted-foreground">
              Draft receipt saved — posting retries reuse the same draft and idempotency key, so no
              duplicate stock movement can occur.{' '}
              <Link href={`/procurement/receipts/${draftId}`} className="text-primary hover:underline">
                Open the draft
              </Link>
              .
            </p>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
