'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FilterX, ScrollText } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { listAuditLogs, listBranches } from '@/lib/endpoints';
import {
  auditCorrelationId,
  auditIp,
  auditTimestamp,
  type AuditLogEntry,
} from '@/lib/types';
import { formatDateTime, humanize } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Sheet } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ValueDiff } from './value-diff';

function actionBadgeVariant(action: string): 'success' | 'destructive' | 'warning' | 'secondary' {
  const lower = action.toLowerCase();
  if (/(create|activate|login|approve|post)/.test(lower)) return 'success';
  if (/(delete|deactivate|revoke|reject|fail|lock)/.test(lower)) return 'destructive';
  if (/(update|change|reset|replace)/.test(lower)) return 'warning';
  return 'secondary';
}

/** Convert a datetime-local input value to an ISO-8601 UTC string. */
function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-all">{value ?? '—'}</dd>
    </div>
  );
}

export function AuditPage() {
  const { can } = useSession();
  const canFilterBranch = can(PERMISSIONS.branch.view);

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [actorInput, setActorInput] = React.useState('');
  const [actionInput, setActionInput] = React.useState('');
  const [resourceInput, setResourceInput] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [fromInput, setFromInput] = React.useState('');
  const [toInput, setToInput] = React.useState('');
  const [selected, setSelected] = React.useState<AuditLogEntry | null>(null);

  const actor = useDebouncedValue(actorInput);
  const action = useDebouncedValue(actionInput);
  const resourceType = useDebouncedValue(resourceInput);

  React.useEffect(() => {
    setPage(1);
  }, [actor, action, resourceType, branchId, fromInput, toInput, pageSize]);

  const params = {
    page,
    pageSize,
    actor: actor || undefined,
    action: action || undefined,
    resourceType: resourceType || undefined,
    branchId: branchId || undefined,
    from: toIso(fromInput),
    to: toIso(toInput),
  };

  const auditQuery = useQuery({
    queryKey: ['audit-logs', 'list', params],
    queryFn: ({ signal }) => listAuditLogs(params, signal),
    placeholderData: keepPreviousData,
  });

  const branchesQuery = useQuery({
    queryKey: ['branches', 'options'],
    queryFn: ({ signal }) => listBranches({ page: 1, pageSize: 100 }, signal),
    enabled: canFilterBranch,
  });

  const hasFilters =
    !!actorInput || !!actionInput || !!resourceInput || !!branchId || !!fromInput || !!toInput;

  const clearFilters = () => {
    setActorInput('');
    setActionInput('');
    setResourceInput('');
    setBranchId('');
    setFromInput('');
    setToInput('');
  };

  const data = auditQuery.data;
  const branchNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branchesQuery.data?.data ?? []) {
      map.set(branch.id, `${branch.code} — ${branch.name}`);
    }
    return map;
  }, [branchesQuery.data]);

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Append-only trail of security and data events across your branches."
      />

      <Card>
        {/* Filters */}
        <div className="grid grid-cols-1 gap-3 border-b p-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="audit-actor" className="text-xs text-muted-foreground">
              Actor
            </Label>
            <Input
              id="audit-actor"
              placeholder="Email or user…"
              value={actorInput}
              onChange={(event) => setActorInput(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-action" className="text-xs text-muted-foreground">
              Action
            </Label>
            <Input
              id="audit-action"
              placeholder="e.g. user.updated"
              value={actionInput}
              onChange={(event) => setActionInput(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-resource" className="text-xs text-muted-foreground">
              Resource type
            </Label>
            <Input
              id="audit-resource"
              placeholder="e.g. user, branch"
              value={resourceInput}
              onChange={(event) => setResourceInput(event.target.value)}
            />
          </div>
          {canFilterBranch ? (
            <div className="space-y-1">
              <Label htmlFor="audit-branch" className="text-xs text-muted-foreground">
                Branch
              </Label>
              <Select
                id="audit-branch"
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
              >
                <option value="">All branches</option>
                {(branchesQuery.data?.data ?? []).map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.code} — {branch.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="audit-from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="audit-from"
              type="datetime-local"
              value={fromInput}
              onChange={(event) => setFromInput(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="audit-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="audit-to"
              type="datetime-local"
              value={toInput}
              onChange={(event) => setToInput(event.target.value)}
            />
          </div>
          {hasFilters ? (
            <div className="flex items-end sm:col-span-2 lg:col-span-6">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <FilterX aria-hidden /> Clear filters
              </Button>
            </div>
          ) : null}
        </div>

        {auditQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : auditQuery.isError ? (
          <div className="p-4">
            <ErrorState error={auditQuery.error} onRetry={() => auditQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit events found"
            description={hasFilters ? 'Try widening your filters.' : 'Events will appear here as they happen.'}
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="hidden md:table-cell">Resource</TableHead>
                  <TableHead className="hidden lg:table-cell">Branch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((entry) => (
                  <TableRow
                    key={entry.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    onClick={() => setSelected(entry)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelected(entry);
                      }
                    }}
                    aria-label={`View details of ${entry.action}`}
                  >
                    <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                      {formatDateTime(auditTimestamp(entry))}
                    </TableCell>
                    <TableCell className="max-w-[12rem] truncate text-sm">
                      {entry.actorDisplayName ?? (entry.actorUserId ? entry.actorUserId.slice(0, 8) : 'System')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionBadgeVariant(entry.action)} className="font-mono text-[11px]">
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-[16rem] md:table-cell">
                      {entry.resourceType ? (
                        <span className="text-sm">
                          {humanize(entry.resourceType)}
                          {entry.resourceId ? (
                            <span className="ml-1 font-mono text-xs text-muted-foreground">
                              {entry.resourceId.length > 12
                                ? `${entry.resourceId.slice(0, 8)}…`
                                : entry.resourceId}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {entry.branchId ? (branchNameById.get(entry.branchId) ?? entry.branchId.slice(0, 8)) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>

      {/* Details drawer */}
      <Sheet
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title="Audit event"
        description={selected ? formatDateTime(auditTimestamp(selected)) : undefined}
      >
        {selected ? (
          <div className="space-y-5">
            <dl className="divide-y rounded-md border px-3 py-1">
              <DetailRow
                label="Action"
                value={
                  <Badge variant={actionBadgeVariant(selected.action)} className="font-mono text-[11px]">
                    {selected.action}
                  </Badge>
                }
              />
              <DetailRow
                label="Actor"
                value={selected.actorDisplayName ?? selected.actorUserId ?? 'System'}
              />
              <DetailRow
                label="Resource"
                value={
                  selected.resourceType
                    ? `${humanize(selected.resourceType)}${selected.resourceId ? ` (${selected.resourceId})` : ''}`
                    : null
                }
              />
              <DetailRow
                label="Branch"
                value={
                  selected.branchId
                    ? (branchNameById.get(selected.branchId) ?? selected.branchId)
                    : null
                }
              />
              <DetailRow label="IP address" value={auditIp(selected)} />
              <DetailRow
                label="User agent"
                value={
                  selected.userAgent ? <span className="text-xs">{selected.userAgent}</span> : null
                }
              />
              <DetailRow
                label="Correlation ID"
                value={
                  auditCorrelationId(selected) ? (
                    <span className="font-mono text-xs">{auditCorrelationId(selected)}</span>
                  ) : null
                }
              />
              {selected.reason ? <DetailRow label="Reason" value={selected.reason} /> : null}
            </dl>

            <div>
              <h3 className="mb-2 text-sm font-semibold">Changes</h3>
              <ValueDiff oldValues={selected.oldValues} newValues={selected.newValues} />
            </div>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
