'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { PurchaseOrderStatus } from '@gemerp/shared';
import { getErrorMessage, isApiClientError, isVersionConflict } from '@/lib/api';
import {
  createPurchaseOrder,
  getItem,
  getPurchaseOrder,
  updatePurchaseOrder,
  type PurchaseOrderCreateBody,
  type PurchaseOrderLineInput,
} from '@/lib/endpoints';
import {
  decimalValue,
  formatMoney,
  poExpectedDate,
  poLineDiscount,
  poLineTax,
  purchaseOrderNumber,
  supplierRefLabel,
  type Item,
  type PurchaseOrder,
} from '@/lib/types';
import { PROCUREMENT_COST_PERMISSIONS } from '@/lib/status-maps';
import { convertToBase, itemUomChoices, useUomData } from '@/lib/uom';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { BranchSelect, ItemPicker, WarehouseSelect } from '@/components/inventory/pickers';
import { SupplierPicker } from '@/components/procurement/supplier-picker';

/* ------------------------------ Line drafts ------------------------------- */

interface LineDraft {
  key: string;
  item: Item | null;
  uomId: string;
  quantity: string;
  unitPrice: string;
  discount: string;
  tax: string;
}

let lineKeyCounter = 1;

function emptyLine(): LineDraft {
  return {
    key: `po-line-${lineKeyCounter++}`,
    item: null,
    uomId: '',
    quantity: '',
    unitPrice: '',
    discount: '',
    tax: '',
  };
}

/** qty × price − discount + tax; null when qty/price are not yet numeric. */
function lineTotal(line: LineDraft, canViewCost: boolean): number | null {
  const quantity = Number(line.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!canViewCost) return null;
  const price = Number(line.unitPrice);
  if (!Number.isFinite(price)) return null;
  const discount = line.discount === '' ? 0 : Number(line.discount);
  const tax = line.tax === '' ? 0 : Number(line.tax);
  if (!Number.isFinite(discount) || !Number.isFinite(tax)) return null;
  return quantity * price - discount + tax;
}

/* ------------------------------ Line editor ------------------------------- */

