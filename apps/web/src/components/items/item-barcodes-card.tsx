'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Barcode, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { addItemBarcode, archiveItemBarcode, listItemBarcodes, unwrapList } from '@/lib/endpoints';
import { barcodeIsActive, type Item, type ItemBarcode } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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

const BARCODE_TYPES = ['SKU', 'UPC', 'EAN', 'SUPPLIER', 'PACKAGING', 'OTHER'];

const barcodeSchema = z.object({
  barcode: z.string().min(1, 'Barcode is required').max(80),
  barcodeType: z.string(),
  isPrimary: z.boolean(),
});

type BarcodeFormValues = z.infer<typeof barcodeSchema>;

/** Primary + alternate barcode mappings; archives are soft (mapping history kept). */
export function ItemBarcodesCard({ item, canManage }: { item: Item; canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [addOpen, setAddOpen] = React.useState(false);
  const [archiveTarget, setArchiveTarget] = React.useState<ItemBarcode | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const barcodesQuery = useQuery({
    queryKey: ['items', 'barcodes', item.id],
    queryFn: ({ signal }) => listItemBarcodes(item.id, signal),
  });
  const barcodes = barcodesQuery.data ? unwrapList(barcodesQuery.data) : [];

  const form = useForm<BarcodeFormValues>({
    resolver: zodResolver(barcodeSchema),
    defaultValues: { barcode: '', barcodeType: 'SUPPLIER', isPrimary: false },
  });

  React.useEffect(() => {
    if (addOpen) {
      form.reset({ barcode: '', barcodeType: 'SUPPLIER', isPrimary: false });
      setServerError(null);
    }
  }, [addOpen, form]);

  const addMutation = useMutation({
    mutationFn: (values: BarcodeFormValues) =>
      addItemBarcode(item.id, {
        barcode: values.barcode.trim(),
        barcodeType: values.barcodeType || null,
        isPrimary: values.isPrimary,
      }),
    onSuccess: () => {
      toast({ title: 'Barcode added', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['items', 'barcodes', item.id] });
      setAddOpen(false);
    },
    onError: (error) => {
      if (isApiClientError(error) && error.code === 'DUPLICATE_CODE') {
        // Inline error on the barcode field per the contract's 409 semantics.
        form.setError('barcode', {
          type: 'server',
          message: 'This barcode is already actively mapped to an item.',
        });
        setServerError(null);
        return;
      }
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'barcode' || field === 'barcodeType') {
            form.setError(field, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (barcode: ItemBarcode) => archiveItemBarcode(item.id, barcode.id),
    onSuccess: () => {
      toast({ title: 'Barcode archived', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['items', 'barcodes', item.id] });
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    addMutation.mutate(values);
  });
  const { errors } = form.formState;

  return (
    <Card>
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="space-y-1">
          <CardTitle>Barcodes</CardTitle>
          <CardDescription>
            One primary SKU barcode plus supplier/UPC/EAN/packaging alternates. Duplicate active
            mappings are rejected.
          </CardDescription>
        </div>
        {canManage ? (
          <Button size="sm" className="mt-2 sm:mt-0" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden /> Add barcode
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {barcodesQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : barcodesQuery.isError ? (
          <div className="p-4">
            <ErrorState error={barcodesQuery.error} onRetry={() => barcodesQuery.refetch()} />
          </div>
        ) : barcodes.length === 0 ? (
          <EmptyState
            icon={Barcode}
            title="No barcodes yet"
            description={canManage ? 'Add the first barcode mapping for scanning workflows.' : undefined}
            action={
              canManage ? (
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  <Plus aria-hidden /> Add barcode
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Barcode</TableHead>
                <TableHead className="hidden sm:table-cell">Type</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Status</TableHead>
                {canManage ? <TableHead className="w-16 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {barcodes.map((barcode) => {
                const active = barcodeIsActive(barcode);
                return (
                  <TableRow key={barcode.id}>
                    <TableCell className="font-mono text-xs">{barcode.barcode}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {barcode.barcodeType || '—'}
                    </TableCell>
                    <TableCell>
                      {barcode.isPrimary ? <Badge>Primary</Badge> : <Badge variant="outline">Alternate</Badge>}
                    </TableCell>
                    <TableCell>
                      {active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="muted">Archived</Badge>
                      )}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        {active ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            aria-label={`Archive barcode ${barcode.barcode}`}
                            onClick={() => setArchiveTarget(barcode)}
                          >
                            <Archive className="h-3.5 w-3.5 text-destructive" aria-hidden />
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={(next) => !addMutation.isPending && setAddOpen(next)}>
        <DialogHeader>
          <DialogTitle>Add barcode</DialogTitle>
          <DialogDescription>
            Map a scanner code to <span className="font-mono">{item.sku}</span>. A barcode can be
            actively mapped to only one item.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="contents">
          <DialogBody className="space-y-4">
            <FormError message={serverError} />
            <FormField label="Barcode" htmlFor="barcode-code" error={errors.barcode?.message} required>
              <Input
                id="barcode-code"
                className="font-mono"
                aria-invalid={!!errors.barcode}
                data-autofocus
                {...form.register('barcode')}
              />
            </FormField>
            <FormField label="Type" htmlFor="barcode-type" error={errors.barcodeType?.message}>
              <Select id="barcode-type" {...form.register('barcodeType')}>
                {BARCODE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
            </FormField>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox {...form.register('isPrimary')} />
              Set as primary barcode
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addMutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={addMutation.isPending}>
              Add barcode
            </Button>
          </DialogFooter>
        </form>
      </Dialog>

      <ConfirmDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Archive barcode"
        destructive
        confirmLabel="Archive"
        description={
          <>
            <span className="font-mono text-foreground">{archiveTarget?.barcode}</span> will stop
            resolving to this item. The mapping history is preserved and the code can be reused.
          </>
        }
        onConfirm={async () => {
          if (archiveTarget) await archiveMutation.mutateAsync(archiveTarget);
        }}
      />
    </Card>
  );
}
