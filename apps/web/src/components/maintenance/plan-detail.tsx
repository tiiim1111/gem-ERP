'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, MonitorSmartphone, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage } from '@/lib/api';
import {
  activateMaintenancePlan,
  deactivateMaintenancePlan,
  getMaintenancePlan,
  listWorkOrders,
  setMaintenancePlanAssets,
} from '@/lib/endpoints';
import {
  assetTag,
  formatMoney,
  itemRefLabel,
  planCoveredAssets,
  planFrequencyLabel,
  planIsActive,
  planNextDue,
  planTaskIsRequired,
  planTasks,
  planType,
  refLabel,
  supplierRefLabel,
  workOrderNumber,
  type Asset,
} from '@/lib/types';
import {
  MAINTENANCE_COST_PERMISSIONS,
  MAINTENANCE_PLAN_MANAGE_PERMISSIONS,
} from '@/lib/status-maps';
import { formatDate } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { AssetPicker } from '@/components/inventory/pickers';
import { planActiveBadge, woStatusBadge } from '@/components/maintenance/badges';

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right">{value ?? '—'}</dd>
    </div>
  );
}

/** Covered-asset set editor — PUT :id/assets replaces the whole set. */
function CoveredAssetsCard({
  planId,
  assets,
  canManage,
}: {
  planId: string;
  assets: Asset[];
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<Asset[]>(assets);
  const [pickerValue, setPickerValue] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Re-sync local state whenever the server set changes.
  React.useEffect(() => {
    setDraft(assets);
  }, [assets]);

  const dirty =
    draft.length !== assets.length || draft.some((asset) => !assets.some((a) => a.id === asset.id));

  const saveMutation = useMutation({
    mutationFn: () =>
      setMaintenancePlanAssets(
        planId,
        draft.map((asset) => asset.id),
      ),
    onSuccess: () => {
      toast({ title: 'Covered assets updated', variant: 'success' });
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Covered assets</CardTitle>
        <CardDescription>
          Serialized assets this plan schedules maintenance for. Saving replaces the whole set.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormError message={error} />
        {canManage ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <AssetPicker
                id="plan-add-asset"
                value={pickerValue}
                onSelect={(asset) => {
                  setPickerValue(null);
                  if (asset && !draft.some((entry) => entry.id === asset.id)) {
                    setDraft((current) => [...current, asset]);
                  }
                }}
                placeholder="Add an asset to this plan…"
              />
            </div>
            <Button
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              disabled={!dirty}
            >
              <Plus aria-hidden /> Save asset set
            </Button>
          </div>
        ) : null}
        {draft.length === 0 ? (
          <EmptyState
            icon={MonitorSmartphone}
            title="No covered assets"
            description="This plan does not cover specific assets yet."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead className="hidden sm:table-cell">Item</TableHead>
                <TableHead className="hidden md:table-cell">Branch</TableHead>
                {canManage ? <TableHead className="w-24 text-right">Actions</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {draft.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell>
                    <Link
                      href={`/assets/${asset.id}`}
                      className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {assetTag(asset)}
                    </Link>
                  </TableCell>
                  <TableCell className="hidden max-w-[16rem] truncate text-sm text-muted-foreground sm:table-cell">
                    {itemRefLabel(asset.item ?? null)}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {asset.branch ? refLabel(asset.branch) : '—'}
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() =>
                          setDraft((current) => current.filter((entry) => entry.id !== asset.id))
                        }
                      >
                        <Trash2 aria-hidden /> Remove
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {dirty ? (
          <p className="text-xs text-warning">Unsaved changes — click “Save asset set” to apply.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Recent work orders generated from this plan. The list endpoint has no
 * plan filter, so the most recent page is filtered client-side by plan id.
 */
function PlanWorkOrdersCard({ planId }: { planId: string }) {
  const wosQuery = useQuery({
    queryKey: ['maintenance-work-orders', 'by-plan', planId],
    queryFn: ({ signal }) =>
      listWorkOrders({ page: 1, pageSize: 100, sort: 'createdAt:desc' }, signal),
    select: (payload) => ({
      ...payload,
      data: payload.data.filter((wo) => (wo.planId ?? wo.plan?.id) === planId),
    }),
  });

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>Recent work orders</CardTitle>
        <CardDescription>Latest work orders generated from this plan.</CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {wosQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : wosQuery.isError ? (
          <div className="p-4">
            <ErrorState error={wosQuery.error} onRetry={() => wosQuery.refetch()} />
          </div>
        ) : wosQuery.data.data.length === 0 ? (
          <EmptyState title="No work orders yet" description="This plan has not generated any work orders." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Asset</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wosQuery.data.data.map((wo) => (
                <TableRow key={wo.id}>
                  <TableCell>
                    <Link
                      href={`/maintenance/work-orders/${wo.id}`}
                      className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {workOrderNumber(wo)}
                    </Link>
                  </TableCell>
                  <TableCell>{woStatusBadge(wo.status)}</TableCell>
                  <TableCell className="hidden font-mono text-xs sm:table-cell">
                    {wo.asset ? assetTag(wo.asset) : '—'}
                  </TableCell>
                  <TableCell className="hidden text-sm tabular-nums text-muted-foreground md:table-cell">
                    {formatDate(wo.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function MaintenancePlanDetail({ planId }: { planId: string }) {
  const queryClient = useQueryClient();
  const { can, canAny } = useSession();
  const { toast } = useToast();
  const [actionError, setActionError] = React.useState<string | null>(null);

  const planQuery = useQuery({
    queryKey: ['maintenance-plans', 'detail', planId],
    queryFn: ({ signal }) => getMaintenancePlan(planId, signal),
  });
  const plan = planQuery.data;

  const toggleMutation = useMutation({
    mutationFn: (next: boolean) =>
      next ? activateMaintenancePlan(planId) : deactivateMaintenancePlan(planId),
    onSuccess: (_result, next) => {
      setActionError(null);
      toast({ title: next ? 'Plan activated' : 'Plan deactivated', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
    },
    onError: (error) => setActionError(getErrorMessage(error)),
  });

  if (planQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (planQuery.isError || !plan) {
    return <ErrorState error={planQuery.error} onRetry={() => planQuery.refetch()} />;
  }

  const canManage = canAny(MAINTENANCE_PLAN_MANAGE_PERMISSIONS);
  const canViewCost = canAny(MAINTENANCE_COST_PERMISSIONS);
  const canViewWos = can(PERMISSIONS.maintenanceWorkOrder.view);
  const active = planIsActive(plan);
  const tasks = planTasks(plan);

  return (
    <>
      <PageHeader
        title={plan.name}
        description={`Maintenance plan${plan.code ? ` · ${plan.code}` : ''}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/maintenance/plans" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All plans
            </Link>
            {canManage ? (
              <>
                <Link
                  href={`/maintenance/plans/${plan.id}/edit`}
                  className={buttonVariants({ variant: 'outline' })}
                >
                  <Pencil aria-hidden /> Edit
                </Link>
                {active ? (
                  <Button
                    variant="outline"
                    onClick={() => toggleMutation.mutate(false)}
                    loading={toggleMutation.isPending}
                  >
                    <Square aria-hidden /> Deactivate
                  </Button>
                ) : (
                  <Button onClick={() => toggleMutation.mutate(true)} loading={toggleMutation.isPending}>
                    <Play aria-hidden /> Activate
                  </Button>
                )}
              </>
            ) : null}
          </div>
        }
      />

      {actionError ? <FormError message={actionError} className="mb-4" /> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Details</CardTitle>
            {planActiveBadge(active)}
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <InfoRow label="Type" value={planType(plan)?.name ?? '—'} />
              <InfoRow label="Frequency" value={planFrequencyLabel(plan)} />
              <InfoRow label="Next due" value={formatDate(planNextDue(plan))} />
              <InfoRow
                label="Reminder lead time"
                value={
                  plan.reminderLeadDays !== null && plan.reminderLeadDays !== undefined
                    ? `${plan.reminderLeadDays} day${plan.reminderLeadDays === 1 ? '' : 's'} before due`
                    : '—'
                }
              />
              <InfoRow
                label="Covers"
                value={
                  plan.asset ? (
                    <Link href={`/assets/${plan.asset.id}`} className="text-primary hover:underline">
                      {assetTag(plan.asset)}
                    </Link>
                  ) : plan.item ? (
                    plan.item.id ? (
                      <Link href={`/items/${plan.item.id}`} className="text-primary hover:underline">
                        {itemRefLabel(plan.item)} (all maintainable assets)
                      </Link>
                    ) : (
                      itemRefLabel(plan.item)
                    )
                  ) : (
                    'Selected assets (below)'
                  )
                }
              />
              <InfoRow label="Internal team" value={plan.assignedTeam ?? '—'} />
              <InfoRow
                label="External vendor"
                value={
                  plan.vendor ? (
                    <Link href={`/suppliers/${plan.vendor.id}`} className="text-primary hover:underline">
                      {supplierRefLabel(plan.vendor)}
                    </Link>
                  ) : (
                    '—'
                  )
                }
              />
              <InfoRow
                label="Estimated duration"
                value={
                  plan.estimatedDurationHours !== null && plan.estimatedDurationHours !== undefined
                    ? `${plan.estimatedDurationHours} h`
                    : '—'
                }
              />
              {canViewCost && plan.estimatedCost !== undefined && plan.estimatedCost !== null ? (
                <InfoRow label="Estimated cost" value={formatMoney(plan.estimatedCost)} />
              ) : null}
              {plan.description ? <InfoRow label="Description" value={plan.description} /> : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
            <CardDescription>Copied onto each generated work order.</CardDescription>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No checklist tasks.</p>
            ) : (
              <ol className="space-y-2">
                {tasks.map((task, index) => (
                  <li key={task.id ?? index} className="flex items-start gap-2 text-sm">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {task.sequence ?? index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="font-medium">{task.name}</span>
                      {planTaskIsRequired(task) ? (
                        <Badge variant="outline" className="ml-1.5 align-middle">
                          Required
                        </Badge>
                      ) : null}
                      {task.description ? (
                        <span className="block text-xs text-muted-foreground">{task.description}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {!plan.asset && !plan.item ? (
        <CoveredAssetsCard planId={plan.id} assets={planCoveredAssets(plan)} canManage={canManage} />
      ) : null}

      {canViewWos ? <PlanWorkOrdersCard planId={plan.id} /> : null}

      {active ? null : (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          Inactive plans keep their history but stop generating due work orders.
        </p>
      )}
    </>
  );
}
