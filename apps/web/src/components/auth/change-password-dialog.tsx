'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { changePassword } from '@/lib/endpoints';
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
import { useToast } from '@/components/ui/toast';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ['newPassword'],
    message: 'New password must be different from the current password',
  });

type ChangePasswordValues = z.infer<typeof schema>;

export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { refresh } = useSession();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  React.useEffect(() => {
    if (!open) {
      form.reset();
      setServerError(null);
    }
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast({
        title: 'Password changed',
        description: 'Your other sessions have been signed out.',
        variant: 'success',
      });
      onOpenChange(false);
      // Clears the must-change-password flag if it was set.
      await refresh();
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'currentPassword' || field === 'newPassword') {
            form.setError(field, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error, 'Could not change password.'));
    }
  });

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Change password</DialogTitle>
        <DialogDescription>
          Choose a new password. All your other active sessions will be signed out.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <FormField
            label="Current password"
            htmlFor="cp-current"
            error={errors.currentPassword?.message}
            required
          >
            <Input
              id="cp-current"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.currentPassword}
              data-autofocus
              {...form.register('currentPassword')}
            />
          </FormField>
          <FormField
            label="New password"
            htmlFor="cp-new"
            error={errors.newPassword?.message}
            hint="At least 8 characters."
            required
          >
            <Input
              id="cp-new"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              {...form.register('newPassword')}
            />
          </FormField>
          <FormField
            label="Confirm new password"
            htmlFor="cp-confirm"
            error={errors.confirmPassword?.message}
            required
          >
            <Input
              id="cp-confirm"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              {...form.register('confirmPassword')}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Change password
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
