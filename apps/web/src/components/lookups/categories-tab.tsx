'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  FolderTree,
  Pencil,
  Plus,
  Power,
  PowerOff,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  createItemCategory,
  createItemSubcategory,
  listItemCategories,
  listItemSubcategories,
  updateItemCategory,
  updateItemSubcategory,
} from '@/lib/endpoints';
import type { ItemCategory, ItemSubcategory } from '@/lib/types';
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
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { lookupConflictToast } from './lookup-section';

const categorySchema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(20)
    .regex(/^[A-Z0-9_-]+$/i, 'Letters, numbers, dashes, and underscores only'),
  name: z.string().min(1, 'Name is required').max(160),
  description: z.string().max(500),
  sortOrder: z.string().regex(/^\d*$/, 'Whole number only'),
});

type CategoryFormValues = z.infer<typeof categorySchema>;

interface DialogState {
  mode: 'create-category' | 'edit-category' | 'create-subcategory' | 'edit-subcategory';
  category?: ItemCategory;
  subcategory?: ItemSubcategory;
}

/** Categories with inline, expandable subcategories (tag/SKU code sources). */
export function CategoriesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<
    | { kind: 'category'; row: ItemCategory }
    | { kind: 'subcategory'; row: ItemSubcategory }
    | null
  >(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['item-categories', 'list'],
    queryFn: ({ signal }) => listItemCategories({ page: 1, pageSize: 100 }, signal),
  });
  const categories = categoriesQuery.data?.data ?? [];

  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: { code: '', name: '', description: '', sortOrder: '' },
  });

  const openDialog = (state: DialogState) => {
    const row = state.mode === 'edit-category' ? state.category : state.subcategory;
    form.reset({
      code: row?.code ?? '',
      name: row?.name ?? '',
      description: row?.description ?? '',
      sortOrder: row?.sortOrder !== null && row?.sortOrder !== undefined ? String(row.sortOrder) : '',
    });
    setServerError(null);
    setDialog(state);
  };

  const invalidate = (categoryId?: string) => {
    queryClient.invalidateQueries({ queryKey: ['item-categories'] });
    if (categoryId) {
      queryClient.invalidateQueries({ queryKey: ['item-subcategories', categoryId] });
    }
  };

  const saveMutation = useMutation({
    mutationFn: async (values: CategoryFormValues) => {
      const body = {
        code: values.code.toUpperCase(),
        name: values.name,
        description: values.description || null,
        ...(values.sortOrder !== '' ? { sortOrder: Number(values.sortOrder) } : {}),
      };
      if (!dialog) throw new Error('No dialog state');
      switch (dialog.mode) {
        case 'create-category':
          return createItemCategory(body);
        case 'edit-category':
          return updateItemCategory(dialog.category!.id, body);
        case 'create-subcategory':
          return createItemSubcategory(dialog.category!.id, body);
        case 'edit-subcategory':
          return updateItemSubcategory(dialog.subcategory!.id, body);
      }
    },
    onSuccess: () => {
      const isSub = dialog?.mode.includes('subcategory');
      toast({
        title: dialog?.mode.startsWith('create')
          ? `${isSub ? 'Subcategory' : 'Category'} created`
          : `${isSub ? 'Subcategory' : 'Category'} updated`,
        variant: 'success',
      });
      invalidate(dialog?.category?.id ?? dialog?.subcategory?.categoryId);
      setDialog(null);
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
    mutationFn: async (target: NonNullable<typeof toggleTarget>) => {
      if (target.kind === 'category') {
        return updateItemCategory(target.row.id, { isActive: !target.row.isActive });
      }
      return updateItemSubcategory(target.row.id, { isActive: !target.row.isActive });
    },
    onSuccess: (_, target) => {
      toast({
        title: target.row.isActive
          ? `${target.kind === 'category' ? 'Category' : 'Subcategory'} deactivated`
          : `${target.kind === 'category' ? 'Category' : 'Subcategory'} activated`,
        variant: 'success',
      });
      invalidate(target.kind === 'subcategory' ? target.row.categoryId : target.row.id);
    },
    onError: (error) => lookupConflictToast(error, toast, 'Could not update value'),
  });

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    saveMutation.mutate(values);
  });
  const { errors } = form.formState;
  const pending = saveMutation.isPending;
  const dialogIsSub = dialog?.mode.includes('subcategory') ?? false;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">Item categories</h2>
          <p className="text-sm text-muted-foreground">
            Category codes feed asset-tag and SKU patterns (AST-…-LAP-…, SKU-PPR-…). Expand a row to
            manage its subcategories.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={() => openDialog({ mode: 'create-category' })}>
            <Plus aria-hidden /> New category
          </Button>
        ) : null}
      </div>

      {categoriesQuery.isPending ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : categoriesQuery.isError ? (
        <div className="p-4">
          <ErrorState error={categoriesQuery.error} onRetry={() => categoriesQuery.refetch()} />
        </div>
      ) : categories.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No item categories yet"
          description={canManage ? 'Create the first category to get started.' : undefined}
          action={
            canManage ? (
              <Button size="sm" onClick={() => openDialog({ mode: 'create-category' })}>
                <Plus aria-hidden /> New category
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"><span className="sr-only">Expand</span></TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Description</TableHead>
              <TableHead>Active</TableHead>
              {canManage ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => (
              <React.Fragment key={category.id}>
                <TableRow>
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(category.id)}
                      aria-expanded={expanded.has(category.id)}
                      aria-label={`${expanded.has(category.id) ? 'Collapse' : 'Expand'} subcategories of ${category.name}`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {expanded.has(category.id) ? (
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{category.code}</TableCell>
                  <TableCell className="text-sm font-medium">{category.name}</TableCell>
                  <TableCell className="hidden max-w-[18rem] truncate text-sm text-muted-foreground md:table-cell">
                    {category.description || '—'}
                  </TableCell>
                  <TableCell>
                    {category.isActive ? (
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
                          aria-label={`Edit ${category.name}`}
                          onClick={() => openDialog({ mode: 'edit-category', category })}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={category.isActive ? `Deactivate ${category.name}` : `Activate ${category.name}`}
                          onClick={() => setToggleTarget({ kind: 'category', row: category })}
                        >
                          {category.isActive ? (
                            <PowerOff className="h-3.5 w-3.5 text-destructive" aria-hidden />
                          ) : (
                            <Power className="h-3.5 w-3.5 text-success" aria-hidden />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
                {expanded.has(category.id) ? (
                  <SubcategoryRows
                    category={category}
                    canManage={canManage}
                    columnCount={canManage ? 6 : 5}
                    onAdd={() => openDialog({ mode: 'create-subcategory', category })}
                    onEdit={(subcategory) => openDialog({ mode: 'edit-subcategory', subcategory })}
                    onToggle={(subcategory) => setToggleTarget({ kind: 'subcategory', row: subcategory })}
                  />
                ) : null}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Category / subcategory dialog */}
      <Dialog open={dialog !== null} onOpenChange={(next) => !pending && !next && setDialog(null)}>
        <DialogHeader>
          <DialogTitle>
            {dialog?.mode === 'create-category' && 'New category'}
            {dialog?.mode === 'edit-category' && 'Edit category'}
            {dialog?.mode === 'create-subcategory' && `New subcategory in ${dialog.category?.name}`}
            {dialog?.mode === 'edit-subcategory' && 'Edit subcategory'}
          </DialogTitle>
          <DialogDescription>
            {dialogIsSub
              ? 'Subcategories refine reporting inside a category.'
              : 'The short code is embedded in asset tags and SKUs — keep it stable.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="contents">
          <DialogBody className="space-y-4">
            <FormError message={serverError} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="Code" htmlFor="cat-code" error={errors.code?.message} required>
                <Input
                  id="cat-code"
                  className="font-mono uppercase"
                  aria-invalid={!!errors.code}
                  data-autofocus
                  {...form.register('code')}
                />
              </FormField>
              <FormField
                label="Name"
                htmlFor="cat-name"
                error={errors.name?.message}
                required
                className="sm:col-span-2"
              >
                <Input id="cat-name" aria-invalid={!!errors.name} {...form.register('name')} />
              </FormField>
            </div>
            <FormField label="Description" htmlFor="cat-desc" error={errors.description?.message}>
              <Textarea id="cat-desc" rows={2} {...form.register('description')} />
            </FormField>
            <FormField
              label="Sort order"
              htmlFor="cat-sort"
              error={errors.sortOrder?.message}
              hint="Lower numbers appear first in pickers."
            >
              <Input id="cat-sort" inputMode="numeric" className="w-32" {...form.register('sortOrder')} />
            </FormField>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {dialog?.mode.startsWith('create') ? 'Create' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <ConfirmDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.row.isActive ? 'Deactivate value' : 'Activate value'}
        destructive={!!toggleTarget?.row.isActive}
        confirmLabel={toggleTarget?.row.isActive ? 'Deactivate' : 'Activate'}
        description={
          toggleTarget?.row.isActive ? (
            <>
              <span className="font-medium text-foreground">{toggleTarget?.row.name}</span> will no
              longer appear in pickers for new records. Existing references keep working.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{toggleTarget?.row.name}</span> will be
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

function SubcategoryRows({
  category,
  canManage,
  columnCount,
  onAdd,
  onEdit,
  onToggle,
}: {
  category: ItemCategory;
  canManage: boolean;
  columnCount: number;
  onAdd: () => void;
  onEdit: (subcategory: ItemSubcategory) => void;
  onToggle: (subcategory: ItemSubcategory) => void;
}) {
  const subcategoriesQuery = useQuery({
    queryKey: ['item-subcategories', category.id],
    queryFn: ({ signal }) => listItemSubcategories(category.id, { page: 1, pageSize: 100 }, signal),
  });
  const subcategories = subcategoriesQuery.data?.data ?? [];

  if (subcategoriesQuery.isPending) {
    return (
      <TableRow>
        <TableCell colSpan={columnCount} className="bg-muted/30 py-2 pl-12">
          <Skeleton className="h-6 w-64" />
        </TableCell>
      </TableRow>
    );
  }

  if (subcategoriesQuery.isError) {
    return (
      <TableRow>
        <TableCell colSpan={columnCount} className="bg-muted/30 py-2 pl-12 text-sm text-destructive">
          Failed to load subcategories.{' '}
          <button type="button" className="underline" onClick={() => subcategoriesQuery.refetch()}>
            Retry
          </button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {subcategories.length === 0 ? (
        <TableRow>
          <TableCell colSpan={columnCount} className="bg-muted/30 py-2 pl-12 text-sm text-muted-foreground">
            No subcategories in {category.name}.
          </TableCell>
        </TableRow>
      ) : (
        subcategories.map((subcategory) => (
          <TableRow key={subcategory.id} className="bg-muted/30">
            <TableCell />
            <TableCell className="font-mono text-xs">
              <span className="inline-flex items-center gap-1.5">
                <CornerDownRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {subcategory.code}
              </span>
            </TableCell>
            <TableCell className="text-sm">{subcategory.name}</TableCell>
            <TableCell className="hidden max-w-[18rem] truncate text-sm text-muted-foreground md:table-cell">
              {subcategory.description || '—'}
            </TableCell>
            <TableCell>
              {subcategory.isActive ? (
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
                    aria-label={`Edit ${subcategory.name}`}
                    onClick={() => onEdit(subcategory)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={
                      subcategory.isActive ? `Deactivate ${subcategory.name}` : `Activate ${subcategory.name}`
                    }
                    onClick={() => onToggle(subcategory)}
                  >
                    {subcategory.isActive ? (
                      <PowerOff className="h-3.5 w-3.5 text-destructive" aria-hidden />
                    ) : (
                      <Power className="h-3.5 w-3.5 text-success" aria-hidden />
                    )}
                  </Button>
                </div>
              </TableCell>
            ) : null}
          </TableRow>
        ))
      )}
      {canManage ? (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={columnCount} className="py-1.5 pl-12">
            <Button variant="ghost" size="sm" onClick={onAdd}>
              <Plus aria-hidden /> Add subcategory
            </Button>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
