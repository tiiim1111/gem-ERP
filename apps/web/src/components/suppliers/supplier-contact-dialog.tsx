'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  createSupplierContact,
  updateSupplierContact,
  type SupplierContactWriteBody,
} from '@/lib/endpoints';
import type { SupplierContact } from '@/lib/types';
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

const contactSchema = z.object({
  name: z.string().min(1, 'Name is required').max(160),
  position: z.string().max(120),
  email: z.string().email('Enter a valid email address').optional().or(z.literal('')),
  phone: z.string().max(40),
});

type ContactFormValues = z.infer<typeof contactSchema>;

const FORM_FIELD_NAMES = new Set<keyof ContactFormValues>(['name', 'position', 'email', 'phone']);

export interface SupplierContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  /** Present = edit mode. */
  contact?: SupplierContact | null;
}

export function SupplierContactDialog({
  open,
  onOpenChange,
  supplierId,
  contact,
}: SupplierContactDialogProps) {
  const isEdit = !!contact;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [serverError, setServerError] = React.useState<string | null>(null);
  const [isPrimary, setIsPrimary] = React.useState(false);

  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactSchema),
    defaultValues: { name: '', position: '', email: '', phone: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        name: contact?.name ?? '',
        position: contact?.position ?? '',
        email: contact?.email ?? '',
        phone: contact?.phone ?? '',
      });
      setIsPrimary(contact?.isPrimary ?? false);
      setServerError(null);
    }
  }, [open, contact, form]);

  const mutation = useMutation({
    mutationFn: async (values: ContactFormValues) => {
      const body: SupplierContactWriteBody = {
        name: values.name,
        position: values.position || null,
        email: values.email || null,
        phone: values.phone || null,
        isPrimary,
      };
      if (isEdit && contact) {
        return updateSupplierContact(supplierId, contact.id, body);
      }
      return createSupplierContact(supplierId, body);
    },
    onSuccess: (saved) => {
      toast({
        title: isEdit ? 'Contact updated' : 'Contact added',
        description: saved.name,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      onOpenChange(false);
    },
    onError: (error) => {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (FORM_FIELD_NAMES.has(field as keyof ContactFormValues)) {
            form.setError(field as keyof ContactFormValues, { type: 'server', message });
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
        <DialogTitle>{isEdit ? 'Edit contact person' : 'Add contact person'}</DialogTitle>
        <DialogDescription>Contact people for orders, deliveries, and follow-ups.</DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <FormField label="Name" htmlFor="contact-name" error={errors.name?.message} required>
            <Input
              id="contact-name"
              aria-invalid={!!errors.name}
              data-autofocus
              {...form.register('name')}
            />
          </FormField>
          <FormField label="Position / role" htmlFor="contact-position" error={errors.position?.message}>
            <Input id="contact-position" {...form.register('position')} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Email" htmlFor="contact-email" error={errors.email?.message}>
              <Input
                id="contact-email"
                type="email"
                autoComplete="off"
                aria-invalid={!!errors.email}
                {...form.register('email')}
              />
            </FormField>
            <FormField label="Phone" htmlFor="contact-phone" error={errors.phone?.message}>
              <Input id="contact-phone" {...form.register('phone')} />
            </FormField>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isPrimary}
              onChange={(event) => setIsPrimary(event.target.checked)}
              aria-label="Primary contact"
            />
            Primary contact
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {isEdit ? 'Save changes' : 'Add contact'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
