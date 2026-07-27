'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ORG_TIMEZONE } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { createBranch, updateBranch } from '@/lib/endpoints';
import type { Branch } from '@/lib/types';
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
import { useToast } from '@/components/ui/toast';

const branchSchema = z.object({
  code: z
    .string()
    .min(2, 'Code is required (at least 2 characters)')
    .max(10)
    .regex(/^[A-Z0-9]+$/, 'Use uppercase letters and numbers (e.g. SUB)'),
  name: z.string().min(1, 'Name is required').max(120),
  address: z.string().max(300).optional(),
  timezone: z.string().max(60).optional(),
});

type BranchValues = z.infer<typeof branchSchema>;

export function BranchFormDialog({
  open,
  onOpenChange,
  branch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode. */
  branch?: Branch | null;
}) {
  const isEdit = !!branch;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<BranchValues>({
    resolver: zodResolver(branchSchema),
    defaultValues: { code: '', name: '', address: '', timezone: ORG_TIMEZONE },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        code: branch?.code ?? '',
        name: branch?.name ?? '',
        address: branch?.address ?? '',
        timezone: branch?.timezone ?? ORG_TIMEZONE,
      });
      setServerError(null);
    }
  }, [open, branch, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const body = {
      code: values.code,
      name: values.name,
      address: values.address || undefined,
      timezone: values.timezone || undefined,
    };
    try {
      if (isEdit && branch) {
        await updateBranch(branch.id, body);
      } else {
        await createBranch(body);
      }
      toast({ title: isEdit ? 'Branch updated' : 'Branch created', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['branches'] });
      onOpenChange(false);
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'code' || field === 'name' || field === 'address' || field === 'timezone') {
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
        <DialogTitle>{isEdit ? 'Edit branch' : 'Create branch'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update branch details. Deactivation is handled separately and preserves history.'
            : 'Branches contain warehouses and scope user access.'}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField
              label="Code"
              htmlFor="branch-code"
              error={errors.code?.message}
              hint="Used in asset tags."
              required
            >
              <Input
                id="branch-code"
                aria-invalid={!!errors.code}
                className="font-mono uppercase"
                data-autofocus={!isEdit}
                {...form.register('code')}
              />
            </FormField>
            <FormField
              label="Name"
              htmlFor="branch-name"
              error={errors.name?.message}
              required
              className="sm:col-span-2"
            >
              <Input id="branch-name" aria-invalid={!!errors.name} {...form.register('name')} />
            </FormField>
          </div>
          <FormField label="Address" htmlFor="branch-address" error={errors.address?.message}>
            <Input id="branch-address" {...form.register('address')} />
          </FormField>
          <FormField
            label="Timezone"
            htmlFor="branch-timezone"
            error={errors.timezone?.message}
            hint="IANA name; defaults to the org timezone (Asia/Manila)."
          >
            <Input id="branch-timezone" {...form.register('timezone')} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            {isEdit ? 'Save changes' : 'Create branch'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
