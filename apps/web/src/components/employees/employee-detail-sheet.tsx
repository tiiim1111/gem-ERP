'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@gemerp/shared';
import { isApiClientError } from '@/lib/api';
import {
  getEmployee,
  listEmployeeAcknowledgments,
  listEmployeeCustody,
  unwrapList,
} from '@/lib/endpoints';
import {
  assetTag,
  conditionLabel,
  custodyExpectedReturn,
  custodyIsOverdue,
  employeeName,
  itemRefLabel,
  type CustodyAssignment,
  type Employee,
} from '@/lib/types';
import { formatDate, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { assetStatusBadge } from '@/components/inventory/badges';
import { Badge } from '@/components/ui/badge';
import { ErrorState } from '@/components/ui/error-state';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';

export function employeeStatusBadge(status: Employee['status']) {
  const variant =
    status === 'ACTIVE'
      ? ('success' as const)
      : status === 'SUSPENDED'
        ? ('warning' as const)
        : status === 'SEPARATED'
          ? ('destructive' as const)
          : ('muted' as const);
  return <Badge variant={variant}>{humanize(status)}</Badge>;
}

function ProfileRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="col-span-2 text-sm">{value ?? '—'}</dd>
    </div>
  );
}

function CustodyAssignmentRow({ row }: { row: CustodyAssignment }) {
  const asset = row.asset;
  return (
    <li className="flex items-center justify-between gap-2 px-3 py-2">
      <span className="min-w-0">
        {asset ? (
          <Link
            href={`/assets/${asset.id}`}
            className="block truncate font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {assetTag(asset)}
          </Link>
        ) : (
          <span className="block truncate text-sm font-medium">Asset</span>
        )}
        <span className="block truncate text-xs text-muted-foreground">
          {asset ? itemRefLabel(asset.item ?? null) : ''}
          {row.assignedAt ? ` · since ${formatDate(row.assignedAt)}` : ''}
          {conditionLabel(row.conditionAtIssue) ? ` · ${conditionLabel(row.conditionAtIssue)}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {asset?.status ? assetStatusBadge(asset.status) : null}
      </span>
    </li>
  );
}

/**
 * Custody section backed by the live Phase 3 endpoints: currently-assigned
 * assets plus outstanding/overdue acknowledgments (overdue highlighted).
 * Degrades gracefully — a 404 (endpoint unavailable) hides the section
 * rather than erroring.
 */
function CustodySection({ employeeId }: { employeeId: string }) {
  const assetsQuery = useQuery({
    queryKey: ['employees', 'custody', employeeId],
    queryFn: ({ signal }) => listEmployeeCustody(employeeId, signal),
    retry: false,
  });
  const acknowledgmentsQuery = useQuery({
    queryKey: ['employees', 'acknowledgments', employeeId],
    queryFn: ({ signal }) => listEmployeeAcknowledgments(employeeId, signal),
    retry: false,
  });

  const notFound = (error: unknown) => isApiClientError(error) && error.status === 404;
  if (assetsQuery.isError && notFound(assetsQuery.error) && acknowledgmentsQuery.isError) {
    return null; // endpoints unavailable — degrade silently
  }

  const assignments: CustodyAssignment[] = assetsQuery.data ? unwrapList(assetsQuery.data) : [];
  const outstanding = acknowledgmentsQuery.data?.outstanding ?? [];
  const overdueReturns = acknowledgmentsQuery.data?.overdueReturns ?? [];

  return (
    <div className="space-y-5">
      <section aria-label="Assigned assets" className="space-y-2">
        <h3 className="text-sm font-semibold">Assigned assets</h3>
        {assetsQuery.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : assetsQuery.isError ? (
          notFound(assetsQuery.error) ? (
            <p className="text-sm text-muted-foreground">Custody data is not available.</p>
          ) : (
            <ErrorState error={assetsQuery.error} onRetry={() => assetsQuery.refetch()} />
          )
        ) : assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assets currently assigned.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {assignments.map((row) => (
              <CustodyAssignmentRow key={row.id} row={row} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Acknowledgments" className="space-y-2">
        <h3 className="text-sm font-semibold">Acknowledgments &amp; returns</h3>
        {acknowledgmentsQuery.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : acknowledgmentsQuery.isError ? (
          notFound(acknowledgmentsQuery.error) ? (
            <p className="text-sm text-muted-foreground">Acknowledgment data is not available.</p>
          ) : (
            <ErrorState
              error={acknowledgmentsQuery.error}
              onRetry={() => acknowledgmentsQuery.refetch()}
            />
          )
        ) : outstanding.length === 0 && overdueReturns.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No outstanding acknowledgments or overdue returns.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {outstanding.map((row) => (
              <li
                key={`ack-${row.id}`}
                className="flex items-center justify-between gap-2 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {row.asset ? assetTag(row.asset) : 'Asset'}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Issued {formatDate(row.assignedAt)} — awaiting employee acknowledgment
                  </span>
                </span>
                <Badge variant="warning">Unacknowledged</Badge>
              </li>
            ))}
            {overdueReturns.map((row) => (
              <li
                key={`overdue-${row.id}`}
                className="flex items-center justify-between gap-2 bg-destructive/5 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {row.asset ? assetTag(row.asset) : 'Asset'}
                  </span>
                  <span className="block truncate text-xs text-destructive">
                    Expected back {formatDate(custodyExpectedReturn(row))}
                    {custodyIsOverdue(row) ? ' — overdue' : ''}
                  </span>
                </span>
                <Badge variant="destructive">Overdue</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function EmployeeDetailSheet({
  open,
  onOpenChange,
  employeeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string | null;
}) {
  const { can } = useSession();
  const canViewNotes = can(PERMISSIONS.employee.viewNotes);

  const employeeQuery = useQuery({
    queryKey: ['employees', 'detail', employeeId],
    queryFn: ({ signal }) => getEmployee(employeeId!, signal),
    enabled: open && !!employeeId,
  });

  const employee = employeeQuery.data;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={employee ? employeeName(employee) : 'Employee'}
      description={employee?.employeeNumber}
    >
      {employeeQuery.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : employeeQuery.isError ? (
        <ErrorState error={employeeQuery.error} onRetry={() => employeeQuery.refetch()} />
      ) : employee ? (
        <div className="space-y-6">
          <section aria-label="Profile">
            <div className="mb-2 flex items-center gap-2">
              {employeeStatusBadge(employee.status)}
              {employee.archivedAt ? <Badge variant="muted">Archived</Badge> : null}
            </div>
            <dl className="divide-y">
              <ProfileRow
                label="Full name"
                value={[employee.firstName, employee.middleName, employee.lastName]
                  .filter(Boolean)
                  .join(' ')}
              />
              <ProfileRow label="Employee #" value={<span className="font-mono text-xs">{employee.employeeNumber}</span>} />
              <ProfileRow label="Work email" value={employee.workEmail || '—'} />
              <ProfileRow label="Work phone" value={employee.workPhone || '—'} />
              <ProfileRow
                label="Branch"
                value={employee.branch ? `${employee.branch.name} (${employee.branch.code})` : '—'}
              />
              <ProfileRow label="Department" value={employee.department?.name ?? '—'} />
              <ProfileRow label="Position" value={employee.position?.name ?? '—'} />
              <ProfileRow
                label="Supervisor"
                value={employee.supervisor ? employeeName(employee.supervisor) : '—'}
              />
              <ProfileRow label="Start date" value={formatDate(employee.startDate)} />
              {employee.separationDate ? (
                <ProfileRow label="Separated" value={formatDate(employee.separationDate)} />
              ) : null}
              <ProfileRow
                label="Login account"
                value={
                  employee.user
                    ? (employee.user.displayName ?? employee.user.email ?? 'Linked')
                    : employee.userId
                      ? 'Linked'
                      : 'None'
                }
              />
            </dl>
          </section>

          {canViewNotes && employee.notes ? (
            <section aria-label="Notes" className="space-y-1.5">
              <h3 className="text-sm font-semibold">Notes (restricted)</h3>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {employee.notes}
              </p>
            </section>
          ) : null}

          <CustodySection employeeId={employee.id} />
        </div>
      ) : null}
    </Sheet>
  );
}
