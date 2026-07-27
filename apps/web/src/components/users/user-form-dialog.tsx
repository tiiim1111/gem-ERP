'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { createUser, listBranches, listRoles, updateUser } from '@/lib/endpoints';
import { userBranchIds, type UserRecord } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { CheckboxList } from '@/components/ui/checkbox-list';
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

/** Password is validated only in create mode (edit never touches passwords). */
function buildUserSchema(isEdit: boolean) {
  return z
    .object({
      email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
      displayName: z.string().min(1, 'Display name is required').max(120),
      password: z.string(),
    })
    .superRefine((values, ctx) => {
      if (!isEdit && values.password.length < 8) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: 'Password must be at least 8 characters',
        });
      }
    });
}

type UserFormValues = z.infer<ReturnType<typeof buildUserSchema>>;

export interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present = edit mode (profile fields only); absent = create mode. */
  user?: UserRecord | null;
}

export function UserFormDialog({ open, onOpenChange, user }: UserFormDialogProps) {
  const isEdit = !!user;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [roleIds, setRoleIds] = React.useState<string[]>([]);
  const [branchIds, setBranchIds] = React.useState<string[]>([]);

  const rolesQuery = useQuery({
    queryKey: ['roles', 'options'],
    queryFn: ({ signal }) => listRoles({ page: 1, pageSize: 100 }, signal),
    enabled: open && !isEdit,
  });
  const branchesQuery = useQuery({
    queryKey: ['branches', 'options'],
    queryFn: ({ signal }) => listBranches({ page: 1, pageSize: 100 }, signal),
    enabled: open && !isEdit,
  });

  const schema = React.useMemo(() => buildUserSchema(isEdit), [isEdit]);
  const form = useForm<UserFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', displayName: '', password: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({
        email: user?.email ?? '',
        displayName: user?.displayName ?? '',
        password: '',
      });
      setRoleIds(user ? (user.roles?.map((role) => role.id) ?? []) : []);
      setBranchIds(user ? userBranchIds(user) : []);
      setServerError(null);
    }
  }, [open, user, form]);

  const mutation = useMutation({
    mutationFn: async (values: UserFormValues) => {
      if (isEdit && user) {
        return updateUser(user.id, { email: values.email, displayName: values.displayName });
      }
      return createUser({
        email: values.email,
        displayName: values.displayName,
        password: values.password,
        roleIds: roleIds.length > 0 ? roleIds : undefined,
        branchIds: branchIds.length > 0 ? branchIds : undefined,
      });
    },
    onSuccess: () => {
      toast({
        title: isEdit ? 'User updated' : 'User created',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
    },
    onError: (error) => {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'email' || field === 'displayName' || field === 'password') {
            form.setError(field, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    },
  });

  const onSubmit = form.handleSubmit((values) => mutation.mutate(values));
  const { errors } = form.formState;
  const pending = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Edit user' : 'Create user'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update the user profile. Roles and branch access are managed separately.'
            : 'Create an account and optionally assign roles and branch access.'}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <FormField label="Display name" htmlFor="user-name" error={errors.displayName?.message} required>
            <Input
              id="user-name"
              aria-invalid={!!errors.displayName}
              data-autofocus
              {...form.register('displayName')}
            />
          </FormField>
          <FormField label="Email" htmlFor="user-email" error={errors.email?.message} required>
            <Input
              id="user-email"
              type="email"
              autoComplete="off"
              aria-invalid={!!errors.email}
              {...form.register('email')}
            />
          </FormField>
          {!isEdit ? (
            <>
              <FormField
                label="Initial password"
                htmlFor="user-password"
                error={errors.password?.message}
                hint="At least 8 characters. Share it with the user securely."
                required
              >
                <Input
                  id="user-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!errors.password}
                  {...form.register('password')}
                />
              </FormField>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Roles</p>
                {rolesQuery.isError ? (
                  <FormError message={getErrorMessage(rolesQuery.error, 'Failed to load roles.')} />
                ) : (
                  <CheckboxList
                    aria-label="Assign roles"
                    items={(rolesQuery.data?.data ?? []).map((role) => ({
                      id: role.id,
                      label: role.name,
                      description: role.description ?? role.code,
                    }))}
                    selectedIds={roleIds}
                    onChange={setRoleIds}
                    emptyLabel={rolesQuery.isPending ? 'Loading roles…' : 'No roles found.'}
                  />
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Branch access</p>
                {branchesQuery.isError ? (
                  <FormError message={getErrorMessage(branchesQuery.error, 'Failed to load branches.')} />
                ) : (
                  <CheckboxList
                    aria-label="Assign branch access"
                    items={(branchesQuery.data?.data ?? []).map((branch) => ({
                      id: branch.id,
                      label: branch.name,
                      description: branch.code,
                    }))}
                    selectedIds={branchIds}
                    onChange={setBranchIds}
                    emptyLabel={branchesQuery.isPending ? 'Loading branches…' : 'No branches found.'}
                  />
                )}
              </div>
            </>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {isEdit ? 'Save changes' : 'Create user'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
