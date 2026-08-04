'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated } from '@gemerp/shared';
import { ArrowDown, ArrowUp, ArrowUpDown, ListX, Pencil, Plus, Power, PowerOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';

/* ------------------------------ Shared bits ------------------------------ */

export interface LookupRowBase {
  id: string;
  code?: string;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
  isActive: boolean;
}

export type LookupSortKey = 'code' | 'name' | 'description' | 'sortOrder' | 'isActive';

export function useSortedRows<T extends LookupRowBase>(
  rows: T[],
  initialKey: LookupSortKey = 'code',
) {
  const [sortKey, setSortKey] = React.useState<LookupSortKey>(initialKey);
  const [direction, setDirection] = React.useState<'asc' | 'desc'>('asc');

  const toggle = (key: LookupSortKey) => {
    if (key === sortKey) {
      setDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setDirection('asc');
    }
  };

  const sorted = React.useMemo(() => {
    const factor = direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = a[sortKey];
      const right = b[sortKey];
      if (typeof left === 'boolean' || typeof right === 'boolean') {
        return (Number(right ?? false) - Number(left ?? false)) * factor;
      }
      if (typeof left === 'number' || typeof right === 'number') {
        return ((Number(left ?? 0)) - Number(right ?? 0)) * factor;
      }
      return String(left ?? '').localeCompare(String(right ?? '')) * factor;
    });
  }, [rows, sortKey, direction]);

  return { sorted, sortKey, direction, toggle };
}

export function SortableHead({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  className,
}: {
  label: string;
  sortKey: LookupSortKey;
  activeKey: LookupSortKey;
  direction: 'asc' | 'desc';
  onSort: (key: LookupSortKey) => void;
  className?: string;
}) {
  const active = sortKey === activeKey;
  const Icon = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase tracking-wide focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <Icon className={cn('h-3 w-3', active ? 'text-foreground' : 'text-muted-foreground/60')} aria-hidden />
      </button>
    </TableHead>
  );
}

/** Friendly toast for 409s (value referenced by records / duplicate code). */
export function lookupConflictToast(
  error: unknown,
  toast: (options: { title: string; description?: string; variant?: 'destructive' }) => void,
  fallbackTitle: string,
): boolean {
  if (isApiClientError(error) && error.status === 409) {
    toast({
      title: error.code === 'DUPLICATE_CODE' ? 'Code already in use' : 'Value is in use',
      description: error.message,
      variant: 'destructive',
    });
    return true;
  }
  toast({ title: fallbackTitle, description: getErrorMessage(error), variant: 'destructive' });
  return false;
}

/* ------------------------- Generic form + section ------------------------- */

export interface LookupDialogExtra<T extends LookupRowBase, B extends object, E> {
  /** Initial extra-state when the dialog opens (target = row being edited). */
  getInitial: (target: T | null) => E;
  /** Renders the extra controls (controlled by the section). */
  render: (value: E, setValue: (value: E) => void, target: T | null) => React.ReactNode;
  /** Merged into the create/update body. */
  toBody: (value: E) => Partial<B>;
}

export interface LookupSectionProps<T extends LookupRowBase, B extends object, E = undefined> {
  /** Singular label, e.g. "Department". */
  label: string;
  /** Plural label, e.g. "Departments". */
  labelPlural: string;
  description?: string;
  queryKey: readonly unknown[];
  fetchRows: (signal?: AbortSignal) => Promise<Paginated<T>>;
  create: (body: B) => Promise<T>;
  update: (id: string, body: Partial<B> & { isActive?: boolean }) => Promise<T>;
  canManage: boolean;
  /** Show the description column + field. */
  withDescription?: boolean;
  /** Show the sort-order field (and sortable column). */
  withSortOrder?: boolean;
  extraColumns?: Array<{
    header: string;
    cell: (row: T) => React.ReactNode;
    className?: string;
  }>;
  dialogExtra?: LookupDialogExtra<T, B, E>;
  /** Additional query keys to invalidate after mutations. */
  invalidateKeys?: Array<readonly unknown[]>;
}

const baseSchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(40)
    .regex(/^[A-Z0-9_-]+$/i, 'Letters, numbers, dashes, and underscores only'),
  name: z.string().min(1, 'Name is required').max(160),
  description: z.string().max(500),
  sortOrder: z.string().regex(/^\d*$/, 'Whole number only'),
});

