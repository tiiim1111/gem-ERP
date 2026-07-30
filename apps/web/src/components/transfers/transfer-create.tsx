'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, MoveRight, Plus, Save, Trash2 } from 'lucide-react';
import { TrackingMethod } from '@gemerp/shared';
import { getErrorMessage } from '@/lib/api';
import {
  createTransfer,
  type TransferCreateBody,
  type TransferLineInput,
} from '@/lib/endpoints';
import { transferNumber, type Item } from '@/lib/types';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  BranchSelect,
  ItemPicker,
  LocationSelect,
  lotOptionLabel,
  useLotOptions,
  WarehouseSelect,
} from '@/components/inventory/pickers';

interface TransferLineDraft {
  key: string;
  item: Item | null;
  uomId: string;
  quantity: string;
  lotId: string;
}

let transferLineKey = 1;

function emptyTransferLine(): TransferLineDraft {
  return {
    key: `tline-${transferLineKey++}`,
    item: null,
    uomId: '',
    quantity: '',
    lotId: '',
  };
}

function itemUomChoices(item: Item): Array<{ id: string; code: string }> {
  const seen = new Map<string, string>();
  const add = (id: string | null | undefined, code: string | null | undefined) => {
    if (id && !seen.has(id)) seen.set(id, code ?? id);
  };
  add(item.baseUomId, item.baseUom?.code);
  add(item.purchaseUomId, item.purchaseUom?.code);
  add(item.issueUomId, item.issueUom?.code);
  for (const conversion of item.uomConversions ?? []) {
    add(conversion.fromUomId, conversion.fromUom?.code);
    add(conversion.toUomId, conversion.toUom?.code);
  }
  return Array.from(seen, ([id, code]) => ({ id, code }));
}

