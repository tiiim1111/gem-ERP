'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { createSupplier, updateSupplier, type SupplierWriteBody } from '@/lib/endpoints';
import { supplierName, type Supplier } from '@/lib/types';
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
import { LookupSelect } from '@/components/inventory/pickers';

const supplierSchema = z.object({
  code: z.string().max(40),
  legalName: z.string().min(1, 'Legal name is required').max(200),
  tradeName: z.string().max(200),
  email: z.string().email('Enter a valid email address').optional().or(z.literal('')),
  phone: z.string().max(40),
  address: z.string().max(400),
  city: z.string().max(120),
  taxId: z.string().max(60),
  paymentTerms: z.string().max(200),
  notes: z.string().max(4000),
});

type SupplierFormValues = z.infer<typeof supplierSchema>;

const FORM_FIELD_NAMES = new Set<keyof SupplierFormValues>([
  'code',
  'legalName',
  'tradeName',
  'email',
  'phone',
  'address',
  'city',
  'taxId',
  'paymentTerms',
  'notes',
]);

export interface SupplierFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode (code becomes immutable). */
  supplier?: Supplier | null;
}

export function SupplierFormDialog({ open, onOpenChange, supplier }: SupplierFormDialogProps) {
  const isEdit = !!supplier;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [serverError, setServerError] = React.useState<string | null>(null);
  const [categoryId, setCategoryId] = React.useState('');

  const form = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      code: '',
      legalName: '',
      tradeName: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      taxId: '',
      paymentTerms: '',
      notes: '',
    },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        code: supplier?.code ?? '',
        legalName: supplier?.legalName ?? supplier?.name ?? '',
        tradeName: supplier?.tradeName ?? '',
        email: supplier?.email ?? '',
        phone: supplier?.phone ?? '',
        address: supplier?.address ?? '',
        city: supplier?.city ?? '',
        taxId: supplier?.taxId ?? '',
        paymentTerms: supplier?.paymentTerms ?? '',
        notes: supplier?.notes ?? '',
      });
      setCategoryId(supplier?.categoryId ?? supplier?.category?.id ?? '');
      setServerError(null);
    }
  }, [open, supplier, form]);

  const mutation = useMutation({
    mutationFn: async (values: SupplierFormValues) => {
      const body: SupplierWriteBody = {
        legalName: values.legalName,
        tradeName: values.tradeName || null,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        city: values.city || null,
        taxId: values.taxId || null,
        paymentTerms: values.paymentTerms || null,
        categoryId: categoryId || null,
        notes: values.notes || null,
      };
      if (isEdit && supplier) {
        // Supplier codes are permanent across GEM-ENI — never sent on PATCH.
        return updateSupplier(supplier.id, body);
      }
      return createSupplier({ ...body, code: values.code || undefined });
    },
    onSuccess: (saved) => {
      toast({
        title: isEdit ? 'Supplier updated' : 'Supplier created',
        description: supplierName(saved),
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      onOpenChange(false);
    },
    onError: (error) => {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (FORM_FIELD_NAMES.has(field as keyof SupplierFormValues)) {
            form.setError(field as keyof SupplierFormValues, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    mutation.mutate(values);
  });
  const { errors } = form.formState;
  const pending = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit supplier' : 'New supplier'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Supplier codes are permanent and cannot be changed.'
            : 'Payment terms are reference text only — GEM-ENI does not process payments.'}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Supplier code"
              htmlFor="sup-code"
              error={errors.code?.message}
              hint={isEdit ? 'Codes are permanent.' : 'Leave blank to auto-generate.'}
            >
              <Input
                id="sup-code"
                className="font-mono"
                readOnly={isEdit}
                disabled={isEdit}
                data-autofocus={!isEdit || undefined}
                {...form.register('code')}
              />
            </FormField>
            <FormField label="Category" htmlFor="sup-category">
              <LookupSelect
                id="sup-category"
                type="supplier-categories"
                value={categoryId}
                onChange={setCategoryId}
                placeholder="No category"
              />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Legal name" htmlFor="sup-legal" error={errors.legalName?.message} required>
              <Input
                id="sup-legal"
                aria-invalid={!!errors.legalName}
                data-autofocus={isEdit || undefined}
                {...form.register('legalName')}
              />
            </FormField>
            <FormField
              label="Trade name"
              htmlFor="sup-trade"
              error={errors.tradeName?.message}
              hint="Shown in lists when set."
            >
              <Input id="sup-trade" {...form.register('tradeName')} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Email" htmlFor="sup-email" error={errors.email?.message}>
              <Input
                id="sup-email"
                type="email"
                autoComplete="off"
                aria-invalid={!!errors.email}
                {...form.register('email')}
              />
            </FormField>
            <FormField label="Phone" htmlFor="sup-phone" error={errors.phone?.message}>
              <Input id="sup-phone" {...form.register('phone')} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Address" htmlFor="sup-address" error={errors.address?.message}>
              <Input id="sup-address" {...form.register('address')} />
            </FormField>
            <FormField label="City" htmlFor="sup-city" error={errors.city?.message}>
              <Input id="sup-city" {...form.register('city')} />
            </FormField>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Tax / registration ID"
              htmlFor="sup-tax"
              error={errors.taxId?.message}
              hint="Optional configurable reference (TIN, DTI, SEC, …)."
            >
              <Input id="sup-tax" {...form.register('taxId')} />
            </FormField>
            <FormField
              label="Payment terms"
              htmlFor="sup-terms"
              error={errors.paymentTerms?.message}
              hint="Reference text only (e.g. Net 30)."
            >
              <Input id="sup-terms" {...form.register('paymentTerms')} />
            </FormField>
          </div>

          <FormField label="Notes" htmlFor="sup-notes" error={errors.notes?.message}>
            <Textarea id="sup-notes" rows={3} {...form.register('notes')} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {isEdit ? 'Save changes' : 'Create supplier'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
