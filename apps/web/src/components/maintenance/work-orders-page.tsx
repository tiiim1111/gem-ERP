'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { LayoutGrid, List, Plus, UserRound, Wrench } from 'lucide-react';
import { WorkOrderStatus } from '@gemerp/shared';
import { listWorkOrders, type WorkOrderListParams } from '@/lib/endpoints';
import {
  assetTag,
  itemRefLabel,
  woAssigneeLabel,
  woPlannedStart,
  workOrderNumber,
  woProblem,
  woType,
  type WorkOrder,
} from '@/lib/types';
import {
  MAINTENANCE_PLAN_MANAGE_PERMISSIONS,
  WORK_ORDER_CREATE_PERMISSIONS,
  workOrderStatusLabel,
} from '@/lib/status-maps';
import { cn, formatDate } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBranchOptions, LookupSelect } from '@/components/inventory/pickers';
import { woPriorityBadge, woStatusBadge } from '@/components/maintenance/badges';
import { WorkOrderCreateDialog } from '@/components/maintenance/work-order-create-dialog';

/** Column order for the board view. */
const BOARD_STATUSES: string[] = [
  WorkOrderStatus.DRAFT,
  WorkOrderStatus.OPEN,
  WorkOrderStatus.ASSIGNED,
  WorkOrderStatus.SCHEDULED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.ON_HOLD,
  WorkOrderStatus.AWAITING_PARTS,
  WorkOrderStatus.AWAITING_VENDOR,
  WorkOrderStatus.COMPLETED,
  WorkOrderStatus.VERIFIED,
  WorkOrderStatus.CANCELED,
];

function BoardCard({ wo }: { wo: WorkOrder }) {
  return (
    <Link
      href={`/maintenance/work-orders/${wo.id}`}
      className="block rounded-md border bg-background p-2.5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium">{workOrderNumber(wo)}</span>
        {woPriorityBadge(wo.priority)}
      </div>
      <p className="mt-1 truncate text-sm font-medium">{wo.asset ? assetTag(wo.asset) : '—'}</p>
      <p className="truncate text-xs text-muted-foreground">
        {woProblem(wo) ?? itemRefLabel(wo.asset?.item ?? null)}
      </p>
      {woAssigneeLabel(wo) ? (
        <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <UserRound className="h-3 w-3 shrink-0" aria-hidden /> {woAssigneeLabel(wo)}
        </p>
      ) : null}
    </Link>
  );
}

