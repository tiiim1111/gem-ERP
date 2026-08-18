'use client';

import * as React from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Warehouse as WarehouseIcon } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import {
  listBranches,
  listItemWarehouseSettings,
  listWarehouses,
  unwrapList,
  upsertItemWarehouseSetting,
} from '@/lib/endpoints';
import { settingWarehouseId, type Item, type ItemWarehouseSetting } from '@/lib/types';
import { useSession } from '@/components/auth/session-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';

const QTY_PATTERN = /^\d+(\.\d{1,4})?$/;

type FieldKey = 'reorderLevel' | 'reorderQuantity' | 'minQuantity' | 'maxQuantity';

const FIELDS: Array<{ key: FieldKey; label: string }> = [
  { key: 'reorderLevel', label: 'Reorder level' },
  { key: 'reorderQuantity', label: 'Reorder qty' },
  { key: 'minQuantity', label: 'Min stock' },
  { key: 'maxQuantity', label: 'Max stock' },
];

type Draft = Record<FieldKey, string>;

function settingToDraft(setting: ItemWarehouseSetting | undefined): Draft {
  const normalize = (value: string | number | null | undefined) =>
    value === null || value === undefined ? '' : String(Number(value));
  return {
    reorderLevel: normalize(setting?.reorderLevel),
    reorderQuantity: normalize(setting?.reorderQuantity),
    minQuantity: normalize(setting?.minQuantity),
    maxQuantity: normalize(setting?.maxQuantity),
  };
}

function draftsEqual(a: Draft, b: Draft): boolean {
  return FIELDS.every(({ key }) => a[key] === b[key]);
}

interface GridRow {
  warehouseId: string;
  warehouseLabel: string;
  branchLabel: string;
  setting?: ItemWarehouseSetting;
}

