'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS, TrackingMethod } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { registerAsset, type AssetRegisterBody } from '@/lib/endpoints';
import { assetTag, type Item } from '@/lib/types';
import { useSession } from '@/components/auth/session-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  BranchSelect,
  ItemPicker,
  LocationSelect,
  LookupSelect,
  WarehouseSelect,
} from '@/components/inventory/pickers';

export function AssetRegisterDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { can } = useSession();
  const { toast } = useToast();
  const canViewCost = can(PERMISSIONS.asset.viewCost);

  const [item, setItem] = React.useState<Item | null>(null);
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [locationId, setLocationId] = React.useState('');
  const [quantity, setQuantity] = React.useState('1');
  const [serialNumbers, setSerialNumbers] = React.useState('');
  const [conditionId, setConditionId] = React.useState('');
  const [acquisitionDate, setAcquisitionDate] = React.useState('');
  const [acquisitionCost, setAcquisitionCost] = React.useState('');
  const [warrantyStartDate, setWarrantyStartDate] = React.useState('');
  const [warrantyEndDate, setWarrantyEndDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setItem(null);
      setBranchId('');
      setWarehouseId('');
      setLocationId('');
      setQuantity('1');
      setSerialNumbers('');
      setConditionId('');
      setAcquisitionDate('');
      setAcquisitionCost('');
      setWarrantyStartDate('');
      setWarrantyEndDate('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const registerMutation = useMutation({
    mutationFn: (body: AssetRegisterBody) => registerAsset(body),
    onSuccess: (created) => {
      const assets = Array.isArray(created) ? created : [created];
      toast({
        title: assets.length === 1 ? 'Asset registered' : `${assets.length} assets registered`,
        description:
          assets.length === 1 && assets[0]
            ? `Draft asset ${assetTag(assets[0])} created.`
            : 'Draft assets created — activate them once labeled.',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      onOpenChange(false);
    },
    onError: (err) => {
      if (isApiClientError(err) && err.details?.length) {
        setError(err.details.map((detail) => detail.message).join(' '));
        return;
      }
      setError(getErrorMessage(err));
    },
  });

  const handleSubmit = () => {
    setError(null);
    if (!item) {
      setError('Pick a serialized item.');
      return;
    }
    if (!branchId) {
      setError('Branch is required.');
      return;
    }
    const count = Number(quantity);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      setError('Quantity must be a whole number between 1 and 100.');
      return;
    }
    const serials = serialNumbers
      .split(/[\n,]/)
      .map((serial) => serial.trim())
      .filter(Boolean);
    if (serials.length > 0 && serials.length !== count) {
      setError(`You entered ${serials.length} serial number(s) for ${count} unit(s) — counts must match, or leave serials blank.`);
      return;
    }

    const body: AssetRegisterBody = {
      itemId: item.id,
      branchId,
      warehouseId: warehouseId || undefined,
      storageLocationId: locationId || undefined,
      quantity: count,
      conditionId: conditionId || undefined,
      acquisitionDate: acquisitionDate || undefined,
      warrantyStartDate: warrantyStartDate || undefined,
      warrantyEndDate: warrantyEndDate || undefined,
      notes: notes || undefined,
    };
    if (serials.length === 1 && count === 1) body.serialNumber = serials[0];
    else if (serials.length > 0) body.serialNumbers = serials;
    if (canViewCost && acquisitionCost) body.acquisitionCost = acquisitionCost;

    registerMutation.mutate(body);
  };

  const pending = registerMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Register assets</DialogTitle>
        <DialogDescription>
          Creates Draft asset records with generated tags, barcodes, and QR tokens. Activate them
          after labeling.
        </DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <DialogBody className="space-y-4">
          <FormError message={error} />

          <FormField label="Item (serialized)" htmlFor="reg-item" required>
            <ItemPicker
              id="reg-item"
              value={item?.id ?? null}
              selectedLabel={item?.name}
              trackingMethod={TrackingMethod.SERIAL}
              onSelect={setItem}
              placeholder="Search serialized items…"
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Branch" htmlFor="reg-branch" required>
              <BranchSelect
                id="reg-branch"
                value={branchId}
                onChange={(next) => {
                  setBranchId(next);
                  setWarehouseId('');
                  setLocationId('');
                }}
              />
            </FormField>
            <FormField label="Warehouse" htmlFor="reg-warehouse">
              <WarehouseSelect
                id="reg-warehouse"
                branchId={branchId}
                value={warehouseId}
                onChange={(next) => {
                  setWarehouseId(next);
                  setLocationId('');
                }}
              />
            </FormField>
            <FormField label="Storage location" htmlFor="reg-location">
              <LocationSelect
                id="reg-location"
                warehouseId={warehouseId}
                value={locationId}
                onChange={setLocationId}
              />
            </FormField>
            <FormField
              label="Quantity"
              htmlFor="reg-quantity"
              required
              hint="Bulk-registers N identical units (max 100)."
            >
              <Input
                id="reg-quantity"
                type="number"
                min="1"
                max="100"
                step="1"
                inputMode="numeric"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </FormField>
          </div>

          <FormField
            label="Manufacturer serial numbers"
            htmlFor="reg-serials"
            hint="Optional — one per line (or comma-separated). Count must match quantity."
          >
            <Textarea
              id="reg-serials"
              rows={2}
              value={serialNumbers}
              onChange={(event) => setSerialNumbers(event.target.value)}
            />
          </FormField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Condition" htmlFor="reg-condition">
              <LookupSelect
                id="reg-condition"
                type="asset-conditions"
                value={conditionId}
                onChange={setConditionId}
                placeholder="Select condition…"
              />
            </FormField>
            <FormField label="Acquisition date" htmlFor="reg-acq-date">
              <Input
                id="reg-acq-date"
                type="date"
                value={acquisitionDate}
                onChange={(event) => setAcquisitionDate(event.target.value)}
              />
            </FormField>
            {canViewCost ? (
              <FormField label="Acquisition cost (PHP, per unit)" htmlFor="reg-cost">
                <Input
                  id="reg-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={acquisitionCost}
                  onChange={(event) => setAcquisitionCost(event.target.value)}
                />
              </FormField>
            ) : null}
            <FormField label="Warranty start" htmlFor="reg-war-start">
              <Input
                id="reg-war-start"
                type="date"
                value={warrantyStartDate}
                onChange={(event) => setWarrantyStartDate(event.target.value)}
              />
            </FormField>
            <FormField label="Warranty end" htmlFor="reg-war-end">
              <Input
                id="reg-war-end"
                type="date"
                value={warrantyEndDate}
                onChange={(event) => setWarrantyEndDate(event.target.value)}
              />
            </FormField>
          </div>

          <FormField label="Notes" htmlFor="reg-notes">
            <Textarea
              id="reg-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Register
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
