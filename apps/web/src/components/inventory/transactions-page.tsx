'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { StockTransactionStatus } from '@gemerp/shared';
import { listStockTransactions } from '@/lib/endpoints';
import { itemRefLabel, refLabel, stockTransactionNumber } from '@/lib/types';
import {
  CREATABLE_TRANSACTION_TYPES,
  STOCK_TRANSACTION_TYPE_PERMISSION,
  stockTransactionTypeLabel,
} from '@/lib/status-maps';
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
import { stockTransactionStatusBadge } from '@/components/inventory/badges';
import { ItemPicker, useBranchOptions, WarehouseSelect } from '@/components/inventory/pickers';
import { useDebouncedValue } from '@/lib/use-debounced-value';

export function TransactionsPage() {
  const { canAny } = useSession();
  const { branches } = useBranchOptions();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [type, setType] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [itemId, setItemId] = React.useState<string | null>(null);
  const [number, setNumber] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const debouncedNumber = useDebouncedValue(number);

  React.useEffect(() => {
    setPage(1);
  }, [type, status, branchId, warehouseId, itemId, debouncedNumber, from, to, pageSize]);

  React.useEffect(() => {
    setWarehouseId('');
  }, [branchId]);

  const params = {
    page,
    pageSize,
    type: type || undefined,
    status: status || undefined,
    branchId: branchId || undefined,
    warehouseId: warehouseId || undefined,
    itemId: itemId ?? undefined,
    number: debouncedNumber || undefined,
    from: from || undefined,
    to: to || undefined,
    sort: 'createdAt:desc',
  };

  const transactionsQuery = useQuery({
    queryKey: ['stock-transactions', 'list', params],
    queryFn: ({ signal }) => listStockTransactions(params, signal),
    placeholderData: keepPreviousData,
  });

  const canCreate = canAny(Object.values(STOCK_TRANSACTION_TYPE_PERMISSION));
  const data = transactionsQuery.data;
  const hasFilters = !!(type || status || branchId || warehouseId || itemId || debouncedNumber || from || to);

  return (
    <>
      <PageHeader
        title="Stock transactions"
        description="Receipts, issues, returns, adjustments, and write-offs. Only posted documents move stock."
        actions={
          canCreate ? (
            <Link href="/inventory/transactions/new" className={buttonVariants({})}>
              <Plus aria-hidden /> New transaction
            </Link>
          ) : undefined
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="Transaction number…"
            aria-label="Filter by transaction number"
          />
          <Select aria-label="Filter by type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            {CREATABLE_TRANSACTION_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {stockTransactionTypeLabel(entry)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.values(StockTransactionStatus).map((entry) => (
              <option key={entry} value={entry}>
                {humanize(entry)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <WarehouseSelect
            id="txn-filter-warehouse"
            branchId={branchId}
            value={warehouseId}
            onChange={setWarehouseId}
          />
          <ItemPicker
            id="txn-filter-item"
            value={itemId}
            onSelect={(item) => setItemId(item?.id ?? null)}
            placeholder="Filter by item…"
          />
          <Input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="From date"
          />
          <Input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label="To date"
          />
        </div>

        {transactionsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : transactionsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={transactionsQuery.error} onRetry={() => transactionsQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No stock transactions"
            description={
              hasFilters
                ? 'Try adjusting your filters.'
                : 'Create the first transaction to start moving stock.'
            }
            action={
              canCreate && !hasFilters ? (
                <Link href="/inventory/transactions/new" className={buttonVariants({})}>
                  <Plus aria-hidden /> New transaction
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
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Branch</TableHead>
                  <TableHead className="hidden md:table-cell">Warehouse</TableHead>
                  <TableHead className="hidden lg:table-cell">Lines</TableHead>
                  <TableHead className="hidden sm:table-cell">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((txn) => (
                  <TableRow key={txn.id}>
                    <TableCell>
                      <Link
                        href={`/inventory/transactions/${txn.id}`}
                        className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {stockTransactionNumber(txn)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{stockTransactionTypeLabel(txn.type)}</TableCell>
                    <TableCell>{stockTransactionStatusBadge(txn.status)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {txn.branch ? refLabel(txn.branch) : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {txn.warehouse ? refLabel(txn.warehouse) : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {txn.lines
                        ? `${txn.lines.length} ${txn.lines.length === 1 ? 'line' : 'lines'}${
                            txn.lines[0] ? ` · ${itemRefLabel(txn.lines[0].item ?? null)}` : ''
                          }`
                        : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                      {formatDate(txn.transactionDate ?? txn.createdAt)}
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
