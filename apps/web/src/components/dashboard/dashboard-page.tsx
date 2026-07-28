'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  IdCard,
  MonitorSmartphone,
  Package,
  ScrollText,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage } from '@/lib/api';
import {
  listAuditLogs,
  listBranches,
  listEmployees,
  listItems,
  listMySessions,
  listRoles,
  listUsers,
  revokeMySession,
} from '@/lib/endpoints';
import { auditTimestamp, type SessionInfo } from '@/lib/types';
import { formatDateTime, formatRelativeTime, humanize } from '@/lib/utils';
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

export function DashboardPage() {
  const { user, can } = useSession();
  const { toast } = useToast();

  const canViewUsers = can(PERMISSIONS.user.view);
  const canViewBranches = can(PERMISSIONS.branch.view);
  const canViewRoles = can(PERMISSIONS.role.view);
  const canViewAudit = can(PERMISSIONS.audit.view);
  const canViewEmployees = can(PERMISSIONS.employee.view);
  const canViewItems = can(PERMISSIONS.item.view);

  const usersCount = useQuery({
    queryKey: ['users', 'count'],
    queryFn: ({ signal }) => listUsers({ page: 1, pageSize: 1 }, signal),
    enabled: canViewUsers,
  });
  const branchesCount = useQuery({
    queryKey: ['branches', 'count'],
    queryFn: ({ signal }) => listBranches({ page: 1, pageSize: 1 }, signal),
    enabled: canViewBranches,
  });
  const rolesCount = useQuery({
    queryKey: ['roles', 'count'],
    queryFn: ({ signal }) => listRoles({ page: 1, pageSize: 1 }, signal),
    enabled: canViewRoles,
  });
  const employeesCount = useQuery({
    queryKey: ['employees', 'count'],
    queryFn: ({ signal }) => listEmployees({ page: 1, pageSize: 1 }, signal),
    enabled: canViewEmployees,
  });
  const itemsCount = useQuery({
    queryKey: ['items', 'count'],
    queryFn: ({ signal }) => listItems({ page: 1, pageSize: 1 }, signal),
    enabled: canViewItems,
  });
  const sessionsCount = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: ({ signal }) => listMySessions(signal),
  });

  React.useEffect(() => {
    const failed = [
      usersCount.error,
      branchesCount.error,
      rolesCount.error,
      employeesCount.error,
      itemsCount.error,
    ].find(Boolean);
    if (failed) {
      toast({
        title: 'Some dashboard data failed to load',
        description: getErrorMessage(failed),
        variant: 'destructive',
      });
    }
    // Intentionally keyed on error identity only.
  }, [
    usersCount.error,
    branchesCount.error,
    rolesCount.error,
    employeesCount.error,
    itemsCount.error,
    toast,
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.displayName}`}
        description="Overview of your GEM ERP workspace."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {canViewEmployees ? (
          <StatCard
            title="Employees"
            icon={IdCard}
            value={employeesCount.data?.meta.total}
            loading={employeesCount.isPending}
            error={employeesCount.error}
            href="/employees"
          />
        ) : null}
        {canViewItems ? (
          <StatCard
            title="Items"
            icon={Package}
            value={itemsCount.data?.meta.total}
            loading={itemsCount.isPending}
            error={itemsCount.error}
            href="/items"
          />
        ) : null}
        {canViewUsers ? (
          <StatCard
            title="Users"
            icon={Users}
            value={usersCount.data?.meta.total}
            loading={usersCount.isPending}
            error={usersCount.error}
            href="/users"
          />
        ) : null}
        {canViewBranches ? (
          <StatCard
            title="Branches"
            icon={Building2}
            value={branchesCount.data?.meta.total}
            loading={branchesCount.isPending}
            error={branchesCount.error}
            href="/branches"
          />
        ) : null}
        {canViewRoles ? (
          <StatCard
            title="Roles"
            icon={ShieldCheck}
            value={rolesCount.data?.meta.total}
            loading={rolesCount.isPending}
            error={rolesCount.error}
            href="/roles"
          />
        ) : null}
        <StatCard
          title="My active sessions"
          icon={MonitorSmartphone}
          value={sessionsCount.data?.length}
          loading={sessionsCount.isPending}
          error={sessionsCount.error}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
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
