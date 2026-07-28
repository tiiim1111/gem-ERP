'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { PERMISSIONS } from '@gemerp/shared';
import { isApiClientError } from '@/lib/api';
import { getEmployee, listEmployeeAssets, unwrapList } from '@/lib/endpoints';
import {
  employeeName,
  outstandingAssetLabel,
  type Employee,
  type OutstandingAsset,
} from '@/lib/types';
import { formatDate, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
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

/**
 * Custody section backed by the Phase 3 GET /employees/:id/assets endpoint.
 * Until that phase ships the API answers 404 — in that case the section is
 * hidden entirely (no fake data, no error noise).
 */
function CustodySection({ employeeId }: { employeeId: string }) {
  const assetsQuery = useQuery({
    queryKey: ['employees', 'assets', employeeId],
    queryFn: ({ signal }) => listEmployeeAssets(employeeId, signal),
    retry: false,
  });

  if (assetsQuery.isError && isApiClientError(assetsQuery.error) && assetsQuery.error.status === 404) {
    return null; // Phase 3 endpoint not available yet.
  }

  return (
    <section aria-label="Assigned assets" className="space-y-2">
      <h3 className="text-sm font-semibold">Assigned assets</h3>
      {assetsQuery.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : assetsQuery.isError ? (
        <ErrorState error={assetsQuery.error} onRetry={() => assetsQuery.refetch()} />
      ) : (
        (() => {
          const assets: OutstandingAsset[] = unwrapList(assetsQuery.data);
          if (assets.length === 0) {
            return <p className="text-sm text-muted-foreground">No assets currently assigned.</p>;
          }
          return (
            <ul className="divide-y rounded-md border">
              {assets.map((asset) => (
                <li key={asset.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {outstandingAssetLabel(asset)}
                    </span>
                    {asset.item?.name && asset.item.name !== outstandingAssetLabel(asset) ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {asset.item.name}
                      </span>
                    ) : null}
                  </span>
                  {asset.status ? <Badge variant="outline">{humanize(asset.status)}</Badge> : null}
                </li>
              ))}
            </ul>
          );
        })()
      )}
    </section>
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