type LookupFormValues = z.infer<typeof baseSchema>;

export function LookupSection<T extends LookupRowBase, B extends object, E = undefined>({
  label,
  labelPlural,
  description,
  queryKey,
  fetchRows,
  create,
  update,
  canManage,
  withDescription = false,
  withSortOrder = false,
  extraColumns = [],
  dialogExtra,
  invalidateKeys = [],
}: LookupSectionProps<T, B, E>) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<T | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<T | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [extraValue, setExtraValue] = React.useState<E | undefined>(undefined);

  const listQuery = useQuery({
    queryKey: [...queryKey, 'list'],
    queryFn: ({ signal }) => fetchRows(signal),
  });

  const rows = React.useMemo(() => listQuery.data?.data ?? [], [listQuery.data]);
  const total = listQuery.data?.meta.total ?? 0;
  const { sorted, sortKey, direction, toggle } = useSortedRows(rows);

  const form = useForm<LookupFormValues>({
    resolver: zodResolver(baseSchema),
    defaultValues: { code: '', name: '', description: '', sortOrder: '' },
  });

  const openCreate = () => {
    setEditTarget(null);
    form.reset({ code: '', name: '', description: '', sortOrder: '' });
    setExtraValue(dialogExtra ? dialogExtra.getInitial(null) : undefined);
    setServerError(null);
    setDialogOpen(true);
  };

  const openEdit = (row: T) => {
    setEditTarget(row);
    form.reset({
      code: row.code ?? '',
      name: row.name,
      description: row.description ?? '',
      sortOrder: row.sortOrder !== null && row.sortOrder !== undefined ? String(row.sortOrder) : '',
    });
    setExtraValue(dialogExtra ? dialogExtra.getInitial(row) : undefined);
    setServerError(null);
    setDialogOpen(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [...queryKey] });
    for (const key of invalidateKeys) {
      queryClient.invalidateQueries({ queryKey: [...key] });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (values: LookupFormValues) => {
      const raw: Record<string, unknown> = {
        name: values.name,
      };
      // Codes are immutable once created (embedded in SKUs/asset tags) —
      // the API rejects `code` on update.
      if (!editTarget) raw.code = values.code.toUpperCase();
      if (withDescription) raw.description = values.description || null;
      if (withSortOrder && values.sortOrder !== '') raw.sortOrder = Number(values.sortOrder);
      if (dialogExtra && extraValue !== undefined) {
        Object.assign(raw, dialogExtra.toBody(extraValue));
      }
      // The dynamic field set matches B by construction (config-driven form).
      const body = raw as B;
      if (editTarget) return update(editTarget.id, body);
      return create(body);
    },
    onSuccess: () => {
      toast({
        title: editTarget ? `${label} updated` : `${label} created`,
        variant: 'success',
      });
      invalidate();
      setDialogOpen(false);
    },
    onError: (error) => {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'code' || field === 'name' || field === 'description' || field === 'sortOrder') {
            form.setError(field, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (row: T) =>
      update(row.id, { isActive: !row.isActive } as Partial<B> & { isActive?: boolean }),
    onSuccess: (_, row) => {
      toast({
        title: row.isActive ? `${label} deactivated` : `${label} activated`,
        variant: 'success',
      });
      invalidate();
    },
    onError: (error) => {
      // 409s (value referenced elsewhere) get a friendly toast; the confirm
      // dialog also shows the message inline.
      lookupConflictToast(error, toast, `Could not update ${label.toLowerCase()}`);
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    saveMutation.mutate(values);
  });
  const { errors } = form.formState;
  const pending = saveMutation.isPending;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{labelPlural}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {canManage ? (
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> New {label.toLowerCase()}
          </Button>
        ) : null}
      </div>

      {listQuery.isPending ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : listQuery.isError ? (
        <div className="p-4">
          <ErrorState error={listQuery.error} onRetry={() => listQuery.refetch()} />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={ListX}
          title={`No ${labelPlural.toLowerCase()} yet`}
          description={canManage ? `Create the first ${label.toLowerCase()} to get started.` : undefined}
          action={
            canManage ? (
              <Button size="sm" onClick={openCreate}>
                <Plus aria-hidden /> New {label.toLowerCase()}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead label="Code" sortKey="code" activeKey={sortKey} direction={direction} onSort={toggle} />
                <SortableHead label="Name" sortKey="name" activeKey={sortKey} direction={direction} onSort={toggle} />
                {withDescription ? (
                  <SortableHead
                    label="Description"
                    sortKey="description"
                    activeKey={sortKey}
                    direction={direction}
                    onSort={toggle}
                    className="hidden md:table-cell"
                  />
                ) : null}
                {extraColumns.map((column) => (
                  <TableHead key={column.header} className={column.className}>
                    {column.header}
                  </TableHead>
                ))}
                <SortableHead label="Active" sortKey="isActive" activeKey={sortKey} direction={direction} onSort={toggle} />
                {canManage ? <TableHead className="w-20 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.code ?? '—'}</TableCell>
                  <TableCell className="text-sm font-medium">{row.name}</TableCell>
                  {withDescription ? (
                    <TableCell className="hidden max-w-[18rem] truncate text-sm text-muted-foreground md:table-cell">
                      {row.description || '—'}
                    </TableCell>
                  ) : null}
                  {extraColumns.map((column) => (
                    <TableCell key={column.header} className={column.className}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                  <TableCell>
                    {row.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="muted">Inactive</Badge>
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => openEdit(row)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={row.isActive ? `Deactivate ${row.name}` : `Activate ${row.name}`}
                          onClick={() => setToggleTarget(row)}
                        >
                          {row.isActive ? (
                            <PowerOff className="h-3.5 w-3.5 text-destructive" aria-hidden />
                          ) : (
                            <Power className="h-3.5 w-3.5 text-success" aria-hidden />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {total > rows.length ? (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Showing the first {rows.length} of {total} values.
            </p>
          ) : null}
        </>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(next) => !pending && setDialogOpen(next)}>
        <DialogHeader>
          <DialogTitle>{editTarget ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}</DialogTitle>
          <DialogDescription>
            {editTarget
              ? 'Values already referenced by records cannot be removed — deactivate instead.'
              : `Add a ${label.toLowerCase()} for use across GEM ERP.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="contents">
          <DialogBody className="space-y-4">
            <FormError message={serverError} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Code" htmlFor={`lookup-code-${label}`} error={errors.code?.message} required>
                <Input
                  id={`lookup-code-${label}`}
                  className="font-mono uppercase read-only:opacity-60 read-only:cursor-not-allowed"
                  aria-invalid={!!errors.code}
                  data-autofocus
                  readOnly={!!editTarget}
                  title={editTarget ? 'Codes are permanent once created.' : undefined}
                  {...form.register('code')}
                />
              </FormField>
              <FormField
                label="Name"
                htmlFor={`lookup-name-${label}`}
                error={errors.name?.message}
                required
                className="sm:col-span-2"
              >
                <Input id={`lookup-name-${label}`} aria-invalid={!!errors.name} {...form.register('name')} />
              </FormField>
            </div>
            {withDescription ? (
              <FormField
                label="Description"
                htmlFor={`lookup-desc-${label}`}
                error={errors.description?.message}
              >
                <Textarea id={`lookup-desc-${label}`} rows={2} {...form.register('description')} />
              </FormField>
            ) : null}
            {withSortOrder ? (
              <FormField
                label="Sort order"
                htmlFor={`lookup-sort-${label}`}
                error={errors.sortOrder?.message}
                hint="Lower numbers appear first in pickers."
              >
                <Input
                  id={`lookup-sort-${label}`}
                  inputMode="numeric"
                  className="w-32"
                  {...form.register('sortOrder')}
                />
              </FormField>
            ) : null}
            {dialogExtra && extraValue !== undefined
              ? dialogExtra.render(extraValue, setExtraValue as (value: E) => void, editTarget)
              : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {editTarget ? 'Save changes' : `Create ${label.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      {/* Activate / deactivate confirm */}
      <ConfirmDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.isActive ? `Deactivate ${label.toLowerCase()}` : `Activate ${label.toLowerCase()}`}
        destructive={!!toggleTarget?.isActive}
        confirmLabel={toggleTarget?.isActive ? 'Deactivate' : 'Activate'}
        description={
          toggleTarget?.isActive ? (
            <>
              <span className="font-medium text-foreground">{toggleTarget?.name}</span> will no longer
              appear in pickers for new records. Existing references keep working.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{toggleTarget?.name}</span> will be
              available again in pickers.
            </>
          )
        }
        onConfirm={async () => {
          if (toggleTarget) await toggleMutation.mutateAsync(toggleTarget);
        }}
      />
    </div>
  );
}
