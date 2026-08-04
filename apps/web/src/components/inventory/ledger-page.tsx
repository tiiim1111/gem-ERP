'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { listStockLedger } from '@/lib/endpoints';
import { itemRefLabel, ledgerQuantity, ledgerTimestamp, lotNumber, refLabel } from '@/lib/types';
import {
  CREATABLE_TRANSACTION_TYPES,
  stockTransactionTypeLabel,
} from '@/lib/status-maps';
import { formatDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SignedQuantity } from '@/components/inventory/badges';
import { ItemPicker, useBranchOptions, WarehouseSelect } from '@/components/inventory/pickers';
import { StockTransactionType } from '@gemerp/shared';

export function LedgerPage({
  initialItemId,
  initialWarehouseId,
}: {
  initialItemId?: string;
  initialWarehouseId?: string;
}) {
  const { branches } = useBranchOptions();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState(initialWarehouseId ?? '');
  const [itemId, setItemId] = React.useState<string | null>(initialItemId ?? null);
  const [type, setType] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  React.useEffect(() => {
    setPage(1);
  }, [branchId, warehouseId, itemId, type, from, to, pageSize]);

  const params = {
    page,
    pageSize,
    warehouseId: warehouseId || undefined,
    itemId: itemId ?? undefined,
    type: type || undefined,
    from: from || undefined,
    to: to || undefined,
    sort: 'postedAt:desc',
  };

  const ledgerQuery = useQuery({
    queryKey: ['stock-ledger', 'list', params],
    queryFn: ({ signal }) => listStockLedger(params, signal),
    placeholderData: keepPreviousData,
  });

  const data = ledgerQuery.data;
  const allTypes = [
    ...CREATABLE_TRANSACTION_TYPES,
    StockTransactionType.INTER_BRANCH_TRANSFER_OUT,
    StockTransactionType.INTER_BRANCH_TRANSFER_IN,
    StockTransactionType.REVERSAL,
  ];

  return (
    <>
      <PageHeader
        title="Stock ledger"
        description="Append-only movement history. Every row is written by a posted document and is never edited."
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-3">
          <ItemPicker
            id="ledger-item"
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
            id="ledger-warehouse"
            branchId={branchId}
            value={warehouseId}
            onChange={setWarehouseId}
          />
          <Select
            aria-label="Filter by transaction type"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">All types</option>
            {allTypes.map((entry) => (
              <option key={entry} value={entry}>
                {stockTransactionTypeLabel(entry)}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" />
        </div>

        {ledgerQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : ledgerQuery.isError ? (
          <div className="p-4">
            <ErrorState error={ledgerQuery.error} onRetry={() => ledgerQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No ledger entries"
            description="Entries appear as soon as a stock transaction is posted in this scope."
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden lg:table-cell">Warehouse</TableHead>
                  <TableHead className="hidden xl:table-cell">Lot</TableHead>
                  <TableHead className="hidden sm:table-cell">Document</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatDateTime(ledgerTimestamp(entry))}
                    </TableCell>
                    <TableCell className="text-sm font-medium">{itemRefLabel(entry.item ?? null)}</TableCell>
                    <TableCell className="text-right">
                      <SignedQuantity value={ledgerQuantity(entry)} />
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {entry.transaction?.type || entry.transactionType || entry.type
                        ? stockTransactionTypeLabel(
                            entry.transaction?.type ?? entry.transactionType ?? entry.type ?? '',
                          )
                        : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {entry.warehouse ? refLabel(entry.warehouse) : '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                      {entry.lot ? lotNumber(entry.lot) : '—'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {(() => {
                        const txnId = entry.transaction?.id ?? entry.transactionId;
                        const txnNumber =
                          entry.transaction?.transactionNumber ?? entry.transactionNumber;
                        return txnId ? (
                          <Link
                            href={`/inventory/transactions/${txnId}`}
                            className="font-mono text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {txnNumber ?? 'View'}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">
                            {txnNumber ?? '—'}
                          </span>
                        );
                      })()}
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
