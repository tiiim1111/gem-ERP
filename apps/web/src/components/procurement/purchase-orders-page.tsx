'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, ShoppingCart } from 'lucide-react';
import { PERMISSIONS, PurchaseOrderStatus } from '@gemerp/shared';
import { listPurchaseOrders } from '@/lib/endpoints';
import {
  formatMoney,
  poExpectedDate,
  poGrandTotal,
  purchaseOrderNumber,
  refLabel,
  supplierRefLabel,
} from '@/lib/types';
import { PROCUREMENT_COST_PERMISSIONS } from '@/lib/status-maps';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { formatDate, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranchOptions } from '@/components/inventory/pickers';
import { poStatusBadge } from '@/components/procurement/badges';
import { SupplierPicker } from '@/components/procurement/supplier-picker';

export function PurchaseOrdersPage() {
  const { can, canAny } = useSession();
  const { branches } = useBranchOptions();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [status, setStatus] = React.useState('');
  const [supplierId, setSupplierId] = React.useState<string | null>(null);
  const [branchId, setBranchId] = React.useState('');
  const [number, setNumber] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  const debouncedNumber = useDebouncedValue(number);

  React.useEffect(() => {
    setPage(1);
  }, [status, supplierId, branchId, debouncedNumber, from, to, pageSize]);

  const params = {
    page,
    pageSize,
    status: status || undefined,
    supplierId: supplierId ?? undefined,
    branchId: branchId || undefined,
    number: debouncedNumber || undefined,
    from: from || undefined,
    to: to || undefined,
    sort: 'createdAt:desc',
  };

  const posQuery = useQuery({
    queryKey: ['purchase-orders', 'list', params],
    queryFn: ({ signal }) => listPurchaseOrders(params, signal),
    placeholderData: keepPreviousData,
  });

  const canCreate = can(PERMISSIONS.procurementPo.create);
  const canViewCost = canAny(PROCUREMENT_COST_PERMISSIONS);
  const data = posQuery.data;
  const hasFilters = !!(status || supplierId || branchId || debouncedNumber || from || to);

  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="Draft → approval → receiving. Approved POs are immutable — material changes need cancel-and-recreate."
        actions={
          canCreate ? (
            <Link href="/procurement/purchase-orders/new" className={buttonVariants({})}>
              <Plus aria-hidden /> New purchase order
            </Link>
          ) : undefined
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-6">
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="PO number…"
            aria-label="Filter by PO number"
            className="font-mono"
          />
          <Select
            aria-label="Filter by status"
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
          <SupplierPicker
            id="po-filter-supplier"
            value={supplierId}
            onSelect={(supplier) => setSupplierId(supplier?.id ?? null)}
            activeOnly={false}
            placeholder="Any supplier…"
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
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" />
        </div>

        {posQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : posQuery.isError ? (
          <div className="p-4">
            <ErrorState error={posQuery.error} onRetry={() => posQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={ShoppingCart}
            title="No purchase orders"
            description={
              hasFilters ? 'Try adjusting your filters.' : 'Create the first purchase order to start procurement.'
            }
            action={
              canCreate && !hasFilters ? (
                <Link href="/procurement/purchase-orders/new" className={buttonVariants({})}>
                  <Plus aria-hidden /> New purchase order
                </Link>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="hidden md:table-cell">Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden sm:table-cell">Expected</TableHead>
                  {canViewCost ? <TableHead className="text-right">Total</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell>
                      <Link
                        href={`/procurement/purchase-orders/${po.id}`}
                        className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {purchaseOrderNumber(po)}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[14rem] truncate text-sm">
                      {supplierRefLabel(po.supplier)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {po.branch ? refLabel(po.branch) : '—'}
                    </TableCell>
                    <TableCell>{poStatusBadge(po.status)}</TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                      {formatDate(poExpectedDate(po))}
                    </TableCell>
                    {canViewCost ? (
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {formatMoney(poGrandTotal(po))}
                      </TableCell>
                    ) : null}
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
