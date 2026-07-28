'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Pencil, Plus, Power, PowerOff, Scale } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  createUomConversion,
  listUomConversions,
  listUoms,
  updateUomConversion,
} from '@/lib/endpoints';
import { formatFactor, type Uom, type UomConversion } from '@/lib/types';
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
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { lookupConflictToast } from './lookup-section';

const conversionSchema = z.object({
  fromUomId: z.string().min(1, 'Select the source unit'),
  toUomId: z.string().min(1, 'Select the target unit'),
  factor: z
    .string()
    .min(1, 'Factor is required')
    .regex(/^\d+(\.\d{1,4})?$/, 'Positive number, up to 4 decimals')
    .refine((value) => Number(value) > 0, 'Factor must be greater than zero'),
});

type ConversionFormValues = z.infer<typeof conversionSchema>;

export function uomLabel(uoms: Uom[], id: string | null | undefined, fallback?: Uom | null): string {
  if (fallback?.code) return fallback.code;
  return uoms.find((uom) => uom.id === id)?.code ?? '—';
}

/** Global UOM conversions ("1 BOX = 10 PACK"); item overrides live on items. */
export function ConversionsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<UomConversion | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<UomConversion | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const conversionsQuery = useQuery({
    queryKey: ['uom-conversions', 'list'],
    queryFn: ({ signal }) => listUomConversions({ page: 1, pageSize: 100 }, signal),
  });
  const uomsQuery = useQuery({
    queryKey: ['uoms', 'options'],
    queryFn: ({ signal }) => listUoms({ page: 1, pageSize: 100 }, signal),
  });

  const conversions = conversionsQuery.data?.data ?? [];
  const uoms = React.useMemo(() => uomsQuery.data?.data ?? [], [uomsQuery.data]);

  const form = useForm<ConversionFormValues>({
    resolver: zodResolver(conversionSchema),
    defaultValues: { fromUomId: '', toUomId: '', factor: '' },
  });

  const openCreate = () => {
    setEditTarget(null);
    form.reset({ fromUomId: '', toUomId: '', factor: '' });
    setServerError(null);
    setDialogOpen(true);
  };

  const openEdit = (conversion: UomConversion) => {
    setEditTarget(conversion);
    form.reset({
      fromUomId: conversion.fromUomId,
      toUomId: conversion.toUomId,
      factor: formatFactor(conversion.factor),
    });
    setServerError(null);
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (values: ConversionFormValues) => {
      const body = {
        fromUomId: values.fromUomId,
        toUomId: values.toUomId,
        factor: values.factor,
      };
      if (editTarget) return updateUomConversion(editTarget.id, body);
      return createUomConversion(body);
    },
    onSuccess: () => {
      toast({
        title: editTarget ? 'Conversion updated' : 'Conversion created',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['uom-conversions'] });
      setDialogOpen(false);
    },
    onError: (error) => {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'fromUomId' || field === 'toUomId' || field === 'factor') {
            form.setError(field, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (conversion: UomConversion) =>
      updateUomConversion(conversion.id, { isActive: !(conversion.isActive ?? true) }),
    onSuccess: (_, conversion) => {
      toast({
        title: (conversion.isActive ?? true) ? 'Conversion deactivated' : 'Conversion activated',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['uom-conversions'] });
    },
    onError: (error) => lookupConflictToast(error, toast, 'Could not update conversion'),
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    saveMutation.mutate(values);
  });
  const { errors } = form.formState;
  const pending = saveMutation.isPending;

  // Live preview: "1 BOX = 10 PACK".
  const watched = form.watch();
  const previewFrom = uomLabel(uoms, watched.fromUomId);
  const previewTo = uomLabel(uoms, watched.toUomId);
  const previewFactor =
    watched.factor && /^\d+(\.\d{1,4})?$/.test(watched.factor) ? formatFactor(watched.factor) : null;
  const showPreview = previewFrom !== '—' && previewTo !== '—' && previewFactor !== null;

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">UOM conversions</h2>
          <p className="text-sm text-muted-foreground">
            Global unit conversions (e.g. 1 BOX = 10 PACK). Item-specific overrides live on the item.
          </p>
        </div>
        {canManage ? (
          <Button size="sm" onClick={openCreate}>
            <Plus aria-hidden /> New conversion
          </Button>
        ) : null}
      </div>

      {conversionsQuery.isPending ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </div>
      ) : conversionsQuery.isError ? (
        <div className="p-4">
          <ErrorState error={conversionsQuery.error} onRetry={() => conversionsQuery.refetch()} />
        </div>
      ) : conversions.length === 0 ? (
        <EmptyState
          icon={Scale}
          title="No conversions yet"
          description={canManage ? 'Create the first conversion to get started.' : undefined}
          action={
            canManage ? (
              <Button size="sm" onClick={openCreate}>
                <Plus aria-hidden /> New conversion
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Conversion</TableHead>
              <TableHead className="hidden sm:table-cell">Factor</TableHead>
              <TableHead>Active</TableHead>
              {canManage ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {conversions.map((conversion) => {
              const fromCode = uomLabel(uoms, conversion.fromUomId, conversion.fromUom);
              const toCode = uomLabel(uoms, conversion.toUomId, conversion.toUom);
              const active = conversion.isActive ?? true;
              return (
                <TableRow key={conversion.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <span className="font-mono text-xs">1 {fromCode}</span>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      <span className="font-mono text-xs">
                        {formatFactor(conversion.factor)} {toCode}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                    {formatFactor(conversion.factor)}
                  </TableCell>
                  <TableCell>
                    {active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={`Edit conversion ${fromCode} to ${toCode}`}
                          onClick={() => openEdit(conversion)}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={
                            active
                              ? `Deactivate conversion ${fromCode} to ${toCode}`
                              : `Activate conversion ${fromCode} to ${toCode}`
                          }
                          onClick={() => setToggleTarget(conversion)}
                        >
                          {active ? (
                            <PowerOff className="h-3.5 w-3.5 text-destructive" aria-hidden />
                          ) : (
                            <Power className="h-3.5 w-3.5 text-success" aria-hidden />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Create / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(next) => !pending && setDialogOpen(next)}>
        <DialogHeader>
          <DialogTitle>{editTarget ? 'Edit conversion' : 'New conversion'}</DialogTitle>
          <DialogDescription>
            One source unit equals <em>factor</em> target units.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="contents">
          <DialogBody className="space-y-4">
            <FormError message={serverError} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField label="From unit" htmlFor="conv-from" error={errors.fromUomId?.message} required>
                <Select
                  id="conv-from"
                  aria-invalid={!!errors.fromUomId}
                  data-autofocus
                  {...form.register('fromUomId')}
                >
                  <option value="">Select…</option>
                  {uoms.map((uom) => (
                    <option key={uom.id} value={uom.id}>
                      {uom.code} — {uom.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Factor" htmlFor="conv-factor" error={errors.factor?.message} required>
                <Input
                  id="conv-factor"
                  inputMode="decimal"
                  aria-invalid={!!errors.factor}
                  {...form.register('factor')}
                />
              </FormField>
              <FormField label="To unit" htmlFor="conv-to" error={errors.toUomId?.message} required>
                <Select id="conv-to" aria-invalid={!!errors.toUomId} {...form.register('toUomId')}>
                  <option value="">Select…</option>
                  {uoms.map((uom) => (
                    <option key={uom.id} value={uom.id}>
                      {uom.code} — {uom.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            <p
              aria-live="polite"
              className="rounded-md border bg-muted/40 px-3 py-2 text-center font-mono text-sm"
            >
              {showPreview ? (
                <>
                  1 {previewFrom} = {previewFactor} {previewTo}
                </>
              ) : (
                <span className="text-muted-foreground">Pick both units and a factor to preview.</span>
              )}
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              {editTarget ? 'Save changes' : 'Create conversion'}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <ConfirmDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={(toggleTarget?.isActive ?? true) ? 'Deactivate conversion' : 'Activate conversion'}
        destructive={toggleTarget?.isActive ?? true}
        confirmLabel={(toggleTarget?.isActive ?? true) ? 'Deactivate' : 'Activate'}
        description={
          <>
            This conversion will {(toggleTarget?.isActive ?? true) ? 'no longer' : 'again'} be used
            when normalizing quantities.
          </>
        }
        onConfirm={async () => {
          if (toggleTarget) await toggleMutation.mutateAsync(toggleTarget);
        }}
      />
    </div>
  );
}
