'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PlugZap,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage } from '@/lib/api';
import {
  getHrisMappings,
  getHrisRun,
  getHrisStatus,
  listHrisRuns,
  probeHris,
  queueHrisRun,
  setHrisDepartmentMap,
  setHrisPositionMap,
} from '@/lib/endpoints';
import type { HrisCodeMapping, HrisSyncRun, HrisSyncStatus } from '@/lib/types';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

/** Times are rendered in the organisation's timezone, which the status reports. */
function formatInstant(value: string | null, timezone: string): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-PH', {
    timeZone: timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

const STATUS_STYLE: Record<HrisSyncStatus, { label: string; variant: string; icon: React.ElementType }> =
  {
    QUEUED: { label: 'Queued', variant: 'secondary', icon: Clock },
    RUNNING: { label: 'Running', variant: 'secondary', icon: RefreshCw },
    SUCCEEDED: { label: 'Succeeded', variant: 'success', icon: CheckCircle2 },
    REVIEW_REQUIRED: { label: 'Needs review', variant: 'warning', icon: AlertTriangle },
    FAILED: { label: 'Failed', variant: 'destructive', icon: XCircle },
  };

function StatusBadge({ status }: { status: HrisSyncStatus }) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <Badge variant={style.variant as never}>
      <Icon aria-hidden className="size-3" /> {style.label}
    </Badge>
  );
}

