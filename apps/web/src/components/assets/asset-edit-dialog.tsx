'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage, isVersionConflict } from '@/lib/api';
import { updateAsset } from '@/lib/endpoints';
import { assetTag, conditionLabel, type Asset } from '@/lib/types';
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
  DepartmentSelect,
  LocationSelect,
  LookupSelect,
  WarehouseSelect,
} from '@/components/inventory/pickers';
import { SupplierPicker } from '@/components/procurement/supplier-picker';

/** "2026-05-12T00:00:00.000Z" -> "2026-05-12" for date inputs; null-safe. */
function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** Condition lookup id regardless of how the server embedded it. */
function assetConditionId(asset: Asset): string {
  if (asset.conditionId) return asset.conditionId;
  if (asset.condition && typeof asset.condition === 'object') return asset.condition.id;
  return '';
}

interface FormState {
  serialNumber: string;
  criticalityId: string;
  warrantyStartDate: string;
  warrantyEndDate: string;
  nextMaintenanceAt: string;
  notes: string;
  // Draft-only fields (the API rejects them once the asset is active).
  conditionId: string;
  warehouseId: string;
  storageLocationId: string;
  departmentId: string;
  acquisitionDate: string;
  acquisitionCost: string;
  supplierId: string;
}

function initialState(asset: Asset): FormState {
  return {
    serialNumber: asset.serialNumber ?? '',
    criticalityId: asset.criticality?.id ?? '',
    warrantyStartDate: toDateInput(asset.warrantyStartDate),
    warrantyEndDate: toDateInput(asset.warrantyEndDate),
    nextMaintenanceAt: toDateInput(asset.nextMaintenanceAt),
    notes: asset.notes ?? '',
    conditionId: assetConditionId(asset),
    warehouseId: asset.warehouseId ?? asset.warehouse?.id ?? '',
    storageLocationId:
      asset.storageLocationId ?? asset.storageLocation?.id ?? asset.locationId ?? '',
    departmentId: asset.departmentId ?? asset.department?.id ?? '',
    acquisitionDate: toDateInput(asset.acquisitionDate),
    acquisitionCost:
      asset.acquisitionCost !== null && asset.acquisitionCost !== undefined
        ? String(asset.acquisitionCost)
        : '',
    supplierId: asset.supplierId ?? asset.supplier?.id ?? '',
  };
}

/**
 * Edit non-lifecycle asset fields (PATCH /assets/:id). Requires the current
 * `version` — a 409 VERSION_CONFLICT triggers the house toast + rehydrate.
 * Draft assets are fully editable; active assets accept only warranty,
 * criticality, next maintenance, serial correction, and notes.
 */
