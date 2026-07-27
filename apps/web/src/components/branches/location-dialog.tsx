'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { createStorageLocation, updateStorageLocation } from '@/lib/endpoints';
import { storageLocationKind, type StorageLocation } from '@/lib/types';
import { humanize } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';

const LOCATION_KINDS = ['ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN', 'RECEIVING', 'STAGING'] as const;

const locationSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Use uppercase letters, numbers, and dashes (e.g. A-01)'),
  name: z.string().min(1, 'Name is required').max(120),
  kind: z.string().optional(),
  parentId: z.string().optional(),
  isActive: z.boolean(),
});

type LocationValues = z.infer<typeof locationSchema>;

export function LocationDialog({
  open,
  onOpenChange,
  warehouseId,
  locations,
  location,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouseId: string;
  /** Existing locations of the warehouse — parent options. */
  locations: StorageLocation[];
  /** Present = edit mode. */
  location?: StorageLocation | null;
}) {
  const isEdit = !!location;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<LocationValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: { code: '', name: '', kind: '', parentId: '', isActive: true },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        code: location?.code ?? '',
        name: location?.name ?? '',
        kind: location ? (storageLocationKind(location) ?? '') : '',
        parentId: location?.parentId ?? '',
        isActive: location?.isActive ?? true,
      });
      setServerError(null);
    }
  }, [open, location, form]);

  const parentOptions = locations.filter((candidate) => candidate.id !== location?.id);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (isEdit && location) {
        await updateStorageLocation(location.id, {
          code: values.code,
          name: values.name,
          kind: values.kind || undefined,
          isActive: values.isActive,
        });
      } else {
        await createStorageLocation(warehouseId, {
          code: values.code,
          name: values.name,
          kind: values.kind || undefined,
          parentId: values.parentId || undefined,
        });
      }
      toast({ title: isEdit ? 'Location updated' : 'Location created', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['storage-locations', warehouseId] });
      onOpenChange(false);
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'code' || field === 'name' || field === 'kind' || field === 'parentId') {
            form.setError(field, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    }
  });

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit storage location' : 'Create storage location'}</DialogTitle>
        <DialogDescription>
          Zones, aisles, racks, shelves, and bins can be nested to mirror the physical layout.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Code" htmlFor="loc-code" error={errors.code?.message} required>
              <Input
                id="loc-code"
                aria-invalid={!!errors.code}
                className="font-mono uppercase"
                data-autofocus
                {...form.register('code')}
              />
            </FormField>
            <FormField
              label="Name"
              htmlFor="loc-name"
              error={errors.name?.message}
              required
              className="sm:col-span-2"
            >
              <Input id="loc-name" aria-invalid={!!errors.name} {...form.register('name')} />
            </FormField>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Type" htmlFor="loc-kind" error={errors.kind?.message}>
              <Select id="loc-kind" {...form.register('kind')}>
                <option value="">Unspecified</option>
                {LOCATION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {humanize(kind)}
                  </option>
                ))}
              </Select>
            </FormField>
            {!isEdit ? (
              <FormField label="Parent location" htmlFor="loc-parent" error={errors.parentId?.message}>
                <Select id="loc-parent" {...form.register('parentId')}>
                  <option value="">None (top level)</option>
                  {parentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.code} — {option.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}
          </div>
          {isEdit ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox {...form.register('isActive')} />
              Active
            </label>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isEdit ? 'Save changes' : 'Create location'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
