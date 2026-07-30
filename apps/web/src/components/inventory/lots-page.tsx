'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { listLots } from '@/lib/endpoints';
import {
  formatQuantity,
  itemRefLabel,
  lotAvailable,
  lotExpiry,
  lotNumber,
  lotOnHand,
  refLabel,
} from '@/lib/types';
import { formatDate, humanize } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { expiryBadge } from '@/components/inventory/badges';
import { ItemPicker, useBranchOptions, WarehouseSelect } from '@/components/inventory/pickers';

function isoDateDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export function LotsPage() {
  const { branches } = useBranchOptions();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [itemId, setItemId] = React.useState<string | null>(null);
  const [expiringOnly, setExpiringOnly] = React.useState(false);

  React.useEffect(() => {
    setPage(1);
  }, [branchId, warehouseId, itemId, expiringOnly, pageSize]);

  const params = {
    page,
    pageSize,
    warehouseId: warehouseId || undefined,
    itemId: itemId ?? undefined,
    expiresBefore: expiringOnly ? isoDateDaysFromNow(30) : undefined,
    // FEFO hint: earliest expiry first, so pickers see what should move first.
    sort: 'expiryDate:asc',
  };

  const lotsQuery = useQuery({
    queryKey: ['lots', 'list', params],
    queryFn: ({ signal }) => listLots(params, signal),
    placeholderData: keepPreviousData,
  });

  const data = lotsQuery.data;

  return (
    <>
      <PageHeader
        title="Lots"
        description="Batch/lot records with expiry tracking, ordered FEFO — first-expired, first-out."
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
          <ItemPicker
            id="lots-item"
            value={itemId}
            onSelect={(item) => setItemId(item?.id ?? null)}
            placeholder="Filter by item…"
          />
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
            id="lots-warehouse"
            branchId={branchId}
            value={warehouseId}
            onChange={setWarehouseId}
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={expiringOnly}
              onChange={(event) => setExpiringOnly(event.target.checked)}
            />
            Expiring within 30 days
          </label>
        </div>

        {lotsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : lotsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={lotsQuery.error} onRetry={() => lotsQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No lots found"
            description="Lots are created by posting receipts of lot-tracked items."
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lot</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                  <TableHead className="hidden sm:table-cell">Expiry date</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Available</TableHead>
                  <TableHead className="hidden lg:table-cell">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((lot) => (
                  <TableRow key={lot.id}>
                    <TableCell className="font-mono text-xs font-medium">{lotNumber(lot)}</TableCell>
                    <TableCell className="text-sm">{itemRefLabel(lot.item ?? null)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {lot.warehouse ? refLabel(lot.warehouse) : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                      {formatDate(lotExpiry(lot))}
                    </TableCell>
                    <TableCell>{expiryBadge(lotExpiry(lot))}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatQuantity(lotOnHand(lot))}
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                      {formatQuantity(lotAvailable(lot))}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {lot.status ? <Badge variant="outline">{humanize(lot.status)}</Badge> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>
    </>
  );
}