export function AssetEditDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { canAny } = useSession();
  const { toast } = useToast();

  const isDraft = asset.status === 'DRAFT';
  const canEditCost = canAny([PERMISSIONS.asset.viewCost]);

  const [form, setForm] = React.useState<FormState>(() => initialState(asset));
  const [formError, setFormError] = React.useState<string | null>(null);

  // Re-seed from the freshest asset every time the dialog opens.
  React.useEffect(() => {
    if (open) {
      setForm(initialState(asset));
      setFormError(null);
    }
  }, [open, asset]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown> & { version: number }) =>
      updateAsset(asset.id, body),
    onSuccess: (saved) => {
      toast({ title: 'Asset updated', description: assetTag(saved), variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      onOpenChange(false);
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        toast({
          title: 'Asset changed',
          description:
            'This asset was modified by someone else. The latest data has been reloaded — please reapply your changes.',
          variant: 'destructive',
        });
        queryClient.invalidateQueries({ queryKey: ['assets'] });
        onOpenChange(false);
        return;
      }
      setFormError(getErrorMessage(error));
    },
  });

  const handleSave = () => {
    setFormError(null);
    const initial = initialState(asset);
    const body: Record<string, unknown> = {};

    // Only changed fields ride the PATCH; '' clears a previously-set value.
    const diff = (key: keyof FormState, nullable = true) => {
      if (form[key] === initial[key]) return;
      body[key] = form[key] === '' ? (nullable ? null : undefined) : form[key];
    };

    diff('serialNumber');
    diff('criticalityId');
    diff('warrantyStartDate');
    diff('warrantyEndDate');
    diff('nextMaintenanceAt');
    diff('notes');
    if (isDraft) {
      // conditionId / warehouseId are non-nullable in the DTO — never clear them.
      if (form.conditionId && form.conditionId !== initial.conditionId) {
        body.conditionId = form.conditionId;
      }
      if (form.warehouseId && form.warehouseId !== initial.warehouseId) {
        body.warehouseId = form.warehouseId;
      }
      diff('storageLocationId');
      diff('departmentId');
      diff('acquisitionDate');
      diff('supplierId');
      if (canEditCost && form.acquisitionCost !== initial.acquisitionCost) {
        const cleaned = form.acquisitionCost.replace(/[,\s]+/g, '');
        if (cleaned && !/^\d{1,12}(\.\d{1,2})?$/.test(cleaned)) {
          setFormError('Acquisition cost must be a plain amount like 65000 or 65000.50.');
          return;
        }
        body.acquisitionCost = cleaned === '' ? null : cleaned;
      }
    }

    if (Object.keys(body).length === 0) {
      onOpenChange(false);
      return;
    }
    mutation.mutate({ ...body, version: asset.version ?? 0 });
  };

  const pending = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Edit {assetTag(asset)}</DialogTitle>
        <DialogDescription>
          {isDraft
            ? 'Draft assets are fully editable before activation.'
            : 'Active assets accept warranty, criticality, next maintenance, serial correction, and notes. Location and custody change through the lifecycle actions.'}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={formError} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Serial number" htmlFor="asset-edit-serial">
            <Input
              id="asset-edit-serial"
              value={form.serialNumber}
              onChange={(event) => set('serialNumber', event.target.value)}
              placeholder="Manufacturer serial"
            />
          </FormField>
          <FormField label="Criticality" htmlFor="asset-edit-criticality">
            <LookupSelect
              id="asset-edit-criticality"
              type="maintenance-priorities"
              value={form.criticalityId}
              onChange={(value) => set('criticalityId', value)}
              placeholder="No criticality"
            />
          </FormField>
          <FormField label="Warranty start" htmlFor="asset-edit-warranty-start">
            <Input
              id="asset-edit-warranty-start"
              type="date"
              value={form.warrantyStartDate}
              onChange={(event) => set('warrantyStartDate', event.target.value)}
            />
          </FormField>
          <FormField label="Warranty end" htmlFor="asset-edit-warranty-end">
            <Input
              id="asset-edit-warranty-end"
              type="date"
              value={form.warrantyEndDate}
              onChange={(event) => set('warrantyEndDate', event.target.value)}
            />
          </FormField>
          <FormField label="Next maintenance" htmlFor="asset-edit-next-maintenance">
            <Input
              id="asset-edit-next-maintenance"
              type="date"
              value={form.nextMaintenanceAt}
              onChange={(event) => set('nextMaintenanceAt', event.target.value)}
            />
          </FormField>
        </div>

        {isDraft ? (
          <div className="space-y-4 rounded-md border bg-muted/30 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Draft-only fields
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Condition"
                htmlFor="asset-edit-condition"
                hint={conditionLabel(asset.condition) ? undefined : 'Current: not set'}
              >
                <LookupSelect
                  id="asset-edit-condition"
                  type="asset-conditions"
                  value={form.conditionId}
                  onChange={(value) => set('conditionId', value)}
                  placeholder="Keep current condition"
                />
              </FormField>
              <FormField label="Department" htmlFor="asset-edit-department">
                <DepartmentSelect
                  id="asset-edit-department"
                  value={form.departmentId}
                  onChange={(value) => set('departmentId', value)}
                />
              </FormField>
              <FormField label="Warehouse" htmlFor="asset-edit-warehouse">
                <WarehouseSelect
                  id="asset-edit-warehouse"
                  branchId={asset.branchId ?? asset.branch?.id ?? ''}
                  value={form.warehouseId}
                  onChange={(value) => {
                    set('warehouseId', value);
                    set('storageLocationId', '');
                  }}
                />
              </FormField>
              <FormField label="Storage location" htmlFor="asset-edit-location">
                <LocationSelect
                  id="asset-edit-location"
                  warehouseId={form.warehouseId}
                  value={form.storageLocationId}
                  onChange={(value) => set('storageLocationId', value)}
                />
              </FormField>
              <FormField label="Acquisition date" htmlFor="asset-edit-acquired">
                <Input
                  id="asset-edit-acquired"
                  type="date"
                  value={form.acquisitionDate}
                  onChange={(event) => set('acquisitionDate', event.target.value)}
                />
              </FormField>
              {canEditCost ? (
                <FormField label="Acquisition cost (₱)" htmlFor="asset-edit-cost">
                  <Input
                    id="asset-edit-cost"
                    inputMode="decimal"
                    value={form.acquisitionCost}
                    onChange={(event) => set('acquisitionCost', event.target.value)}
                    placeholder="65000.00"
                  />
                </FormField>
              ) : null}
              <FormField
                label="Supplier"
                htmlFor="asset-edit-supplier"
                className="sm:col-span-2"
              >
                <SupplierPicker
                  id="asset-edit-supplier"
                  value={form.supplierId || null}
                  onSelect={(supplier) => set('supplierId', supplier?.id ?? '')}
                  selectedLabel={asset.supplier?.name ?? asset.supplier?.legalName ?? undefined}
                />
              </FormField>
            </div>
          </div>
        ) : null}

        <FormField label="Notes" htmlFor="asset-edit-notes">
          <Textarea
            id="asset-edit-notes"
            rows={3}
            value={form.notes}
            onChange={(event) => set('notes', event.target.value)}
            placeholder="Anything future custodians should know."
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button onClick={handleSave} loading={pending}>
          Save changes
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
