'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, ShieldCheck } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { createRole, listRoles } from '@/lib/endpoints';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';

const createRoleSchema = z.object({
  code: z
    .string()
    .min(2, 'Code is required (at least 2 characters)')
    .max(50)
    .regex(/^[A-Z0-9_]+$/, 'Use uppercase letters, numbers, and underscores (e.g. STORE_LEAD)'),
  name: z.string().min(1, 'Name is required').max(120),
  description: z.string().max(500).optional(),
});

type CreateRoleValues = z.infer<typeof createRoleSchema>;

function CreateRoleDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { code: '', name: '', description: '' },
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
      const role = await createRole({
        code: values.code,
        name: values.name,
        description: values.description || undefined,
      });
      toast({ title: 'Role created', description: 'Now choose its permissions.', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      onOpenChange(false);
      router.push(`/roles/${role.id}`);
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'code' || field === 'name' || field === 'description') {
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
        <DialogTitle>Create custom role</DialogTitle>
        <DialogDescription>
          After creating the role you will pick its permissions on the role page.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit} noValidate className="contents">
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <FormField
            label="Code"
            htmlFor="role-code"
            error={errors.code?.message}
            hint="Stable identifier, e.g. STORE_LEAD. Cannot be changed later."
            required
          >
            <Input
              id="role-code"
              aria-invalid={!!errors.code}
              data-autofocus
              className="font-mono uppercase"
              {...form.register('code')}
            />
          </FormField>
          <FormField label="Name" htmlFor="role-name" error={errors.name?.message} required>
            <Input id="role-name" aria-invalid={!!errors.name} {...form.register('name')} />
          </FormField>
          <FormField label="Description" htmlFor="role-description" error={errors.description?.message}>
            <Textarea id="role-description" {...form.register('description')} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Create role
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

export function RolesPage() {
  const { can } = useSession();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [createOpen, setCreateOpen] = React.useState(false);

  const rolesQuery = useQuery({
    queryKey: ['roles', 'list', { page, pageSize }],
    queryFn: ({ signal }) => listRoles({ page, pageSize }, signal),
    placeholderData: keepPreviousData,
  });

  const canCreate = can(PERMISSIONS.role.create);
  const data = rolesQuery.data;

  return (
    <>
      <PageHeader
        title="Roles"
        description="Roles bundle permissions; users may hold multiple roles."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden /> New role
            </Button>
          ) : undefined
        }
      />

      <Card>
        {rolesQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : rolesQuery.isError ? (
          <div className="p-4">
            <ErrorState error={rolesQuery.error} onRetry={() => rolesQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="No roles found" />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Permissions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((role) => (
                  <TableRow key={role.id}>
                    <TableCell>
                      <Link
                        href={`/roles/${role.id}`}
                        className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {role.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{role.code}</p>
                    </TableCell>
                    <TableCell className="hidden max-w-md truncate text-sm text-muted-foreground md:table-cell">
                      {role.description ?? '—'}
                    </TableCell>
                    <TableCell>
                      {role.isSystem ? (
                        <Badge variant="secondary">System</Badge>
                      ) : (
                        <Badge variant="outline">Custom</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                      {role.permissionCount ?? role.permissions?.length ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>

      <CreateRoleDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