function PoLineEditor({
  line,
  index,
  canViewCost,
  serverError,
  onChange,
  onRemove,
  removable,
}: {
  line: LineDraft;
  index: number;
  canViewCost: boolean;
  serverError?: string;
  onChange: (next: LineDraft) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const uomData = useUomData();
  const uomOptions = line.item ? itemUomChoices(line.item, uomData) : [];
  const baseCode = line.item?.baseUom?.code ?? 'base units';

  const quantityNumber = Number(line.quantity);
  const basePreview =
    line.item && line.uomId && Number.isFinite(quantityNumber) && quantityNumber > 0
      ? convertToBase(line.item, line.uomId, quantityNumber, uomData)
      : null;
  const total = lineTotal(line, canViewCost);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">Line {index + 1}</p>
        <div className="flex items-center gap-3">
          {total !== null ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              Line total <span className="font-medium text-foreground">{formatMoney(total)}</span>
            </span>
          ) : null}
          {removable ? (
            <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove line ${index + 1}`}>
              <Trash2 aria-hidden /> Remove
            </Button>
          ) : null}
        </div>
      </div>

      <FormError message={serverError} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Item" htmlFor={`${line.key}-item`} required>
          <ItemPicker
            id={`${line.key}-item`}
            value={line.item?.id ?? null}
            selectedLabel={line.item?.name}
            onSelect={(item) =>
              onChange({
                ...line,
                item,
                uomId:
                  item?.purchaseUom?.id ??
                  item?.purchaseUomId ??
                  item?.baseUom?.id ??
                  item?.baseUomId ??
                  '',
                unitPrice:
                  line.unitPrice ||
                  (item?.lastPurchaseCost ?? item?.standardCost
                    ? String(decimalValue(item?.lastPurchaseCost ?? item?.standardCost))
                    : ''),
              })
            }
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="UOM"
            htmlFor={`${line.key}-uom`}
            required
            hint={line.item ? `Base UOM: ${baseCode}` : undefined}
          >
            <Select
              id={`${line.key}-uom`}
              value={line.uomId}
              onChange={(event) => onChange({ ...line, uomId: event.target.value })}
              disabled={!line.item}
            >
              <option value="">Select…</option>
              {uomOptions.map((uom) => (
                <option key={uom.id} value={uom.id}>
                  {uom.code}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Quantity"
            htmlFor={`${line.key}-qty`}
            required
            hint={
              basePreview !== null && line.uomId !== (line.item?.baseUom?.id ?? line.item?.baseUomId)
                ? `≈ ${Number(basePreview.toFixed(4))} ${baseCode}`
                : undefined
            }
          >
            <Input
              id={`${line.key}-qty`}
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={line.quantity}
              onChange={(event) => onChange({ ...line, quantity: event.target.value })}
            />
          </FormField>
        </div>
      </div>

      {canViewCost ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <FormField label="Unit price (PHP)" htmlFor={`${line.key}-price`} required>
            <Input
              id={`${line.key}-price`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={line.unitPrice}
              onChange={(event) => onChange({ ...line, unitPrice: event.target.value })}
            />
          </FormField>
          <FormField label="Discount (PHP)" htmlFor={`${line.key}-discount`}>
            <Input
              id={`${line.key}-discount`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={line.discount}
              onChange={(event) => onChange({ ...line, discount: event.target.value })}
            />
          </FormField>
          <FormField label="Tax (PHP)" htmlFor={`${line.key}-tax`}>
            <Input
              id={`${line.key}-tax`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={line.tax}
              onChange={(event) => onChange({ ...line, tax: event.target.value })}
            />
          </FormField>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- Editor ---------------------------------- */

/** Create a new PO, or edit an existing draft when `poId` is present. */
export function PurchaseOrderEditor({ poId }: { poId?: string }) {
  const isEdit = !!poId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canAny } = useSession();
  const { toast } = useToast();
  const canViewCost = canAny(PROCUREMENT_COST_PERMISSIONS);

  const [supplierId, setSupplierId] = React.useState<string | null>(null);
  const [supplierLabel, setSupplierLabel] = React.useState<string | null>(null);
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [orderDate, setOrderDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = React.useState('');
  const [terms, setTerms] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<LineDraft[]>([emptyLine()]);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [lineErrors, setLineErrors] = React.useState<Record<number, string>>({});
  const hydratedRef = React.useRef(false);

  const poQuery = useQuery({
    queryKey: ['purchase-orders', 'detail', poId],
    queryFn: ({ signal }) => getPurchaseOrder(poId as string, signal),
    enabled: isEdit,
  });
  const po = poQuery.data;

  // Full item payloads for existing lines (UOM choices need conversions).
  const editItemIds = React.useMemo(() => {
    if (!po?.lines) return [] as string[];
    return Array.from(new Set(po.lines.map((line) => line.itemId).filter(Boolean)));
  }, [po]);
  const itemQueries = useQueries({
    queries: editItemIds.map((itemId) => ({
      queryKey: ['items', 'detail', itemId],
      queryFn: ({ signal }: { signal?: AbortSignal }) => getItem(itemId, signal),
      staleTime: 60_000,
    })),
  });
  const itemsLoaded = itemQueries.every((query) => query.isSuccess);

  // One-time hydration of the form from the loaded draft.
  React.useEffect(() => {
    if (!isEdit || hydratedRef.current || !po || !itemsLoaded) return;
    hydratedRef.current = true;
    const itemById = new Map<string, Item>();
    for (const query of itemQueries) {
      if (query.data) itemById.set(query.data.id, query.data);
    }
    setSupplierId(po.supplierId ?? po.supplier?.id ?? null);
    setSupplierLabel(po.supplier ? supplierRefLabel(po.supplier) : null);
    setBranchId(po.branchId ?? po.branch?.id ?? '');
    setWarehouseId(po.destinationWarehouseId ?? po.destinationWarehouse?.id ?? '');
    setOrderDate(po.orderDate ? po.orderDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setExpectedDate(poExpectedDate(po)?.slice(0, 10) ?? '');
    setTerms(po.terms ?? '');
    setNotes(po.notes ?? '');
    setLines(
      (po.lines ?? []).map((line) => ({
        key: `po-line-${lineKeyCounter++}`,
        item: itemById.get(line.itemId) ?? null,
        uomId: line.uomId ?? line.uom?.id ?? '',
        quantity: String(decimalValue(line.quantity)),
        unitPrice:
          line.unitPrice !== undefined && line.unitPrice !== null
            ? String(decimalValue(line.unitPrice))
            : '',
        discount: poLineDiscount(line) !== null ? String(decimalValue(poLineDiscount(line))) : '',
        tax: poLineTax(line) !== null ? String(decimalValue(poLineTax(line))) : '',
      })),
    );
  }, [isEdit, po, itemsLoaded, itemQueries]);

  const totals = React.useMemo(() => {
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    let complete = canViewCost;
    for (const line of lines) {
      const quantity = Number(line.quantity);
      const price = Number(line.unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || line.unitPrice === '') {
        complete = false;
        continue;
      }
      subtotal += quantity * price;
      discountTotal += line.discount === '' ? 0 : Number(line.discount) || 0;
      taxTotal += line.tax === '' ? 0 : Number(line.tax) || 0;
    }
    return {
      subtotal,
      discountTotal,
      taxTotal,
      grandTotal: subtotal - discountTotal + taxTotal,
      complete,
    };
  }, [lines, canViewCost]);

  const saveMutation = useMutation({
    mutationFn: (body: PurchaseOrderCreateBody) => {
      if (isEdit && po) {
        return updatePurchaseOrder(po.id, { ...body, version: po.version });
      }
      return createPurchaseOrder(body);
    },
    onSuccess: (saved: PurchaseOrder) => {
      toast({
        title: isEdit ? 'Draft updated' : 'Draft saved',
        description: `Purchase order ${purchaseOrderNumber(saved)} ${isEdit ? 'updated' : 'created as a draft'}.`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      router.push(`/procurement/purchase-orders/${saved.id}`);
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        toast({
          title: 'Draft changed',
          description:
            'This purchase order was modified by someone else. The latest version has been reloaded — please reapply your changes.',
          variant: 'destructive',
        });
        hydratedRef.current = false;
        queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
        return;
      }
      if (isApiClientError(error) && error.details) {
        const perLine: Record<number, string> = {};
        for (const detail of error.details) {
          const match = /^lines[.[](\d+)/.exec(detail.field ?? '');
          if (match) {
            const index = Number(match[1]);
            if (!(index in perLine)) perLine[index] = detail.message;
          }
        }
        setLineErrors(perLine);
      }
      setFormError(getErrorMessage(error));
    },
  });

  const handleSave = () => {
    setFormError(null);
    setLineErrors({});
    if (!supplierId) return setFormError('Pick a supplier.');
    if (!branchId) return setFormError('Ordering branch is required.');
    if (!warehouseId) return setFormError('Destination warehouse is required.');
    if (!orderDate) return setFormError('Order date is required.');
    if (lines.length === 0) return setFormError('Add at least one line.');
    for (const [index, line] of lines.entries()) {
      const label = `Line ${index + 1}`;
      if (!line.item) return setFormError(`${label}: pick an item.`);
      if (!line.uomId) return setFormError(`${label}: pick a unit of measure.`);
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return setFormError(`${label}: quantity must be greater than zero.`);
      }
      if (canViewCost) {
        const price = Number(line.unitPrice);
        if (line.unitPrice === '' || !Number.isFinite(price) || price < 0) {
          return setFormError(`${label}: unit price must be zero or a positive amount.`);
        }
      }
    }

    const body: PurchaseOrderCreateBody = {
      supplierId,
      branchId,
      destinationWarehouseId: warehouseId,
      orderDate,
      expectedDate: expectedDate || undefined,
      currency: 'PHP',
      lines: lines.map((line): PurchaseOrderLineInput => {
        const input: PurchaseOrderLineInput = {
          itemId: line.item!.id,
          uomId: line.uomId,
          quantity: line.quantity,
        };
        if (canViewCost) {
          input.unitPrice = line.unitPrice;
          if (line.discount !== '') input.discount = line.discount;
          if (line.tax !== '') input.tax = line.tax;
        }
        return input;
      }),
      terms: terms || undefined,
      notes: notes || undefined,
    };
    saveMutation.mutate(body);
  };

  if (isEdit && (poQuery.isPending || (po && !itemsLoaded && !itemQueries.some((q) => q.isError)))) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isEdit && (poQuery.isError || !po)) {
    return <ErrorState error={poQuery.error} onRetry={() => poQuery.refetch()} />;
  }

  if (isEdit && po && po.status !== PurchaseOrderStatus.DRAFT && po.status !== 'REJECTED') {
    return (
      <>
        <PageHeader title={purchaseOrderNumber(po)} description="Purchase order" />
        <ErrorState
          error={new Error('Only draft purchase orders can be edited. Approved POs are immutable.')}
          onRetry={() => router.push(`/procurement/purchase-orders/${po.id}`)}
        />
      </>
    );
  }

  const backHref = isEdit && po ? `/procurement/purchase-orders/${po.id}` : '/procurement/purchase-orders';

  return (
    <>
      <PageHeader
        title={isEdit && po ? `Edit ${purchaseOrderNumber(po)}` : 'New purchase order'}
        description="Drafts do not commit anything — submit for approval before receiving."
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft aria-hidden /> Back
          </Button>
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormError message={formError} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Supplier" htmlFor="po-supplier" required>
              <SupplierPicker
                id="po-supplier"
                value={supplierId}
                selectedLabel={supplierLabel}
                onSelect={(supplier) => {
                  setSupplierId(supplier?.id ?? null);
                  setSupplierLabel(null);
                  if (supplier?.paymentTerms && !terms) setTerms(supplier.paymentTerms);
                }}
              />
            </FormField>
            <FormField label="Currency" htmlFor="po-currency" hint="All GEM-ENI POs are in PHP.">
              <Input id="po-currency" value="PHP" readOnly disabled />
            </FormField>
            <FormField label="Ordering branch" htmlFor="po-branch" required>
              <BranchSelect
                id="po-branch"
                value={branchId}
                onChange={(next) => {
                  setBranchId(next);
                  setWarehouseId('');
                }}
              />
            </FormField>
            <FormField
              label="Destination warehouse"
              htmlFor="po-warehouse"
              required
              hint="Receiving happens into this warehouse."
            >
              <WarehouseSelect
                id="po-warehouse"
                branchId={branchId}
                value={warehouseId}
                onChange={setWarehouseId}
              />
            </FormField>
            <FormField label="Order date" htmlFor="po-order-date" required>
              <Input
                id="po-order-date"
                type="date"
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
              />
            </FormField>
            <FormField label="Expected delivery date" htmlFor="po-expected">
              <Input
                id="po-expected"
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </FormField>
            <FormField label="Terms" htmlFor="po-terms" hint="Reference text only (e.g. Net 30).">
              <Input id="po-terms" value={terms} onChange={(event) => setTerms(event.target.value)} />
            </FormField>
            <FormField label="Notes" htmlFor="po-notes">
              <Textarea
                id="po-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((line, index) => (
            <PoLineEditor
              key={line.key}
              line={line}
              index={index}
              canViewCost={canViewCost}
              serverError={lineErrors[index]}
              removable={lines.length > 1}
              onChange={(next) =>
                setLines((current) => current.map((entry) => (entry.key === next.key ? next : entry)))
              }
              onRemove={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
            />
          ))}
          <Button variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>
            <Plus aria-hidden /> Add line
          </Button>

          {canViewCost ? (
            <dl className="ml-auto w-full max-w-xs space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-mono tabular-nums">
                  {totals.complete ? formatMoney(totals.subtotal) : '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="font-mono tabular-nums">
                  {totals.complete ? `− ${formatMoney(totals.discountTotal)}` : '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="font-mono tabular-nums">
                  {totals.complete ? formatMoney(totals.taxTotal) : '—'}
                </dd>
              </div>
              <div className="flex justify-between border-t pt-1 text-base font-semibold">
                <dt>Total</dt>
                <dd className="font-mono tabular-nums">
                  {totals.complete ? formatMoney(totals.grandTotal) : '—'}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">
              Prices and totals are hidden — you do not hold the procurement cost permission. The server
              applies default costs.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => router.push(backHref)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saveMutation.isPending}>
              <Save aria-hidden /> {isEdit ? 'Save changes' : 'Save draft'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
