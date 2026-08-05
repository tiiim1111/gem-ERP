'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, Plus, Wrench } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage } from '@/lib/api';
import {
  listAssetMeterReadings,
  listWorkOrders,
  recordAssetMeterReading,
  unwrapList,
} from '@/lib/endpoints';
import {
  decimalValue,
  formatDowntime,
  formatMoney,
  formatQuantity,
  meterReadingAt,
  meterReadingValue,
  woDowntimeMinutes,
  workOrderNumber,
  woTotalCost,
  woType,
  type Asset,
} from '@/lib/types';
import { MAINTENANCE_COST_PERMISSIONS, WORK_ORDER_CREATE_PERMISSIONS } from '@/lib/status-maps';
import { formatDate, formatDateTime } from '@/lib/utils';
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
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { woPriorityBadge, woStatusBadge } from '@/components/maintenance/badges';
import { WorkOrderCreateDialog } from '@/components/maintenance/work-order-create-dialog';

/* --------------------------- Record meter reading --------------------------- */

function RecordMeterReadingDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: Asset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [readingValue, setReadingValue] = React.useState('');
  const [meterType, setMeterType] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setReadingValue('');
      setMeterType('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      recordAssetMeterReading(asset.id, {
        readingValue,
        meterType: meterType.trim() || undefined,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Meter reading recorded', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['assets', 'meter-readings', asset.id] });
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = () => {
    setError(null);
    const value = Number(readingValue);
    if (readingValue === '' || !Number.isFinite(value) || value < 0) {
      return setError('Reading must be zero or a positive number.');
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Record meter reading</DialogTitle>
        <DialogDescription>
          Usage readings drive meter-based preventive plans for this asset.
        </DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <DialogBody className="space-y-3">
          <FormError message={error} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Reading" htmlFor="meter-reading-value" required>
              <Input
                id="meter-reading-value"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={readingValue}
                onChange={(event) => setReadingValue(event.target.value)}
              />
            </FormField>
            <FormField label="Meter type" htmlFor="meter-reading-type" hint="e.g. hours, km, cycles.">
              <Input
                id="meter-reading-type"
                value={meterType}
                onChange={(event) => setMeterType(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Notes" htmlFor="meter-reading-notes">
            <Input id="meter-reading-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Record reading
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ------------------------------ Meter readings ------------------------------ */

function MeterReadingsBlock({ asset }: { asset: Asset }) {
  const { can } = useSession();
  const [recordOpen, setRecordOpen] = React.useState(false);
  const canRecord = can(PERMISSIONS.asset.update);

  const readingsQuery = useQuery({
    queryKey: ['assets', 'meter-readings', asset.id],
    queryFn: ({ signal }) => listAssetMeterReadings(asset.id, { page: 1, pageSize: 10 }, signal),
    retry: false,
  });
  const readings = readingsQuery.data ? unwrapList(readingsQuery.data) : [];

  // Endpoint not available yet (parallel backend) — hide instead of erroring.
  if (readingsQuery.isError) return null;

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden /> Meter readings
        </h3>
        {canRecord ? (
          <Button variant="outline" size="sm" onClick={() => setRecordOpen(true)}>
            <Plus aria-hidden /> Record reading
          </Button>
        ) : null}
      </div>
      {readingsQuery.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : readings.length === 0 ? (
        <p className="text-sm text-muted-foreground">No meter readings recorded yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {readings.map((reading) => (
            <li key={reading.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-mono text-xs tabular-nums">
                {formatQuantity(meterReadingValue(reading))}
                {reading.meterType ? ` ${reading.meterType}` : ''}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(meterReadingAt(reading))}
                {reading.recordedBy?.displayName ? ` · ${reading.recordedBy.displayName}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <RecordMeterReadingDialog asset={asset} open={recordOpen} onOpenChange={setRecordOpen} />
    </div>
  );
}

/* ------------------------- Maintenance history tab -------------------------- */

/**
 * Work-order history for one asset — rendered inside the asset detail tabs.
 * Costs are gated by the maintenance cost permission; downtime totals shown
 * for everyone with maintenance.work_order.view.
 */
export function AssetMaintenanceSection({ asset }: { asset: Asset }) {
  const { canAny } = useSession();
  const [createOpen, setCreateOpen] = React.useState(false);
  const canViewCost = canAny(MAINTENANCE_COST_PERMISSIONS);
  const canCreate = canAny(WORK_ORDER_CREATE_PERMISSIONS);

  const wosQuery = useQuery({
    queryKey: ['maintenance-work-orders', 'by-asset', asset.id],
    queryFn: ({ signal }) =>
      listWorkOrders({ page: 1, pageSize: 50, assetId: asset.id, sort: 'createdAt:desc' }, signal),
  });

  const wos = wosQuery.data?.data ?? [];
  const totals = React.useMemo(() => {
    let downtime = 0;
    let cost = 0;
    let hasCost = false;
    for (const wo of wos) {
      downtime += woDowntimeMinutes(wo) ?? 0;
      const total = woTotalCost(wo);
      if (total !== null) {
        cost += decimalValue(total);
        hasCost = true;
      }
    }
    return { downtime, cost: hasCost ? cost : null };
  }, [wos]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">Work orders:</span>{' '}
            <span className="font-semibold tabular-nums">{wosQuery.data?.meta.total ?? '—'}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Total downtime:</span>{' '}
            <span className="font-semibold tabular-nums">{formatDowntime(totals.downtime)}</span>
          </span>
          {canViewCost && totals.cost !== null ? (
            <span>
              <span className="text-muted-foreground">Total cost:</span>{' '}
              <span className="font-mono font-semibold tabular-nums">{formatMoney(totals.cost)}</span>
            </span>
          ) : null}
        </div>
        {canCreate ? (
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden /> New work order
          </Button>
        ) : null}
      </div>

      {wosQuery.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : wosQuery.isError ? (
        <ErrorState error={wosQuery.error} onRetry={() => wosQuery.refetch()} />
      ) : wos.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No maintenance history"
          description="No work orders have been raised for this asset."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead className="hidden sm:table-cell">Type</TableHead>
              <TableHead className="hidden md:table-cell">Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Completed</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Downtime</TableHead>
              {canViewCost ? <TableHead className="text-right">Cost</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {wos.map((wo) => (
              <TableRow key={wo.id}>
                <TableCell>
                  <Link
                    href={`/maintenance/work-orders/${wo.id}`}
                    className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {workOrderNumber(wo)}
                  </Link>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {woType(wo)?.name ?? '—'}
                </TableCell>
                <TableCell className="hidden md:table-cell">{woPriorityBadge(wo.priority)}</TableCell>
                <TableCell>{woStatusBadge(wo.status)}</TableCell>
                <TableCell className="hidden text-sm tabular-nums text-muted-foreground lg:table-cell">
                  {formatDate(wo.actualEndAt ?? wo.completedAt)}
                </TableCell>
                <TableCell className="hidden text-right text-sm tabular-nums sm:table-cell">
                  {formatDowntime(woDowntimeMinutes(wo))}
                </TableCell>
                {canViewCost ? (
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {woTotalCost(wo) !== null ? formatMoney(woTotalCost(wo)) : '—'}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <MeterReadingsBlock asset={asset} />
      <WorkOrderCreateDialog open={createOpen} onOpenChange={setCreateOpen} asset={asset} />
    </>
  );
}
