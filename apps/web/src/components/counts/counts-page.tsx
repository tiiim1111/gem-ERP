'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ClipboardCheck, Plus } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { listCountSessions } from '@/lib/endpoints';
import { countScopeSummary, countSessionIsBlind, countSessionNumber, refLabel } from '@/lib/types';
import { COUNT_SESSION_STATUS_LABELS } from '@/lib/status-maps';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { formatDate } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
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
import { countSessionStatusBadge, countTypeBadge } from '@/components/counts/badges';

export function CountsPage() {
  const { can } = useSession();
  const { branches } = useBranchOptions();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [status, setStatus] = React.useState('');
  const [type, setType] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [number, setNumber] = React.useState('');

  const debouncedNumber = useDebouncedValue(number);

  React.useEffect(() => {
    setPage(1);
  }, [status, type, branchId, debouncedNumber, pageSize]);

  const params = {
    page,
    pageSize,
    status: status || undefined,
    type: type || undefined,
    branchId: branchId || undefined,
    number: debouncedNumber || undefined,
    sort: 'createdAt:desc',
  };

  const sessionsQuery = useQuery({
    queryKey: ['count-sessions', 'list', params],
    queryFn: ({ signal }) => listCountSessions(params, signal),
    placeholderData: keepPreviousData,
  });

  const canCreate = can(PERMISSIONS.count.create);
  const data = sessionsQuery.data;
  const hasFilters = !!(status || type || branchId || debouncedNumber);

  return (
    <>
      <PageHeader
        title="Count sessions"
        description="Physical and cycle counts. Discrepancies never overwrite stock — approved variances create draft adjustment transactions."
        actions={
          canCreate ? (
            <Link href="/inventory/counts/new" className={buttonVariants({})}>
              <Plus aria-hidden /> New count
            </Link>
          ) : undefined
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            placeholder="Count number…"
            aria-label="Filter by count number"
            className="font-mono"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.entries(COUNT_SESSION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            <option value="full">Full count</option>
            <option value="cycle">Cycle count</option>
          </Select>
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
        </div>

        {sessionsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : sessionsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={sessionsQuery.error} onRetry={() => sessionsQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No count sessions"
            description={
              hasFilters ? 'Try adjusting your filters.' : 'Start a physical or cycle count to verify stock and assets.'
            }
            action={
              canCreate && !hasFilters ? (
                <Link href="/inventory/counts/new" className={buttonVariants({})}>
                  <Plus aria-hidden /> New count
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
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="hidden md:table-cell">Branch</TableHead>
                  <TableHead className="hidden lg:table-cell">Scope</TableHead>
                  <TableHead className="hidden sm:table-cell">Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <Link
                        href={`/inventory/counts/${session.id}`}
                        className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {countSessionNumber(session)}
                      </Link>
                      {countSessionIsBlind(session) ? (
                        <Badge variant="outline" className="ml-2">
                          Blind
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>{countSessionStatusBadge(session.status)}</TableCell>
                    <TableCell className="hidden sm:table-cell">{countTypeBadge(session.type)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {session.branch ? refLabel(session.branch) : '—'}
                    </TableCell>
                    <TableCell className="hidden max-w-[16rem] truncate text-sm text-muted-foreground lg:table-cell">
                      {countScopeSummary(session)}
                    </TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                      {formatDate(session.startedAt ?? session.createdAt)}
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