function StockLineFields({
  line,
  sourceWarehouseId,
  onChange,
}: {
  line: TransferLineDraft;
  sourceWarehouseId: string;
  onChange: (next: TransferLineDraft) => void;
}) {
  const lotTracked =
    !!line.item && (line.item.trackingMethod === TrackingMethod.LOT || line.item.isLotTracked);
  const { lots, isLoading: lotsLoading } = useLotOptions(
    lotTracked ? (line.item?.id ?? null) : null,
    sourceWarehouseId,
  );

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <FormField label="Item" htmlFor={`${line.key}-item`} required>
        <ItemPicker
          id={`${line.key}-item`}
          value={line.item?.id ?? null}
          selectedLabel={line.item?.name}
          onSelect={(item) => onChange({ ...line, item, uomId: item?.baseUomId ?? '', lotId: '' })}
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="UOM" htmlFor={`${line.key}-uom`} required>
          <Select
            id={`${line.key}-uom`}
            value={line.uomId}
            onChange={(event) => onChange({ ...line, uomId: event.target.value })}
            disabled={!line.item}
          >
            <option value="">Select…</option>
            {(line.item ? itemUomChoices(line.item) : []).map((uom) => (
              <option key={uom.id} value={uom.id}>
                {uom.code}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Quantity" htmlFor={`${line.key}-qty`} required>
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
      {lotTracked ? (
        <FormField label="Lot" htmlFor={`${line.key}-lot`} required className="md:col-span-2">
          <Select
            id={`${line.key}-lot`}
            value={line.lotId}
            onChange={(event) => onChange({ ...line, lotId: event.target.value })}
            disabled={lotsLoading}
          >
            <option value="">{lotsLoading ? 'Loading lots…' : 'Select lot (FEFO order)…'}</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lotOptionLabel(lot)}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
    </div>
  );
}

export function TransferCreate() {
  const router = useRouter();
  const queryClient = useQueryClient();
  useSession();
  const { toast } = useToast();

  const [sourceBranchId, setSourceBranchId] = React.useState('');
  const [sourceWarehouseId, setSourceWarehouseId] = React.useState('');
  const [sourceLocationId, setSourceLocationId] = React.useState('');
  const [destinationBranchId, setDestinationBranchId] = React.useState('');
  const [destinationWarehouseId, setDestinationWarehouseId] = React.useState('');
  const [destinationLocationId, setDestinationLocationId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<TransferLineDraft[]>([emptyTransferLine()]);
  const [formError, setFormError] = React.useState<string | null>(null);

  // Kind derives from the route (Prisma TransferType values).
  const kind =
    sourceBranchId && destinationBranchId
      ? sourceBranchId !== destinationBranchId
        ? 'INTER_BRANCH'
        : sourceWarehouseId && destinationWarehouseId && sourceWarehouseId !== destinationWarehouseId
          ? 'INTRA_BRANCH'
          : 'LOCATION'
      : '';

  const createMutation = useMutation({
    mutationFn: (body: TransferCreateBody) => createTransfer(body),
    onSuccess: (created) => {
      toast({
        title: 'Transfer draft created',
        description: `Transfer ${transferNumber(created)} saved as a draft.`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['transfers'] });
      router.push(`/inventory/transfers/${created.id}`);
    },
    onError: (error) => setFormError(getErrorMessage(error)),
  });

  const handleSave = () => {
    setFormError(null);
    if (!sourceBranchId || !sourceWarehouseId) {
      setFormError('Source branch and warehouse are required.');
      return;
    }
    if (!destinationBranchId || !destinationWarehouseId) {
      setFormError('Destination branch and warehouse are required.');
      return;
    }
    if (
      sourceBranchId === destinationBranchId &&
      sourceWarehouseId === destinationWarehouseId &&
      sourceLocationId === destinationLocationId
    ) {
      setFormError('Destination must differ from the source.');
      return;
    }
    if (lines.length === 0) {
      setFormError('Add at least one line.');
      return;
    }
    const lineInputs: TransferLineInput[] = [];
    for (const [index, line] of lines.entries()) {
      const label = `Line ${index + 1}`;
      if (!line.item) {
        setFormError(`${label}: pick an item.`);
        return;
      }
      if (!line.uomId) {
        setFormError(`${label}: pick a unit of measure.`);
        return;
      }
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setFormError(`${label}: quantity must be greater than zero.`);
        return;
      }
      const lotTracked = line.item.trackingMethod === TrackingMethod.LOT || line.item.isLotTracked;
      if (lotTracked && !line.lotId) {
        setFormError(`${label}: a lot is required for lot-tracked items.`);
        return;
      }
      lineInputs.push({
        itemId: line.item.id,
        uomId: line.uomId,
        quantity: line.quantity,
        ...(line.lotId ? { lotId: line.lotId } : {}),
      });
    }

    createMutation.mutate({
      kind,
      source: {
        branchId: sourceBranchId,
        warehouseId: sourceWarehouseId,
        ...(sourceLocationId ? { locationId: sourceLocationId } : {}),
      },
      destination: {
        branchId: destinationBranchId,
        warehouseId: destinationWarehouseId,
        ...(destinationLocationId ? { locationId: destinationLocationId } : {}),
      },
      lines: lineInputs,
      notes: notes || undefined,
    });
  };

  return (
    <>
      <PageHeader
        title="New transfer"
        description="Stock moves between locations, warehouses, or branches. Serialized assets move from their own detail page instead."
        actions={
          <Button variant="outline" onClick={() => router.push('/inventory/transfers')}>
            <ArrowLeft aria-hidden /> Back to list
          </Button>
        }
      />

      <div className="space-y-4">
        <FormError message={formError} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Source</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Branch" htmlFor="src-branch" required>
                <BranchSelect
                  id="src-branch"
                  value={sourceBranchId}
                  onChange={(next) => {
                    setSourceBranchId(next);
                    setSourceWarehouseId('');
                    setSourceLocationId('');
                  }}
                />
              </FormField>
              <FormField label="Warehouse" htmlFor="src-warehouse" required>
                <WarehouseSelect
                  id="src-warehouse"
                  branchId={sourceBranchId}
                  value={sourceWarehouseId}
                  onChange={(next) => {
                    setSourceWarehouseId(next);
                    setSourceLocationId('');
                  }}
                />
              </FormField>
              <FormField label="Location" htmlFor="src-location">
                <LocationSelect
                  id="src-location"
                  warehouseId={sourceWarehouseId}
                  value={sourceLocationId}
                  onChange={setSourceLocationId}
                />
              </FormField>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Destination</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormField label="Branch" htmlFor="dst-branch" required>
                <BranchSelect
                  id="dst-branch"
                  value={destinationBranchId}
                  onChange={(next) => {
                    setDestinationBranchId(next);
                    setDestinationWarehouseId('');
                    setDestinationLocationId('');
                  }}
                />
              </FormField>
              <FormField label="Warehouse" htmlFor="dst-warehouse" required>
                <WarehouseSelect
                  id="dst-warehouse"
                  branchId={destinationBranchId}
                  value={destinationWarehouseId}
                  onChange={(next) => {
                    setDestinationWarehouseId(next);
                    setDestinationLocationId('');
                  }}
                />
              </FormField>
              <FormField label="Location" htmlFor="dst-location">
                <LocationSelect
                  id="dst-location"
                  warehouseId={destinationWarehouseId}
                  value={destinationLocationId}
                  onChange={setDestinationLocationId}
                />
              </FormField>
            </CardContent>
          </Card>
        </div>

        {kind ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <MoveRight className="h-4 w-4" aria-hidden />
            {kind === 'INTER_BRANCH'
              ? 'Inter-branch transfer — requires approval, dispatch, and destination receipt.'
              : kind === 'INTRA_BRANCH'
                ? 'Warehouse-to-warehouse transfer within the branch.'
                : 'Location-to-location transfer within the warehouse.'}
          </p>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Lines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {lines.map((line, index) => (
              <div key={line.key} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Line {index + 1}</p>
                  {lines.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setLines((current) => current.filter((entry) => entry.key !== line.key))
                      }
                      aria-label={`Remove line ${index + 1}`}
                    >
                      <Trash2 aria-hidden /> Remove
                    </Button>
                  ) : null}
                </div>
                <StockLineFields
                  line={line}
                  sourceWarehouseId={sourceWarehouseId}
                  onChange={(next) =>
                    setLines((current) =>
                      current.map((entry) => (entry.key === next.key ? next : entry)),
                    )
                  }
                />
              </div>
            ))}
            <Button variant="outline" onClick={() => setLines((current) => [...current, emptyTransferLine()])}>
              <Plus aria-hidden /> Add line
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 pt-4 sm:pt-5">
            <FormField label="Notes" htmlFor="transfer-notes">
              <Textarea
                id="transfer-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </FormField>
            <div className="flex justify-end">
              <Button onClick={handleSave} loading={createMutation.isPending}>
                <Save aria-hidden /> Save draft
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
