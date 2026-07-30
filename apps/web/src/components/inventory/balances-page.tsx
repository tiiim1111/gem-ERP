'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Boxes } from 'lucide-react';
import { listStockBalances } from '@/lib/endpoints';
import {
  balanceAvailable,
  balanceInTransfer,
  balanceOnHand,
  balanceReserved,
  formatQuantity,
  itemRefLabel,
  lotNumber,
  refLabel,
} from '@/lib/types';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  ItemPicker,
  LocationSelect,
  useBranchOptions,
  WarehouseSelect,
} from '@/components/inventory/pickers';

export function BalancesPage({
  initialLocationId,
  initialItemId,
}: {
  initialLocationId?: string;
  initialItemId?: string;
}) {
  useSession(); // guard: page only renders inside the session provider
  const { branches } = useBranchOptions();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [locationId, setLocationId] = React.useState(initialLocationId ?? '');
  const [itemId, setItemId] = React.useState<string | null>(initialItemId ?? null);

  React.useEffect(() => {
    setPage(1);
  }, [branchId, warehouseId, locationId, itemId, pageSize]);

  const params = {
    page,
    pageSize,
    branchId: branchId || undefined,
    warehouseId: warehouseId || undefined,
    locationId: locationId || undefined,
    itemId: itemId ?? undefined,
  };

  const balancesQuery = useQuery({
    queryKey: ['stock-balances', 'list', params],
    queryFn: ({ signal }) => listStockBalances(params, signal),
    placeholderData: keepPreviousData,
  });

  const data = balancesQuery.data;

  return (
    <>
      <PageHeader
        title="Stock balances"
        description="On-hand vs available projections per warehouse, location, item, and lot. Click a row to drill into the ledger."
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            aria-label="Filter by branch"
            value={branchId}
            onChange={(event) => {
              setBranchId(event.target.value);
              setWarehouseId('');
              setLocationId('');
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
            id="bal-warehouse"
            branchId={branchId}
            value={warehouseId}
            onChange={(next) => {
              setWarehouseId(next);
              setLocationId('');
            }}
          />
          <LocationSelect
            id="bal-location"
            warehouseId={warehouseId}
            value={locationId}
            onChange={setLocationId}
            allowEmptyLabel="All locations"
          />
          <ItemPicker
            id="bal-item"
            value={itemId}
            onSelect={(item) => setItemId(item?.id ?? null)}
            placeholder="Filter by item…"
          />
        </div>

        {balancesQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : balancesQuery.isError ? (
          <div className="p-4">
            <ErrorState error={balancesQuery.error} onRetry={() => balancesQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No stock balances"
            description="Balances appear once transactions are posted for the selected scope."
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                  <TableHead className="hidden lg:table-cell">Location</TableHead>
                  <TableHead className="hidden lg:table-cell">Lot</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Reserved</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">In transfer</TableHead>
                  <TableHead className="w-20 text-right">Ledger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((row, index) => {
                  const ledgerHref = `/inventory/ledger?${new URLSearchParams({
                    ...(row.itemId ? { itemId: row.itemId } : {}),
                    ...(row.warehouseId ? { warehouseId: row.warehouseId } : {}),
                  }).toString()}`;
                  return (
                    <TableRow key={row.id ?? `${row.itemId}-${row.warehouseId}-${row.locationId}-${row.lotId}-${index}`}>
                      <TableCell className="text-sm font-medium">
                        {itemRefLabel(row.item ?? (row.itemId ? { id: row.itemId } : null))}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {row.warehouse ? refLabel(row.warehouse) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {row.location ? refLabel(row.location) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {row.lot ? lotNumber(row.lot) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatQuantity(balanceOnHand(row))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {formatQuantity(balanceAvailable(row))}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                        {formatQuantity(balanceReserved(row))}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                        {formatQuantity(balanceInTransfer(row))}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={ledgerHref}
                          className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>
    </>
  );
}