export function WorkOrdersPage() {
  const { canAny } = useSession();
  const { branches } = useBranchOptions();

  const canCreate = canAny(WORK_ORDER_CREATE_PERMISSIONS);
  // Managers see branch-wide by default; technicians land on their own queue.
  const isManager = canAny([
    'maintenance.work_order.manage',
    'maintenance.work_order.assign',
    ...MAINTENANCE_PLAN_MANAGE_PERMISSIONS,
  ]);

  const [view, setView] = React.useState<'table' | 'board'>('table');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [status, setStatus] = React.useState('');
  const [typeId, setTypeId] = React.useState('');
  const [priorityId, setPriorityId] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [assignedToMe, setAssignedToMe] = React.useState(!isManager);
  const [due, setDue] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);

  React.useEffect(() => {
    setPage(1);
  }, [status, typeId, priorityId, branchId, assignedToMe, due, from, to, pageSize, view]);

  const dueBefore = React.useMemo(() => {
    if (due === 'overdue') return new Date().toISOString();
    if (due === 'week') {
      const date = new Date();
      date.setDate(date.getDate() + 7);
      return date.toISOString();
    }
    return undefined;
  }, [due]);

  const params: WorkOrderListParams = {
    page: view === 'board' ? 1 : page,
    pageSize: view === 'board' ? 100 : pageSize,
    status: status || undefined,
    typeId: typeId || undefined,
    priorityId: priorityId || undefined,
    branchId: branchId || undefined,
    assignedToMe: assignedToMe || undefined,
    dueBefore,
    from: from || undefined,
    to: to || undefined,
    sort: 'createdAt:desc',
  };

  const wosQuery = useQuery({
    queryKey: ['maintenance-work-orders', 'list', params],
    queryFn: ({ signal }) => listWorkOrders(params, signal),
    placeholderData: keepPreviousData,
  });

  const data = wosQuery.data;
  const hasFilters = !!(status || typeId || priorityId || branchId || dueBefore || from || to);

  return (
    <>
      <PageHeader
        title="Work orders"
        description="Corrective and preventive maintenance — from report to verified completion."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={view === 'table' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
            >
              <List aria-hidden /> Table
            </Button>
            <Button
              variant={view === 'board' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setView('board')}
              aria-pressed={view === 'board'}
            >
              <LayoutGrid aria-hidden /> Board
            </Button>
            {canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden /> New work order
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <div className="space-y-2 border-b p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={assignedToMe ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAssignedToMe((current) => !current)}
              aria-pressed={assignedToMe}
            >
              <UserRound aria-hidden /> Assigned to me
            </Button>
            <Select
              aria-label="Filter by due date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
              className="w-auto"
            >
              <option value="">Any due date</option>
              <option value="overdue">Overdue now</option>
              <option value="week">Due within 7 days</option>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {Object.values(WorkOrderStatus).map((entry) => (
                <option key={entry} value={entry}>
                  {workOrderStatusLabel(entry)}
                </option>
              ))}
            </Select>
            <LookupSelect
              id="wo-filter-type"
              type="maintenance-types"
              value={typeId}
              onChange={setTypeId}
              placeholder="Any type"
            />
            <LookupSelect
              id="wo-filter-priority"
              type="maintenance-priorities"
              value={priorityId}
              onChange={setPriorityId}
              placeholder="Any priority"
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
        </div>

        {wosQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : wosQuery.isError ? (
          <div className="p-4">
            <ErrorState error={wosQuery.error} onRetry={() => wosQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={Wrench}
            title="No work orders"
            description={
              hasFilters || assignedToMe
                ? 'Try adjusting your filters — or clear "Assigned to me".'
                : 'Create the first work order to start tracking maintenance.'
            }
            action={
              canCreate && !hasFilters ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden /> New work order
                </Button>
              ) : undefined
            }
          />
        ) : data && view === 'board' ? (
          <div className="overflow-x-auto p-3">
            <div className="flex min-w-max gap-3">
              {BOARD_STATUSES.map((entry) => {
                const cards = data.data.filter((wo) => wo.status === entry);
                if (cards.length === 0) return null;
                return (
                  <div key={entry} className="w-64 shrink-0 rounded-lg bg-muted/50 p-2">
                    <div className="mb-2 flex items-center justify-between px-1">
                      {woStatusBadge(entry)}
                      <span className="text-xs tabular-nums text-muted-foreground">{cards.length}</span>
                    </div>
                    <div className="space-y-2">
                      {cards.map((wo) => (
                        <BoardCard key={wo.id} wo={wo} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {data.meta.total > data.data.length ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing the {data.data.length} most recent of {data.meta.total} work orders — narrow the
                filters or use the table view for the rest.
              </p>
            ) : null}
          </div>
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead className="hidden sm:table-cell">Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Assigned to</TableHead>
                  <TableHead className="hidden xl:table-cell">Planned start</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((wo) => (
                  <TableRow key={wo.id}>
                    <TableCell>
                      <Link
                        href={`/maintenance/work-orders/${wo.id}`}
                        className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {workOrderNumber(wo)}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[14rem]">
                      <span className="block truncate font-mono text-xs">
                        {wo.asset ? assetTag(wo.asset) : '—'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {itemRefLabel(wo.asset?.item ?? null)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {woType(wo)?.name ?? '—'}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{woPriorityBadge(wo.priority)}</TableCell>
                    <TableCell>{woStatusBadge(wo.status)}</TableCell>
                    <TableCell
                      className={cn(
                        'hidden max-w-[12rem] truncate text-sm lg:table-cell',
                        woAssigneeLabel(wo) ? undefined : 'text-muted-foreground',
                      )}
                    >
                      {woAssigneeLabel(wo) ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground xl:table-cell">
                      {formatDate(woPlannedStart(wo))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>

      <WorkOrderCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
