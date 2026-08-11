'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  CalendarClock,
  ClipboardList,
  Inbox,
  Layers,
  MonitorSmartphone,
  Package,
  PackageCheck,
  ScrollText,
  ShieldAlert,
  ShoppingCart,
  TriangleAlert,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { isApiClientError } from '@/lib/api';
import {
  getDashboardSummary,
  listApprovalRequests,
  listAuditLogs,
  listEmployeeAcknowledgments,
  listMySessions,
  revokeMySession,
} from '@/lib/endpoints';
import { REPORTS_VIEW_PERMISSIONS, stockTransactionTypeLabel } from '@/lib/status-maps';
import {
  assetTag,
  auditTimestamp,
  custodyExpectedReturn,
  custodyIsOverdue,
  formatMoney,
  itemRefLabel,
  meEmployeeId,
  stockTransactionNumber,
  summaryCount,
  summaryMoney,
  summaryRecentTransactions,
  summaryStatusCounts,
  type DashboardSummary,
  type SessionInfo,
} from '@/lib/types';
import { formatDate, formatDateTime, formatRelativeTime, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { stockTransactionStatusBadge } from '@/components/inventory/badges';

/* ------------------------------- Stat tiles -------------------------------- */

function StatCard({
  title,
  icon: Icon,
  value,
  loading,
  error,
  href,
}: {
  title: string;
  icon: LucideIcon;
  value: number | undefined;
  loading: boolean;
  error: unknown;
  href?: string;
}) {
  const body = (
    <Card className={href ? 'transition-colors hover:border-primary/40' : undefined}>
      <CardContent className="flex items-center gap-4 p-4 sm:p-5">
        <div className="rounded-md bg-primary/10 p-2.5">
          <Icon className="h-5 w-5 text-primary" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-14" />
          ) : error ? (
            <p className="text-sm text-destructive">Unavailable</p>
          ) : (
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * One /dashboard/summary KPI tile. Absent metrics render nothing (per-widget
 * absence is graceful — the server only serializes blocks the caller may see).
 * `alarmWhenPositive` tints the tile once the count is above zero.
 */
function SummaryTile({
  title,
  icon: Icon,
  value,
  loading,
  href,
  alarmWhenPositive,
}: {
  title: string;
  icon: LucideIcon;
  value: number | null;
  loading: boolean;
  href?: string;
  alarmWhenPositive?: boolean;
}) {
  if (!loading && value === null) return null;
  const alarming = !!alarmWhenPositive && (value ?? 0) > 0;

  const body = (
    <Card
      className={
        alarming
          ? 'border-warning/50 bg-warning/5 transition-colors hover:border-warning'
          : href
            ? 'transition-colors hover:border-primary/40'
            : undefined
      }
    >
      <CardContent className="flex items-center gap-4 p-4 sm:p-5">
        <div className={alarming ? 'rounded-md bg-warning/15 p-2.5' : 'rounded-md bg-primary/10 p-2.5'}>
          <Icon className={alarming ? 'h-5 w-5 text-warning' : 'h-5 w-5 text-primary'} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-14" />
          ) : (
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Peso value widget — rendered only when the API included the figure. */
function ValueTile({
  title,
  icon: Icon,
  value,
  loading,
}: {
  title: string;
  icon: LucideIcon;
  value: string | number | null;
  loading: boolean;
}) {
  if (!loading && value === null) return null;
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4 sm:p-5">
        <div className="rounded-md bg-success/10 p-2.5">
          <Icon className="h-5 w-5 text-success" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{title}</p>
          {loading ? (
            <Skeleton className="mt-1 h-7 w-24" />
          ) : (
            <p className="truncate text-2xl font-semibold tabular-nums">{formatMoney(value)}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------- Assets by status card --------------------------- */

/** Status → bar fill (status palette; labels below carry identity). */
const ASSET_STATUS_BAR_CLASS: Record<string, string> = {
  AVAILABLE: 'bg-success',
  ASSIGNED: 'bg-primary',
  RESERVED: 'bg-primary/60',
  IN_TRANSFER: 'bg-primary/40',
  UNDER_MAINTENANCE: 'bg-warning',
  UNDER_INSPECTION: 'bg-warning/60',
  DAMAGED: 'bg-destructive',
  LOST: 'bg-destructive/60',
};

/**
 * Assets by status with a simple CSS distribution bar (no chart libs). Every
 * segment is identified by the labeled counts underneath — never color alone.
 */
function AssetStatusSummaryCard({
  summary,
  loading,
}: {
  summary: DashboardSummary | undefined;
  loading: boolean;
}) {
  const rows = summaryStatusCounts(summary, 'assets.byStatus', 'assetsByStatus', 'assets.statusCounts');
  if (!loading && rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const shown = [...rows].sort((a, b) => b.count - a.count).slice(0, 6);

  return (
    <Link
      href="/assets"
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:col-span-2"
    >
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-primary/10 p-2">
                <MonitorSmartphone className="h-4 w-4 text-primary" aria-hidden />
              </div>
              <p className="text-sm text-muted-foreground">Assets by status</p>
            </div>
            {loading ? (
              <Skeleton className="h-6 w-12" />
            ) : (
              <p className="text-lg font-semibold tabular-nums">{total}</p>
            )}
          </div>
          {loading ? (
            <Skeleton className="h-2 w-full" />
          ) : (
            <div
              className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
              role="img"
              aria-label={rows.map((row) => `${humanize(row.status)}: ${row.count}`).join(', ')}
            >
              {rows
                .filter((row) => row.count > 0)
                .map((row) => (
                  <div
                    key={row.status}
                    className={`${ASSET_STATUS_BAR_CLASS[row.status] ?? 'bg-muted-foreground/30'} rounded-full`}
                    style={{ width: `${total > 0 ? (row.count / total) * 100 : 0}%` }}
                  />
                ))}
            </div>
          )}
          <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-1.5 sm:grid-cols-6">
            {(loading ? [] : shown).map((row) => (
              <div key={row.status} className="min-w-0">
                <p className="flex items-center gap-1.5 text-lg font-semibold tabular-nums">
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-full ${ASSET_STATUS_BAR_CLASS[row.status] ?? 'bg-muted-foreground/30'}`}
                  />
                  {row.count}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{humanize(row.status)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/* ------------------------ Recent transactions card ------------------------- */

function RecentTransactionsCard({
  summary,
  loading,
}: {
  summary: DashboardSummary | undefined;
  loading: boolean;
}) {
  const transactions = summaryRecentTransactions(summary);
  if (!loading && transactions.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Recent transactions</CardTitle>
          <CardDescription>Latest stock documents across your branches.</CardDescription>
        </div>
        <Link href="/inventory/transactions" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          View all
        </Link>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : (
          <ul className="divide-y">
            {transactions.slice(0, 8).map((txn) => (
              <li key={txn.id}>
                <Link
                  href={`/inventory/transactions/${txn.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs font-medium">
                      {stockTransactionNumber(txn)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {txn.type ? stockTransactionTypeLabel(txn.type) : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {txn.status ? stockTransactionStatusBadge(txn.status) : null}
                    <time
                      className="text-xs tabular-nums text-muted-foreground"
                      title={formatDateTime(txn.postedAt ?? txn.createdAt)}
                    >
                      {formatRelativeTime(txn.postedAt ?? txn.createdAt)}
                    </time>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------- Phase 7 summary section ------------------------- */

/**
 * All KPI tiles from the single GET /dashboard/summary call (contract §8) —
 * replacing the per-module count queries the dashboard ran through Phase 6.
 * Each tile hides when its block is absent from the payload; a 403/404 hides
 * the whole section (no reports.view, or the API not deployed yet).
 */
function SummarySection() {
  const summaryQuery = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: ({ signal }) => getDashboardSummary(signal),
    retry: false,
  });

  if (
    summaryQuery.isError &&
    isApiClientError(summaryQuery.error) &&
    (summaryQuery.error.status === 403 || summaryQuery.error.status === 404)
  ) {
    return null;
  }
  if (summaryQuery.isError) {
    return (
      <div className="mb-4">
        <ErrorState error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} />
      </div>
    );
  }

  const summary = summaryQuery.data;
  const loading = summaryQuery.isPending;
  const count = (...paths: string[]) => summaryCount(summary, ...paths);

  // Canonical paths mirror the API's DashboardSummaryView (apps/api
  // reports/dashboard.service.ts); one flat alias each tolerates drift.
  const inventoryValue = summaryMoney(summary, 'inventory.inventoryValue', 'inventoryValue');
  const acquisitionValue = summaryMoney(summary, 'assets.acquisitionValue', 'acquisitionValue');
  const expiryWindow = count('expirations.windowDays');

  return (
    <>
      {/* Value widgets — the API includes these only for cost-permitted users. */}
      {loading || inventoryValue !== null || acquisitionValue !== null ? (
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ValueTile title="Inventory value" icon={Wallet} value={inventoryValue} loading={loading} />
          <ValueTile
            title="Asset acquisition value"
            icon={Banknote}
            value={acquisitionValue}
            loading={loading}
          />
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <AssetStatusSummaryCard summary={summary} loading={loading} />
        <SummaryTile
          title="Assigned assets"
          icon={BadgeCheck}
          value={count('assets.assigned', 'assignedAssets')}
          loading={loading}
          href="/assets"
        />
        <SummaryTile
          title="Available assets"
          icon={PackageCheck}
          value={count('assets.available', 'availableAssets')}
          loading={loading}
          href="/assets"
        />
        <SummaryTile
          title="Items (SKUs)"
          icon={Package}
          value={count('inventory.skuCount', 'skuCount')}
          loading={loading}
          href="/items"
        />
        <SummaryTile
          title="Low-stock items"
          icon={TriangleAlert}
          value={count('inventory.lowStockCount', 'lowStockCount')}
          loading={loading}
          href="/inventory/low-stock"
          alarmWhenPositive
        />
        <SummaryTile
          title="Out of stock"
          icon={ShieldAlert}
          value={count('inventory.outOfStockCount', 'outOfStockCount')}
          loading={loading}
          href="/inventory/low-stock"
          alarmWhenPositive
        />
        <SummaryTile
          title="Transfers pending approval"
          icon={ArrowLeftRight}
          value={count('transfers.pendingApproval', 'pendingTransfers')}
          loading={loading}
          href="/inventory/transfers"
        />
        <SummaryTile
          title="Transfers in transit"
          icon={ArrowLeftRight}
          value={count('transfers.inTransit', 'inTransitTransfers')}
          loading={loading}
          href="/inventory/transfers"
        />
        <SummaryTile
          title="Pending approvals"
          icon={Inbox}
          value={count('approvals.pending', 'pendingApprovals')}
          loading={loading}
          href="/approvals"
        />
        <SummaryTile
          title="Maintenance due soon"
          icon={CalendarClock}
          value={count('maintenance.assetsDueSoon', 'maintenanceDue')}
          loading={loading}
          href="/maintenance/work-orders"
        />
        <SummaryTile
          title="Maintenance overdue"
          icon={CalendarClock}
          value={count('maintenance.assetsOverdue', 'maintenanceOverdue')}
          loading={loading}
          href="/maintenance/work-orders"
          alarmWhenPositive
        />
        <SummaryTile
          title="Open work orders"
          icon={Wrench}
          value={count('maintenance.openWorkOrders', 'openWorkOrders')}
          loading={loading}
          href="/maintenance/work-orders"
        />
        <SummaryTile
          title="Overdue work orders"
          icon={Wrench}
          value={count('maintenance.overdueWorkOrders', 'overdueWorkOrders')}
          loading={loading}
          href="/maintenance/work-orders"
          alarmWhenPositive
        />
        <SummaryTile
          title={expiryWindow ? `Warranties expiring (${expiryWindow}d)` : 'Warranties expiring'}
          icon={ShieldAlert}
          value={count('expirations.warrantiesExpiring', 'warrantiesExpiring')}
          loading={loading}
          href="/assets"
        />
        <SummaryTile
          title={expiryWindow ? `Lots expiring (${expiryWindow}d)` : 'Lots expiring'}
          icon={Layers}
          value={count('expirations.lotsExpiring', 'lotsExpiring')}
          loading={loading}
          href="/inventory/lots"
          alarmWhenPositive
        />
        <SummaryTile
          title="Open POs"
          icon={ShoppingCart}
          value={count('procurement.openPurchaseOrders', 'openPurchaseOrders')}
          loading={loading}
          href="/procurement/purchase-orders"
        />
        <SummaryTile
          title="Draft receipts"
          icon={PackageCheck}
          value={count('procurement.draftReceipts', 'draftReceipts')}
          loading={loading}
          href="/procurement/purchase-orders"
        />
      </div>

      <div className="mb-4">
        <RecentTransactionsCard summary={summary} loading={loading} />
      </div>
    </>
  );
}

/* ----------------------------- Self-scoped cards --------------------------- */

function MySessionsCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [revokeTarget, setRevokeTarget] = React.useState<SessionInfo | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: ({ signal }) => listMySessions(signal),
  });

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => revokeMySession(sessionId),
    onSuccess: () => {
      toast({ title: 'Session revoked', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>My sessions</CardTitle>
        <CardDescription>Active sign-ins for your account. Revoke any you do not recognize.</CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {sessionsQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : sessionsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={sessionsQuery.error} onRetry={() => sessionsQuery.refetch()} />
          </div>
        ) : sessionsQuery.data.length === 0 ? (
          <EmptyState title="No active sessions" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead className="hidden sm:table-cell">Signed in</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessionsQuery.data.map((session) => (
                <TableRow key={session.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="max-w-[14rem] truncate text-sm" title={session.userAgent ?? undefined}>
                        {session.userAgent ?? 'Unknown device'}
                      </span>
                      {session.current ? <Badge variant="success">This device</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">{session.ip ?? session.ipAddress ?? ''}</p>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                    {formatDateTime(session.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatRelativeTime(session.lastSeenAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {!session.current ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setRevokeTarget(session)}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke session"
        description={
          <>
            This will sign out the session on{' '}
            <span className="font-medium text-foreground">
              {revokeTarget?.userAgent ?? 'the selected device'}
            </span>
            . The device will need to sign in again.
          </>
        }
        confirmLabel="Revoke session"
        destructive
        onConfirm={async () => {
          if (revokeTarget) await revokeMutation.mutateAsync(revokeTarget.id);
        }}
      />
    </Card>
  );
}

function RecentActivityCard() {
  const auditQuery = useQuery({
    queryKey: ['audit-logs', 'recent'],
    queryFn: ({ signal }) => listAuditLogs({ page: 1, pageSize: 8 }, signal),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Latest audit events across your branches.</CardDescription>
        </div>
        <Link href="/audit-logs" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          View all
        </Link>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {auditQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : auditQuery.isError ? (
          <div className="p-4">
            <ErrorState error={auditQuery.error} onRetry={() => auditQuery.refetch()} />
          </div>
        ) : auditQuery.data.data.length === 0 ? (
          <EmptyState icon={ScrollText} title="No audit events yet" />
        ) : (
          <ul className="divide-y">
            {auditQuery.data.data.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    <span className="font-medium">{entry.actorDisplayName ?? 'System'}</span>{' '}
                    <span className="text-muted-foreground">{humanize(entry.action).toLowerCase()}</span>
                    {entry.resourceType ? (
                      <span className="text-muted-foreground"> · {humanize(entry.resourceType)}</span>
                    ) : null}
                  </p>
                </div>
                <time
                  className="shrink-0 text-xs tabular-nums text-muted-foreground"
                  title={formatDateTime(auditTimestamp(entry))}
                >
                  {formatRelativeTime(auditTimestamp(entry))}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Pending my approval" tile — the queue is self-scoped (own + assigned), so
 * the tile renders for every session (unlike the branch-wide summary tile).
 */
function PendingApprovalsTile() {
  const pendingQuery = useQuery({
    queryKey: ['approval-requests', 'count', 'pending-mine'],
    queryFn: ({ signal }) =>
      listApprovalRequests({ page: 1, pageSize: 1, status: 'PENDING', assignedToMe: true }, signal),
    retry: false,
  });

  if (pendingQuery.isError) return null;

  return (
    <StatCard
      title="Pending my approval"
      icon={Inbox}
      value={pendingQuery.data?.meta.total}
      loading={pendingQuery.isPending}
      error={undefined}
      href="/approvals"
    />
  );
}

/** Outstanding acknowledgments for the session user's employee record. */
function MyAcknowledgmentsCard({ employeeId }: { employeeId: string }) {
  const acknowledgmentsQuery = useQuery({
    queryKey: ['employees', 'acknowledgments', employeeId],
    queryFn: ({ signal }) => listEmployeeAcknowledgments(employeeId, signal),
    retry: false,
  });

  const data = acknowledgmentsQuery.data;
  const outstanding = data?.outstanding ?? [];
  const overdue = data?.overdueReturns ?? [];

  // 403/404 (no self-view scope yet) — hide silently rather than error noise.
  if (acknowledgmentsQuery.isError) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>My pending acknowledgments</CardTitle>
        <CardDescription>
          Assets issued to you awaiting confirmation, plus overdue expected returns.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {acknowledgmentsQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : outstanding.length === 0 && overdue.length === 0 ? (
          <EmptyState icon={BadgeCheck} title="Nothing pending" description="You're all caught up." />
        ) : (
          <ul className="divide-y">
            {[...outstanding, ...overdue.filter((row) => !outstanding.some((o) => o.id === row.id))].map(
              (row) => {
                const isOverdue = custodyIsOverdue(row);
                return (
                  <li key={row.id}>
                    <Link
                      href={row.asset ? `/assets/${row.asset.id}` : '#'}
                      className={
                        'flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 sm:px-5 ' +
                        (isOverdue ? 'bg-destructive/5' : '')
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {row.asset ? assetTag(row.asset) : 'Asset'}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.asset ? itemRefLabel(row.asset.item ?? null) : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        {!row.acknowledgedAt ? <Badge variant="warning">Acknowledge</Badge> : null}
                        {isOverdue ? (
                          <Badge variant="destructive" className="ml-1">
                            Overdue since {formatDate(custodyExpectedReturn(row))}
                          </Badge>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                );
              },
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { user, can, canAny } = useSession();
  const canViewAudit = can(PERMISSIONS.audit.view);
  const canViewReports = canAny(REPORTS_VIEW_PERMISSIONS);
  const myEmployeeId = meEmployeeId(user);

  const sessionsCount = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: ({ signal }) => listMySessions(signal),
  });

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.displayName}`}
        description="Overview of your GEM-ENI workspace."
      />

      {/* Personal tiles — self-scoped, for every session. */}
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PendingApprovalsTile />
        <StatCard
          title="My active sessions"
          icon={MonitorSmartphone}
          value={sessionsCount.data?.length}
          loading={sessionsCount.isPending}
          error={sessionsCount.error}
        />
        {canViewReports ? (
          <Link
            href="/reports"
            className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors hover:border-primary/40">
              <CardContent className="flex items-center gap-4 p-4 sm:p-5">
                <div className="rounded-md bg-primary/10 p-2.5">
                  <ClipboardList className="h-5 w-5 text-primary" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Reports</p>
                  <p className="truncate text-xs text-muted-foreground">
                    Run operational reports and exports
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ) : null}
      </div>

      {/* Phase 7 KPI summary — one API call, per-widget graceful absence. */}
      {canViewReports ? <SummarySection /> : null}

      {myEmployeeId ? (
        <div className="mb-4">
          <MyAcknowledgmentsCard employeeId={myEmployeeId} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MySessionsCard />
        {canViewAudit ? <RecentActivityCard /> : <YourAccessCard />}
      </div>
      {canViewAudit ? (
        <div className="mt-4">
          <YourAccessCard />
        </div>
      ) : null}
    </>
  );
}

function YourAccessCard() {
  const { user } = useSession();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your access</CardTitle>
        <CardDescription>Roles and branch access on your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles</p>
          <div className="flex flex-wrap gap-1.5">
            {user.roles.length === 0 ? (
              <span className="text-sm text-muted-foreground">No roles assigned</span>
            ) : (
              user.roles.map((role) => (
                <Badge key={role} variant="secondary">
                  {humanize(role)}
                </Badge>
              ))
            )}
            {user.isSuperAdmin ? <Badge>Super Admin</Badge> : null}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Branch access
          </p>
          <p className="text-sm text-muted-foreground">
            {user.isSuperAdmin
              ? 'All branches (Super Admin)'
              : user.branchIds.length === 0
                ? 'No branch access'
                : `${user.branchIds.length} ${user.branchIds.length === 1 ? 'branch' : 'branches'}`}
          </p>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Permissions
          </p>
          <p className="text-sm text-muted-foreground">
            {user.isSuperAdmin ? 'All permissions' : `${user.permissions.length} granted`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
