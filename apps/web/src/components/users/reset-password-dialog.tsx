'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { resetUserPassword } from '@/lib/endpoints';
import type { UserRecord } from '@/lib/types';
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

const schema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

type ResetPasswordValues = z.infer<typeof schema>;

/** Admin reset (POST /users/:id/reset-password) — forces change at next login. */
export function ResetPasswordDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRecord | null;
}) {
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '' },
  });

  React.useEffect(() => {
    if (!open) {
      form.reset();
      setServerError(null);
    }
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!user) return;
    setServerError(null);
    try {
      await resetUserPassword(user.id, values.newPassword);
      toast({
        title: 'Password reset',
        description: `${user.displayName} must change it at next login. All their sessions were revoked.`,
        variant: 'success',
      });
      onOpenChange(false);
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        const message = error.fieldErrors.newPassword;
        if (message) form.setError('newPassword', { type: 'server', message });
      }
      setServerError(getErrorMessage(error));
    }
  });

  const { errors, isSubmitting } = form.formState;

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Reset password</DialogTitle>
        <DialogDescription>
          Set a temporary password for{' '}
          <span className="font-medium text-foreground">{user?.displayName}</span>. They will be required
          to change it at their next login, and all their active sessions will be revoked.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <FormField
            label="Temporary password"
            htmlFor="reset-password"
            error={errors.newPassword?.message}
            hint="At least 8 characters. Share it with the user securely."
            required
          >
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              data-autofocus
              {...form.register('newPassword')}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!user}>
            Reset password
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