function CountGrid({ run }: { run: HrisSyncRun }) {
  const entries: Array<[string, number]> = [
    ['Created', run.counts.created],
    ['Linked', run.counts.linked],
    ['Updated', run.counts.updated],
    ['Unchanged', run.counts.unchanged],
    ['Skipped', run.counts.skipped],
    ['Failed', run.counts.failed],
  ];
  return (
    <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
      {entries.map(([label, value]) => (
        <div key={label} className="rounded-md border px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** One HRIS code and the GEM-ENI row it points at. */
function MappingRow({
  mapping,
  options,
  onChange,
  saving,
}: {
  mapping: HrisCodeMapping;
  options: Array<{ id: string; code: string; name: string }>;
  onChange: (id: string, target: string | null) => void;
  saving: boolean;
}) {
  return (
    <li className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-mono text-sm font-medium">{mapping.hrisCode}</p>
        {!mapping.target ? (
          <p className="text-xs text-destructive">
            Unmapped — employees with this code are skipped until it is pointed somewhere.
          </p>
        ) : mapping.autoSuggested ? (
          <p className="text-xs text-muted-foreground">
            Matched by code automatically — confirm it to clear this note.
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {mapping.autoSuggested && mapping.target ? <Badge variant="warning">Unreviewed</Badge> : null}
        <Select
          aria-label={`GEM-ENI target for ${mapping.hrisCode}`}
          className="w-56"
          disabled={saving}
          value={mapping.target?.id ?? ''}
          onChange={(event) => onChange(mapping.id, event.target.value || null)}
        >
          <option value="">Leave unmapped</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({option.code})
            </option>
          ))}
        </Select>
      </div>
    </li>
  );
}

export function HrisIntegrationPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = can(PERMISSIONS.integration.manage);
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['hris', 'status'],
    queryFn: ({ signal }) => getHrisStatus(signal),
    enabled: canManage,
    /*
     * While a run is queued or in flight the API is the only thing that knows
     * when it finishes, so the page polls rather than leaving a stale "Running".
     */
    refetchInterval: (query) => (query.state.data?.pendingRun ? 3000 : false),
  });
  const runsQuery = useQuery({
    queryKey: ['hris', 'runs'],
    queryFn: ({ signal }) => listHrisRuns({ limit: 20 }, signal),
    enabled: canManage,
  });
  const mappingsQuery = useQuery({
    queryKey: ['hris', 'mappings'],
    queryFn: ({ signal }) => getHrisMappings(signal),
    enabled: canManage,
  });
  const runQuery = useQuery({
    queryKey: ['hris', 'run', openRunId],
    queryFn: ({ signal }) => getHrisRun(openRunId!, signal),
    enabled: !!openRunId,
  });

  const status = statusQuery.data;
  const pending = status?.pendingRun ?? null;

  // A finished run changes the counts and the issue list, so refresh both.
  const previousPending = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (previousPending.current && !pending) {
      void queryClient.invalidateQueries({ queryKey: ['hris', 'runs'] });
      void queryClient.invalidateQueries({ queryKey: ['hris', 'mappings'] });
    }
    previousPending.current = pending?.id ?? null;
  }, [pending, queryClient]);

  const probeMutation = useMutation({
    mutationFn: probeHris,
    onSuccess: (result) => {
      toast({
        title: result.ok ? 'HRIS reachable' : 'Could not reach the HRIS',
        description: result.message,
        variant: result.ok ? 'success' : 'destructive',
      });
    },
    onError: (error) => {
      toast({ title: 'Probe failed', description: getErrorMessage(error), variant: 'destructive' });
    },
  });

  const queueMutation = useMutation({
    mutationFn: (dryRun: boolean) => queueHrisRun(dryRun),
    onSuccess: async (_result, dryRun) => {
      toast({
        title: dryRun ? 'Dry run queued' : 'Sync queued',
        description: dryRun
          ? 'It rehearses every decision and writes nothing.'
          : 'The result appears here once it finishes.',
      });
      await queryClient.invalidateQueries({ queryKey: ['hris', 'status'] });
    },
    onError: (error) => {
      toast({ title: 'Could not queue', description: getErrorMessage(error), variant: 'destructive' });
    },
  });

  const departmentMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: string | null }) =>
      setHrisDepartmentMap(id, target),
    onSuccess: (data) => {
      queryClient.setQueryData(['hris', 'mappings'], data);
      void queryClient.invalidateQueries({ queryKey: ['hris', 'status'] });
      toast({ title: 'Department mapping saved', variant: 'success' });
    },
    onError: (error) => {
      toast({ title: 'Could not save', description: getErrorMessage(error), variant: 'destructive' });
    },
  });

  const positionMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: string | null }) =>
      setHrisPositionMap(id, target),
    onSuccess: (data) => {
      queryClient.setQueryData(['hris', 'mappings'], data);
      void queryClient.invalidateQueries({ queryKey: ['hris', 'status'] });
      toast({ title: 'Position mapping saved', variant: 'success' });
    },
    onError: (error) => {
      toast({ title: 'Could not save', description: getErrorMessage(error), variant: 'destructive' });
    },
  });

  if (!canManage) {
    return (
      <div className="rounded-md border border-dashed px-6 py-10 text-center">
        <p className="text-sm font-medium">Not available</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Viewing the HRIS connection needs the integration management permission.
        </p>
      </div>
    );
  }

  if (statusQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (statusQuery.isError || !status) {
    return <ErrorState error={statusQuery.error} onRetry={() => void statusQuery.refetch()} />;
  }

  const blockers: string[] = [];
  if (!status.configured) blockers.push('The connection is not configured.');
  if (status.defaultBranchProblem) blockers.push(status.defaultBranchProblem);
  if (status.unmappedCodes > 0) {
    blockers.push(`${status.unmappedCodes} HRIS code(s) are not mapped to GEM-ENI.`);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="HRIS employee feed"
        description="Employees are read from the HRIS, which is the system of record for them. GEM-ENI never writes back."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => probeMutation.mutate()}
              loading={probeMutation.isPending}
            >
              <PlugZap aria-hidden /> Test connection
            </Button>
            <Button
              variant="outline"
              disabled={!!pending || !status.configured}
              onClick={() => queueMutation.mutate(true)}
              loading={queueMutation.isPending && queueMutation.variables === true}
            >
              <Play aria-hidden /> Dry run
            </Button>
            <Button
              disabled={!!pending || !status.configured || !status.enabled}
              onClick={() => queueMutation.mutate(false)}
              loading={queueMutation.isPending && queueMutation.variables === false}
            >
              <RefreshCw aria-hidden /> Run now
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            Read-only, over the office network. The bearer token lives only in the server
            environment and is never sent to this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Scheduled sync</dt>
              <dd className="text-sm font-medium">
                {status.enabled ? (
                  <Badge variant="success">Enabled</Badge>
                ) : (
                  <Badge variant="secondary">Disabled</Badge>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Producer</dt>
              <dd className="truncate text-sm font-medium">
                {status.baseUrl ? `${status.baseUrl}${status.employeePath}` : 'Not configured'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expected company</dt>
              <dd className="text-sm font-medium font-mono">{status.expectedCompanyCode}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Nightly schedule</dt>
              <dd className="text-sm font-medium">
                <span className="font-mono">{status.cron}</span>{' '}
                <span className="text-muted-foreground">({status.timezone})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Default branch for new employees</dt>
              <dd className="text-sm font-medium">
                {status.defaultBranch
                  ? `${status.defaultBranch.name} (${status.defaultBranch.code})`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Last successful sync</dt>
              <dd className="text-sm font-medium">
                {formatInstant(status.lastSuccessfulAt, status.timezone)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Employees from the HRIS</dt>
              <dd className="text-sm font-medium tabular-nums">{status.linkedEmployees}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Not yet linked</dt>
              <dd className="text-sm font-medium tabular-nums">{status.unlinkedEmployees}</dd>
            </div>
          </dl>

          {blockers.length > 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <p className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle aria-hidden className="size-4" /> Resolve before enabling the sync
              </p>
              <ul className="mt-1 list-disc pl-6 text-sm text-muted-foreground">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
              {/* The setting is an env var and needs the exact code, so name
                  the options here rather than sending someone to the database. */}
              {status.defaultBranchProblem ? (
                <div className="mt-2 text-sm">
                  <p className="text-muted-foreground">
                    Set <code className="font-mono">GEMENI_HRIS_DEFAULT_BRANCH_CODE</code> in{' '}
                    <code className="font-mono">.env.prod</code> to one of:
                  </p>
                  {status.availableBranches.length === 0 ? (
                    <p className="mt-1 text-destructive">
                      There are no active branches yet — create one under Administration →
                      Branches first.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {status.availableBranches.map((branch) => (
                        <li key={branch.id}>
                          <code className="font-mono font-medium">{branch.code}</code>{' '}
                          <span className="text-muted-foreground">— {branch.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}

          {pending ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <RefreshCw aria-hidden className="size-4 animate-spin" />
              A {pending.dryRun ? 'dry run' : 'sync'} is {pending.status.toLowerCase()} — this page
              updates when it finishes.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Code mappings</CardTitle>
          <CardDescription>
            HRIS department and position codes, pointed at GEM-ENI records. Nothing organisational
            is created from the feed, so an unmapped code skips its employees rather than filing
            them somewhere arbitrary.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {mappingsQuery.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : mappingsQuery.isError ? (
            <ErrorState error={mappingsQuery.error} onRetry={() => void mappingsQuery.refetch()} />
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium">Departments</p>
                {mappingsQuery.data.departments.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                    None seen yet — codes appear after the first run.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {mappingsQuery.data.departments.map((mapping) => (
                      <MappingRow
                        key={mapping.id}
                        mapping={mapping}
                        options={mappingsQuery.data.availableDepartments}
                        saving={departmentMutation.isPending}
                        onChange={(id, target) => departmentMutation.mutate({ id, target })}
                      />
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Positions</p>
                {mappingsQuery.data.positions.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                    None seen yet — codes appear after the first run.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {mappingsQuery.data.positions.map((mapping) => (
                      <MappingRow
                        key={mapping.id}
                        mapping={mapping}
                        options={mappingsQuery.data.availablePositions}
                        saving={positionMutation.isPending}
                        onChange={(id, target) => positionMutation.mutate({ id, target })}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
          <CardDescription>
            Every reconciliation, with what it changed and what it could not.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {runsQuery.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : runsQuery.isError ? (
            <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} />
          ) : runsQuery.data.data.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              No runs yet. A dry run is the safe way to see what would happen.
            </p>
          ) : (
            <ul className="space-y-2">
              {runsQuery.data.data.map((run) => (
                <li key={run.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={run.status} />
                      {run.dryRun ? <Badge variant="secondary">Dry run</Badge> : null}
                      <Badge variant="outline">
                        {run.trigger === 'SCHEDULED' ? 'Scheduled' : 'Manual'}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {formatInstant(run.finishedAt ?? run.createdAt, status.timezone)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOpenRunId(openRunId === run.id ? null : run.id)}
                    >
                      {openRunId === run.id ? 'Hide details' : 'Details'}
                    </Button>
                  </div>
                  {run.error ? (
                    <p className="mt-2 text-sm text-destructive">{run.error}</p>
                  ) : (
                    <div className="mt-3">
                      <CountGrid run={run} />
                    </div>
                  )}
                  {openRunId === run.id ? (
                    <div className="mt-3 border-t pt-3">
                      {runQuery.isPending ? (
                        <Skeleton className="h-16 w-full" />
                      ) : runQuery.data?.issues?.length ? (
                        <ul className="space-y-2">
                          {runQuery.data.issues.map((issue) => (
                            <li key={issue.id} className="text-sm">
                              <span className="flex flex-wrap items-center gap-2">
                                <Badge
                                  variant={issue.severity === 'ERROR' ? 'destructive' : 'warning'}
                                >
                                  {issue.severity === 'ERROR' ? 'Not applied' : 'Review'}
                                </Badge>
                                <span className="font-mono text-xs">{issue.code}</span>
                                {issue.employeeNumber ? (
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {issue.employeeNumber}
                                  </span>
                                ) : null}
                              </span>
                              <span className="mt-0.5 block text-muted-foreground">
                                {issue.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Nothing needed attention in this run.
                        </p>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
