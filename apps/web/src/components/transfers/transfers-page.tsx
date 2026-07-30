'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, MoveRight, Plus } from 'lucide-react';
import { PERMISSIONS, TransferStatus } from '@gemerp/shared';
import { listTransfers } from '@/lib/endpoints';
import { refLabel, transferDestination, transferNumber, transferSource } from '@/lib/types';
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
import { transferStatusBadge } from '@/components/inventory/badges';
import { useBranchOptions } from '@/components/inventory/pickers';

export function TransfersPage() {
  const { can } = useSession();
  const { branches } = useBranchOptions();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [status, setStatus] = React.useState('');
  const [sourceBranchId, setSourceBranchId] = React.useState('');
  const [destinationBranchId, setDestinationBranchId] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');

  React.useEffect(() => {
    setPage(1);
  }, [status, sourceBranchId, destinationBranchId, from, to, pageSize]);

  const params = {
    page,
    pageSize,
    status: status || undefined,
    sourceBranchId: sourceBranchId || undefined,
    destinationBranchId: destinationBranchId || undefined,
    from: from || undefined,
    to: to || undefined,
    sort: 'createdAt:desc',
  };

  const transfersQuery = useQuery({
    queryKey: ['transfers', 'list', params],
    queryFn: ({ signal }) => listTransfers(params, signal),
    placeholderData: keepPreviousData,
  });

  const canCreate = can(PERMISSIONS.transfer.create);
  const data = transfersQuery.data;
  const hasFilters = !!(status || sourceBranchId || destinationBranchId || from || to);

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Controlled stock and asset moves — inter-branch transfers follow draft → approve → dispatch → receive."
        actions={
          canCreate ? (
            <Link href="/inventory/transfers/new" className={buttonVariants({})}>
              <Plus aria-hidden /> New transfer
            </Link>
          ) : undefined
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.values(TransferStatus).map((entry) => (
              <option key={entry} value={entry}>
                {humanize(entry)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by source branch"
            value={sourceBranchId}
            onChange={(event) => setSourceBranchId(event.target.value)}
          >
            <option value="">Any source branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by destination branch"
            value={destinationBranchId}
            onChange={(event) => setDestinationBranchId(event.target.value)}
          >
            <option value="">Any destination branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" />
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" />
        </div>

        {transfersQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : transfersQuery.isError ? (
          <div className="p-4">
            <ErrorState error={transfersQuery.error} onRetry={() => transfersQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title="No transfers"
            description={
              hasFilters ? 'Try adjusting your filters.' : 'Create the first transfer to move stock or assets.'
            }
            action={
              canCreate && !hasFilters ? (
                <Link href="/inventory/transfers/new" className={buttonVariants({})}>
                  <Plus aria-hidden /> New transfer
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
                  <TableHead>Status</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="hidden md:table-cell">Kind</TableHead>
                  <TableHead className="hidden lg:table-cell">Lines</TableHead>
                  <TableHead className="hidden sm:table-cell">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((transfer) => {
                  const source = transferSource(transfer);
                  const destination = transferDestination(transfer);
                  return (
                    <TableRow key={transfer.id}>
                      <TableCell>
                        <Link
                          href={`/inventory/transfers/${transfer.id}`}
                          className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {transferNumber(transfer)}
                        </Link>
                      </TableCell>
                      <TableCell>{transferStatusBadge(transfer.status)}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-sm">
                          <span className="max-w-[9rem] truncate">
                            {source.branch ? refLabel(source.branch) : (source.warehouse ? refLabel(source.warehouse) : '—')}
                          </span>
                          <MoveRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="max-w-[9rem] truncate">
                            {destination.branch
                              ? refLabel(destination.branch)
                              : destination.warehouse
                                ? refLabel(destination.warehouse)
                                : '—'}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {transfer.kind ? humanize(transfer.kind) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {transfer.lines ? transfer.lines.length : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                        {formatDate(transfer.createdAt)}
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
