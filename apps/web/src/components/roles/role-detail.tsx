'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Lock, RotateCcw, Save } from 'lucide-react';
import { PERMISSIONS, ROLE_CODES } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { getRole, listPermissionCatalog, setRolePermissions, updateRole } from '@/lib/endpoints';
import type { PermissionCatalogGroup, Role } from '@/lib/types';
import { humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';

const detailsSchema = z.object({
  name: z.string().min(1, 'Name is required').max(120),
  description: z.string().max(500).optional(),
});

type DetailsValues = z.infer<typeof detailsSchema>;

function RoleDetailsCard({ role, editable }: { role: Role; editable: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<DetailsValues>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: role.name, description: role.description ?? '' },
  });

  React.useEffect(() => {
    form.reset({ name: role.name, description: role.description ?? '' });
  }, [role, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await updateRole(role.id, {
        name: values.name,
        description: values.description || undefined,
      });
      toast({ title: 'Role updated', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'name' || field === 'description') {
            form.setError(field, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    }
  });

  const { errors, isSubmitting, isDirty } = form.formState;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          Code <span className="font-mono">{role.code}</span>
          {role.isSystem ? ' — system role codes are immutable.' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError message={serverError} />
          <FormField label="Name" htmlFor="role-name" error={errors.name?.message} required>
            <Input id="role-name" disabled={!editable} aria-invalid={!!errors.name} {...form.register('name')} />
          </FormField>
          <FormField label="Description" htmlFor="role-desc" error={errors.description?.message}>
            <Textarea id="role-desc" disabled={!editable} {...form.register('description')} />
          </FormField>
          {editable ? (
            <div className="flex justify-end">
              <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
                <Save aria-hidden /> Save details
              </Button>
            </div>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}

function PermissionEditor({
  role,
  catalog,
  editable,
}: {
  role: Role;
  catalog: PermissionCatalogGroup[];
  editable: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const granted = React.useMemo(() => new Set(role.permissions ?? []), [role.permissions]);
  const [selected, setSelected] = React.useState<Set<string>>(granted);

  React.useEffect(() => {
    setSelected(new Set(role.permissions ?? []));
  }, [role.permissions]);

  const mutation = useMutation({
    mutationFn: () => setRolePermissions(role.id, [...selected].sort()),
    onSuccess: () => {
      toast({ title: 'Permissions saved', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (error) => setServerError(getErrorMessage(error)),
  });

  const totalPermissions = catalog.reduce((sum, group) => sum + group.permissions.length, 0);
  const dirty =
    selected.size !== granted.size || [...selected].some((permission) => !granted.has(permission));

  const togglePermission = (key: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleGroup = (group: PermissionCatalogGroup, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const permission of group.permissions) {
        if (checked) next.add(permission.key);
        else next.delete(permission.key);
      }
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1">
          <CardTitle>Permissions</CardTitle>
          <CardDescription>
            {editable
              ? `${selected.size} of ${totalPermissions} permissions granted.`
              : role.code === ROLE_CODES.superAdmin
                ? 'Super Admin always holds every permission and cannot be edited.'
                : 'System role permissions are read-only.'}
          </CardDescription>
        </div>
        {editable ? (
          <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty || mutation.isPending}
              onClick={() => setSelected(new Set(granted))}
            >
              <RotateCcw aria-hidden /> Reset
            </Button>
            <Button size="sm" loading={mutation.isPending} disabled={!dirty} onClick={() => mutation.mutate()}>
              <Save aria-hidden /> Save permissions
            </Button>
          </div>
        ) : (
          <Badge variant="secondary" className="mt-2 gap-1 sm:mt-0">
            <Lock className="h-3 w-3" aria-hidden /> Read-only
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <FormError message={serverError} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {catalog.map((group) => {
            const groupKeys = group.permissions.map((permission) => permission.key);
            const grantedInGroup = groupKeys.filter((key) => selected.has(key)).length;
            const allChecked = grantedInGroup === groupKeys.length && groupKeys.length > 0;
            const someChecked = grantedInGroup > 0 && !allChecked;
            const groupId = `perm-group-${group.resource}`;
            return (
              <fieldset key={group.resource} className="rounded-md border">
                <legend className="sr-only">{humanize(group.resource)} permissions</legend>
                <div className="flex items-center justify-between gap-2 border-b bg-muted/50 px-3 py-2">
                  <label htmlFor={groupId} className="flex cursor-pointer items-center gap-2">
                    <Checkbox
                      id={groupId}
                      checked={allChecked}
                      indeterminate={someChecked}
                      disabled={!editable}
                      onChange={(event) => toggleGroup(group, event.target.checked)}
                    />
                    <span className="text-sm font-semibold">{humanize(group.resource)}</span>
                  </label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {grantedInGroup}/{groupKeys.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-x-3 p-2 sm:grid-cols-2">
                  {group.permissions.map((permission) => {
                    const inputId = `perm-${permission.key.replace(/\./g, '-')}`;
                    return (
                      <label
                        key={permission.key}
                        htmlFor={inputId}
                        className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
                        title={permission.description ?? permission.key}
                      >
                        <Checkbox
                          id={inputId}
                          className="mt-0.5"
                          checked={selected.has(permission.key)}
                          disabled={!editable}
                          onChange={(event) => togglePermission(permission.key, event.target.checked)}
                        />
                        <span className="min-w-0">
                          <span className="block font-mono text-xs leading-tight">{permission.key}</span>
                          {permission.description ? (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {permission.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export function RoleDetail({ roleId }: { roleId: string }) {
  const { can } = useSession();

  const roleQuery = useQuery({
    queryKey: ['roles', 'detail', roleId],
    queryFn: ({ signal }) => getRole(roleId, signal),
  });

  const catalogQuery = useQuery({
    queryKey: ['permissions', 'catalog'],
    queryFn: ({ signal }) => listPermissionCatalog(signal),
    staleTime: 5 * 60_000,
  });

  const role = roleQuery.data;
  const isSuperAdmin = role?.code === ROLE_CODES.superAdmin;
  const detailsEditable = !!role && can(PERMISSIONS.role.update) && !isSuperAdmin;
  const permissionsEditable =
    !!role && can(PERMISSIONS.role.managePermissions) && !role.isSystem;

  return (
    <>
      <div className="mb-3">
        <Link
          href="/roles"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to roles
        </Link>
      </div>

      {roleQuery.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : roleQuery.isError ? (
        <ErrorState error={roleQuery.error} onRetry={() => roleQuery.refetch()} />
      ) : role ? (
        <>
          <PageHeader
            title={role.name}
            description={role.description ?? undefined}
            actions={
              role.isSystem ? <Badge variant="secondary">System role</Badge> : <Badge variant="outline">Custom role</Badge>
            }
          />
          <div className="space-y-4">
            <RoleDetailsCard role={role} editable={detailsEditable} />
            {catalogQuery.isPending ? (
              <Skeleton className="h-72 w-full" />
            ) : catalogQuery.isError ? (
              <ErrorState error={catalogQuery.error} onRetry={() => catalogQuery.refetch()} />
            ) : (
              <PermissionEditor role={role} catalog={catalogQuery.data} editable={permissionsEditable} />
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
