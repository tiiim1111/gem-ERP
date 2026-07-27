'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { createWarehouse, updateWarehouse } from '@/lib/endpoints';
import type { Warehouse } from '@/lib/types';
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
import { useToast } from '@/components/ui/toast';

const warehouseSchema = z.object({
  code: z
    .string()
    .min(2, 'Code is required (at least 2 characters)')
    .max(10)
    .regex(/^[A-Z0-9-]+$/, 'Use uppercase letters, numbers, and dashes (e.g. WH1)'),
  name: z.string().min(1, 'Name is required').max(120),
  isActive: z.boolean(),
});

type WarehouseValues = z.infer<typeof warehouseSchema>;

export function WarehouseDialog({
  open,
  onOpenChange,
  branchId,
  warehouse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: string;
  /** Present = edit mode. */
  warehouse?: Warehouse | null;
}) {
  const isEdit = !!warehouse;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<WarehouseValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: { code: '', name: '', isActive: true },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        code: warehouse?.code ?? '',
        name: warehouse?.name ?? '',
        isActive: warehouse?.isActive ?? true,
      });
      setServerError(null);
    }
  }, [open, warehouse, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      if (isEdit && warehouse) {
        await updateWarehouse(warehouse.id, {
          code: values.code,
          name: values.name,
          isActive: values.isActive,
        });
      } else {
        await createWarehouse(branchId, { code: values.code, name: values.name });
      }
      toast({ title: isEdit ? 'Warehouse updated' : 'Warehouse created', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['warehouses', branchId] });
      onOpenChange(false);
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'code' || field === 'name') {
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
        <DialogTitle>{isEdit ? 'Edit warehouse' : 'Create warehouse'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update the warehouse. Deactivating hides it from new activity but preserves history.'
            : 'Warehouses hold storage locations and stock for this branch.'}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField label="Code" htmlFor="wh-code" error={errors.code?.message} required>
              <Input
                id="wh-code"
                aria-invalid={!!errors.code}
                className="font-mono uppercase"
                data-autofocus
                {...form.register('code')}
              />
            </FormField>
            <FormField
              label="Name"
              htmlFor="wh-name"
              error={errors.name?.message}
              required
              className="sm:col-span-2"
            >
              <Input id="wh-name" aria-invalid={!!errors.name} {...form.register('name')} />
            </FormField>
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
            {isEdit ? 'Save changes' : 'Create warehouse'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
