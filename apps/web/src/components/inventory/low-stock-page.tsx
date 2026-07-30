'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { listLowStock, unwrapList } from '@/lib/endpoints';
import {
  formatQuantity,
  itemRefLabel,
  lowStockAvailable,
  lowStockSuggested,
  refLabel,
} from '@/lib/types';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranchOptions, WarehouseSelect } from '@/components/inventory/pickers';

export function LowStockPage() {
  const { branches } = useBranchOptions();
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');

  const params = {
    branchId: branchId || undefined,
    warehouseId: warehouseId || undefined,
  };

  const lowStockQuery = useQuery({
    queryKey: ['low-stock', 'report', params],
    queryFn: ({ signal }) => listLowStock(params, signal),
  });

  const rows = lowStockQuery.data ? unwrapList(lowStockQuery.data) : [];

  return (
    <>
      <PageHeader
        title="Low stock"
        description="Items at or below their per-warehouse reorder level, with a suggested replenishment quantity."
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            aria-label="Filter by branch"
            value={branchId}
            onChange={(event) => {
              setBranchId(event.target.value);
              setWarehouseId('');
            }}
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <WarehouseSelect
            id="lowstock-warehouse"
            branchId={branchId}
            value={warehouseId}
            onChange={setWarehouseId}
          />
        </div>

        {lowStockQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : lowStockQuery.isError ? (
          <div className="p-4">
            <ErrorState error={lowStockQuery.error} onRetry={() => lowStockQuery.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={TriangleAlert}
            title="Nothing below reorder level"
            description="All items with configured reorder levels have sufficient available stock."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="hidden sm:table-cell">Warehouse</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Reorder level</TableHead>
                <TableHead className="text-right">Suggested qty</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow key={row.id ?? `${row.itemId}-${row.warehouseId}-${index}`}>
                  <TableCell className="text-sm font-medium">
                    {itemRefLabel(row.item ?? (row.itemId ? { id: row.itemId } : null))}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {row.warehouse ? refLabel(row.warehouse) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold tabular-nums text-destructive">
                    {formatQuantity(lowStockAvailable(row))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatQuantity(row.reorderLevel)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatQuantity(lowStockSuggested(row))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
