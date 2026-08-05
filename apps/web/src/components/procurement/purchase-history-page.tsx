'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { PurchaseOrderStatus } from '@gemerp/shared';
import { listPurchaseHistory } from '@/lib/endpoints';
import {
  formatMoney,
  formatQuantity,
  historyCanceled,
  historyCost,
  historyOrdered,
  historyOutstanding,
  historyPoId,
  historyPoNumber,
  historyReceived,
  historyReturned,
  itemRefLabel,
  refLabel,
  supplierRefLabel,
} from '@/lib/types';
import { PROCUREMENT_COST_PERMISSIONS } from '@/lib/status-maps';
import { formatDate, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ItemPicker, useBranchOptions } from '@/components/inventory/pickers';
import { poStatusBadge } from '@/components/procurement/badges';
import { SupplierPicker } from '@/components/procurement/supplier-picker';

export function PurchaseHistoryPage() {
  const { canAny } = useSession();
  const { branches } = useBranchOptions();
  const canViewCost = canAny(PROCUREMENT_COST_PERMISSIONS);

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [supplierId, setSupplierId] = React.useState<string | null>(null);
  const [itemId, setItemId] = React.useState<string | null>(null);
  const [itemLabel, setItemLabel] = React.useState<string | null>(null);
  const [branchId, setBranchId] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  React.useEffect(() => {
    setPage(1);
  }, [supplierId, itemId, branchId, status, from, to, pageSize]);

  const params = {
    page,
    pageSize,
    supplierId: supplierId ?? undefined,
    itemId: itemId ?? undefined,
    branchId: branchId || undefined,
    status: status || undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const historyQuery = useQuery({
    queryKey: ['purchase-history', 'list', params],
    queryFn: ({ signal }) => listPurchaseHistory(params, signal),
    placeholderData: keepPreviousData,
  });

  const data = historyQuery.data;
  const hasFilters = !!(supplierId || itemId || branchId || status || from || to);

  return (
    <>
      <PageHeader
        title="Purchase history"
        description="Ordered vs received vs outstanding across suppliers, items, and branches."
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-6">
          <SupplierPicker
            id="ph-supplier"
            value={supplierId}
            onSelect={(supplier) => setSupplierId(supplier?.id ?? null)}
            activeOnly={false}
            placeholder="Any supplier…"
          />
          <ItemPicker
            id="ph-item"
            value={itemId}
            selectedLabel={itemLabel}
            onSelect={(item) => {
              setItemId(item?.id ?? null);
              setItemLabel(item?.name ?? null);
            }}
            placeholder="Any item…"
          />
          <Select
            aria-label="Filter by branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">Any branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by PO status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.values(PurchaseOrderStatus).map((entry) => (
              <option key={entry} value={entry}>
                {humanize(entry)}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" />
        </div>

        {historyQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : historyQuery.isError ? (
          <div className="p-4">
            <ErrorState error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={History}
            title="No purchase history"
            description={
              hasFilters
                ? 'Try adjusting your filters.'
                : 'History appears once purchase orders are created and received.'
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="hidden lg:table-cell">Supplier</TableHead>
                  <TableHead className="hidden xl:table-cell">Branch</TableHead>
                  <TableHead className="hidden md:table-cell">Status</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Canceled</TableHead>
                  <TableHead className="hidden text-right xl:table-cell">Returned</TableHead>
                  {canViewCost ? <TableHead className="text-right">Cost</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((row, index) => {
                  const poId = historyPoId(row);
                  const poNumber = historyPoNumber(row);
                  return (
                    <TableRow key={row.id ?? `${poId ?? 'row'}-${row.itemId ?? index}`}>
                      <TableCell>
                        {poId ? (
                          <Link
                            href={`/procurement/purchase-orders/${poId}`}
                            className="font-mono text-xs font-medium hover:underline"
                          >
                            {poNumber ?? 'View PO'}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs">{poNumber ?? '—'}</span>
                        )}
                        {row.orderDate ? (
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {formatDate(row.orderDate)}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[14rem] truncate text-sm">
                        {itemRefLabel(row.item ?? (row.itemId ? { id: row.itemId } : null))}
                      </TableCell>
                      <TableCell className="hidden max-w-[12rem] truncate text-sm text-muted-foreground lg:table-cell">
                        {supplierRefLabel(row.supplier)}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                        {row.branch ? refLabel(row.branch) : '—'}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {row.status ? poStatusBadge(row.status) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatQuantity(historyOrdered(row))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatQuantity(historyReceived(row))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                        {formatQuantity(historyOutstanding(row))}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums xl:table-cell">
                        {formatQuantity(historyCanceled(row))}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums xl:table-cell">
                        {formatQuantity(historyReturned(row))}
                      </TableCell>
                      {canViewCost ? (
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {formatMoney(historyCost(row))}
                        </TableCell>
                      ) : null}
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