/** Editable reorder policy per warehouse in the caller's accessible branches. */
export function ItemWarehouseSettingsCard({ item, canManage }: { item: Item; canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useSession();

  const settingsQuery = useQuery({
    queryKey: ['items', 'warehouse-settings', item.id],
    queryFn: ({ signal }) => listItemWarehouseSettings(item.id, signal),
  });
  const settings = React.useMemo(
    () => (settingsQuery.data ? unwrapList(settingsQuery.data) : []),
    [settingsQuery.data],
  );

  const branchesQuery = useQuery({
    queryKey: ['branches', 'options'],
    queryFn: ({ signal }) => listBranches({ page: 1, pageSize: 100 }, signal),
  });
  const accessibleBranches = React.useMemo(() => {
    const branches = branchesQuery.data?.data ?? [];
    if (user.isSuperAdmin) return branches;
    return branches.filter((branch) => user.branchIds.includes(branch.id));
  }, [branchesQuery.data, user]);

  const warehouseQueries = useQueries({
    queries: accessibleBranches.map((branch) => ({
      queryKey: ['warehouses', branch.id],
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        listWarehouses(branch.id, { page: 1, pageSize: 100 }, signal),
    })),
  });
  const warehousesLoading = warehouseQueries.some((query) => query.isPending);

  // Merge accessible warehouses with any settings rows the API returned.
  const rows = React.useMemo<GridRow[]>(() => {
    const byWarehouse = new Map<string, ItemWarehouseSetting>();
    for (const setting of settings) byWarehouse.set(settingWarehouseId(setting), setting);

    const branchCodeById = new Map(accessibleBranches.map((branch) => [branch.id, branch.code]));
    const merged: GridRow[] = [];
    const seen = new Set<string>();
    accessibleBranches.forEach((branch, index) => {
      const warehouses = warehouseQueries[index]?.data?.data ?? [];
      for (const warehouse of warehouses) {
        seen.add(warehouse.id);
        merged.push({
          warehouseId: warehouse.id,
          warehouseLabel: `${warehouse.name} (${warehouse.code})`,
          branchLabel: branch.code,
          setting: byWarehouse.get(warehouse.id),
        });
      }
    });
    // Settings for warehouses we could not enumerate (defensive).
    for (const setting of settings) {
      const warehouseId = settingWarehouseId(setting);
      if (!warehouseId || seen.has(warehouseId)) continue;
      merged.push({
        warehouseId,
        warehouseLabel: setting.warehouse
          ? `${setting.warehouse.name} (${setting.warehouse.code})`
          : warehouseId,
        branchLabel:
          setting.warehouse?.branch?.code ??
          (setting.warehouse?.branchId ? (branchCodeById.get(setting.warehouse.branchId) ?? '—') : '—'),
        setting,
      });
    }
    return merged;
  }, [accessibleBranches, warehouseQueries, settings]);

  // Per-warehouse editable drafts.
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  React.useEffect(() => {
    // Reset drafts whenever fresh settings arrive.
    setDrafts({});
  }, [settings]);

  const draftFor = (row: GridRow): Draft => drafts[row.warehouseId] ?? settingToDraft(row.setting);

  const setDraftField = (row: GridRow, key: FieldKey, value: string) => {
    setDrafts((current) => ({
      ...current,
      [row.warehouseId]: { ...draftFor(row), [key]: value },
    }));
  };

  const saveMutation = useMutation({
    mutationFn: ({ row, draft }: { row: GridRow; draft: Draft }) =>
      upsertItemWarehouseSetting(item.id, row.warehouseId, {
        reorderLevel: draft.reorderLevel || null,
        reorderQuantity: draft.reorderQuantity || null,
        minQuantity: draft.minQuantity || null,
        maxQuantity: draft.maxQuantity || null,
      }),
    onSuccess: (_, { row }) => {
      toast({
        title: 'Stocking rules saved',
        description: row.warehouseLabel,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['items', 'warehouse-settings', item.id] });
    },
    onError: (error) => {
      toast({
        title: 'Could not save stocking rules',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const loading = settingsQuery.isPending || branchesQuery.isPending || warehousesLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Warehouse settings</CardTitle>
        <CardDescription>
          Reorder level, reorder quantity, and min/max stock per warehouse — drives low-stock alerts.
          Quantities are in the base unit{item.baseUom ? ` (${item.baseUom.code})` : ''}.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : settingsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={settingsQuery.error} onRetry={() => settingsQuery.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={WarehouseIcon}
            title="No accessible warehouses"
            description="Warehouses in your accessible branches will appear here."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Warehouse</TableHead>
                {FIELDS.map((field) => (
                  <TableHead key={field.key}>{field.label}</TableHead>
                ))}
                {canManage ? <TableHead className="w-20 text-right">Save</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const draft = draftFor(row);
                const baseline = settingToDraft(row.setting);
                const dirty = !draftsEqual(draft, baseline);
                const invalid = FIELDS.some(
                  ({ key }) => draft[key] !== '' && !QTY_PATTERN.test(draft[key]),
                );
                const saving =
                  saveMutation.isPending && saveMutation.variables?.row.warehouseId === row.warehouseId;
                return (
                  <TableRow key={row.warehouseId}>
                    <TableCell>
                      <p className="text-sm font-medium">{row.warehouseLabel}</p>
                      <p className="text-xs text-muted-foreground">{row.branchLabel}</p>
                    </TableCell>
                    {FIELDS.map(({ key, label }) => {
                      const fieldInvalid = draft[key] !== '' && !QTY_PATTERN.test(draft[key]);
                      return (
                        <TableCell key={key}>
                          <Input
                            aria-label={`${label} for ${row.warehouseLabel}`}
                            aria-invalid={fieldInvalid}
                            inputMode="decimal"
                            className="h-8 w-24 text-right font-mono text-xs"
                            value={draft[key]}
                            disabled={!canManage}
                            onChange={(event) => setDraftField(row, key, event.target.value)}
                          />
                        </TableCell>
                      );
                    })}
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!dirty || invalid}
                          loading={saving}
                          onClick={() => saveMutation.mutate({ row, draft })}
                        >
                          Save
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
