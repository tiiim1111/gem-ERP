'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarClock, Plus } from 'lucide-react';
import { listMaintenancePlans } from '@/lib/endpoints';
import {
  assetTag,
  formatMoney,
  itemRefLabel,
  planFrequencyLabel,
  planIsActive,
  planNextDue,
  planType,
} from '@/lib/types';
import {
  MAINTENANCE_COST_PERMISSIONS,
  MAINTENANCE_PLAN_MANAGE_PERMISSIONS,
} from '@/lib/status-maps';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { formatDate } from '@/lib/utils';
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
import { planActiveBadge } from '@/components/maintenance/badges';

export function MaintenancePlansPage() {
  const { canAny } = useSession();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState('');
  const [due, setDue] = React.useState('');

  const debouncedQ = useDebouncedValue(q);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedQ, active, due, pageSize]);

  const dueBefore = React.useMemo(() => {
    if (due === 'overdue') return new Date().toISOString();
    if (due === 'month') {
      const date = new Date();
      date.setDate(date.getDate() + 30);
      return date.toISOString();
    }
    return undefined;
  }, [due]);

  const params = {
    page,
    pageSize,
    q: debouncedQ || undefined,
    isActive: active === '' ? undefined : active === 'true',
    dueBefore,
    sort: 'name:asc',
  };

  const plansQuery = useQuery({
    queryKey: ['maintenance-plans', 'list', params],
    queryFn: ({ signal }) => listMaintenancePlans(params, signal),
    placeholderData: keepPreviousData,
  });

  const canManage = canAny(MAINTENANCE_PLAN_MANAGE_PERMISSIONS);
  const canViewCost = canAny(MAINTENANCE_COST_PERMISSIONS);
  const data = plansQuery.data;
  const hasFilters = !!(debouncedQ || active || due);

  return (
    <>
      <PageHeader
        title="Maintenance plans"
        description="Preventive templates — frequency, checklist, team/vendor, and reminders. Active plans generate due work orders."
        actions={
          canManage ? (
            <Link href="/maintenance/plans/new" className={buttonVariants({})}>
              <Plus aria-hidden /> New plan
            </Link>
          ) : undefined
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-3">
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search plans by code or name…"
            aria-label="Search plans"
          />
          <Select
            aria-label="Filter by due date"
            value={due}
            onChange={(event) => setDue(event.target.value)}
          >
            <option value="">Any due date</option>
            <option value="overdue">Overdue now</option>
            <option value="month">Due within 30 days</option>
          </Select>
          <Select
            aria-label="Filter by active state"
            value={active}
            onChange={(event) => setActive(event.target.value)}
          >
            <option value="">Active + inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </Select>
        </div>

        {plansQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : plansQuery.isError ? (
          <div className="p-4">
            <ErrorState error={plansQuery.error} onRetry={() => plansQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No maintenance plans"
            description={
              hasFilters
                ? 'Try adjusting your filters.'
                : 'Create the first preventive plan to start scheduling maintenance.'
            }
            action={
              canManage && !hasFilters ? (
                <Link href="/maintenance/plans/new" className={buttonVariants({})}>
                  <Plus aria-hidden /> New plan
                </Link>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan</TableHead>
                  <TableHead className="hidden sm:table-cell">Type</TableHead>
                  <TableHead className="hidden md:table-cell">Coverage</TableHead>
                  <TableHead>Frequency</TableHead>
                  <TableHead className="hidden lg:table-cell">Next due</TableHead>
                  {canViewCost ? (
                    <TableHead className="hidden text-right xl:table-cell">Est. cost</TableHead>
                  ) : null}
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell>
                      <Link
                        href={`/maintenance/plans/${plan.id}`}
                        className="text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {plan.name}
                      </Link>
                      {plan.code ? (
                        <p className="font-mono text-xs text-muted-foreground">{plan.code}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {planType(plan)?.name ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {plan.coveredAssetCount !== undefined
                        ? `${plan.coveredAssetCount} asset${plan.coveredAssetCount === 1 ? '' : 's'}`
                        : plan.asset
                          ? assetTag(plan.asset)
                          : plan.item
                            ? itemRefLabel(plan.item)
                            : '—'}
                    </TableCell>
                    <TableCell className="text-sm">{planFrequencyLabel(plan)}</TableCell>
                    <TableCell className="hidden text-sm tabular-nums text-muted-foreground lg:table-cell">
                      {formatDate(planNextDue(plan))}
                    </TableCell>
                    {canViewCost ? (
                      <TableCell className="hidden text-right font-mono text-xs tabular-nums xl:table-cell">
                        {formatMoney(plan.estimatedCost)}
                      </TableCell>
                    ) : null}
                    <TableCell>{planActiveBadge(planIsActive(plan))}</TableCell>
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
