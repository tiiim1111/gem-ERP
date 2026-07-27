'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  Search,
  ShieldCheck,
  UserPlus,
  UserRoundCheck,
  UserRoundX,
  Building2,
  Users as UsersIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { activateUser, deactivateUser, listUsers } from '@/lib/endpoints';
import { userBranchIds, type UserRecord } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ResetPasswordDialog } from './reset-password-dialog';
import { UserBranchAccessDialog, UserRolesDialog } from './user-access-dialogs';
import { UserFormDialog } from './user-form-dialog';

type ActiveFilter = 'all' | 'active' | 'inactive';

export function UsersPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState<ActiveFilter>('all');
  const debouncedSearch = useDebouncedValue(search);

  // Dialog state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<UserRecord | null>(null);
  const [rolesTarget, setRolesTarget] = React.useState<UserRecord | null>(null);
  const [branchesTarget, setBranchesTarget] = React.useState<UserRecord | null>(null);
  const [resetTarget, setResetTarget] = React.useState<UserRecord | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<UserRecord | null>(null);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, activeFilter, pageSize]);

  const params = {
    page,
    pageSize,
    q: debouncedSearch || undefined,
    isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
  };

  const usersQuery = useQuery({
    queryKey: ['users', 'list', params],
    queryFn: ({ signal }) => listUsers(params, signal),
    placeholderData: keepPreviousData,
  });

  const toggleMutation = useMutation({
    mutationFn: (user: UserRecord) => (user.isActive ? deactivateUser(user.id) : activateUser(user.id)),
    onSuccess: (_, user) => {
      toast({
        title: user.isActive ? 'User deactivated' : 'User activated',
        description: user.isActive
          ? `${user.displayName} can no longer sign in; their sessions were revoked.`
          : `${user.displayName} can sign in again.`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const canCreate = can(PERMISSIONS.user.create);
  const canUpdate = can(PERMISSIONS.user.update);
  const canManageRoles = can(PERMISSIONS.user.manageRoles);
  const canManageBranches = can(PERMISSIONS.user.manageBranchAccess);
  const canReset = can(PERMISSIONS.user.resetPassword);
  const canActivate = can(PERMISSIONS.user.activate);
  const canDeactivate = can(PERMISSIONS.user.deactivate);
  const hasAnyRowAction = canUpdate || canManageRoles || canManageBranches || canReset || canActivate || canDeactivate;

  const data = usersQuery.data;

  return (
    <>
      <PageHeader
        title="Users"
        description="Accounts, roles, and branch access for GEM ERP."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus aria-hidden /> New user
            </Button>
          ) : undefined
        }
      />

      <Card>
        {/* Filters */}
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or email…"
              aria-label="Search users"
              className="pl-8"
            />
          </div>
          <Select
            aria-label="Filter by status"
            className="sm:w-40"
            value={activeFilter}
            onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </Select>
        </div>

        {usersQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : usersQuery.isError ? (
          <div className="p-4">
            <ErrorState error={usersQuery.error} onRetry={() => usersQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={UsersIcon}
            title="No users found"
            description={
              debouncedSearch || activeFilter !== 'all'
                ? 'Try adjusting your search or filters.'
                : 'Create the first user to get started.'
            }
            action={
              canCreate && !debouncedSearch && activeFilter === 'all' ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <UserPlus aria-hidden /> New user
                </Button>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead className="hidden md:table-cell">Roles</TableHead>
                  <TableHead className="hidden lg:table-cell">Branches</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden xl:table-cell">Last login</TableHead>
                  {hasAnyRowAction ? <TableHead className="w-12 text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <p className="font-medium">{user.displayName}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {(user.roles ?? []).length === 0 ? (
                          <span className="text-xs text-muted-foreground">None</span>
                        ) : (
                          (user.roles ?? []).map((role) => (
                            <Badge key={role.id} variant="secondary">
                              {role.name}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {user.branches && user.branches.length > 0
                        ? user.branches.map((branch) => branch.code).join(', ')
                        : userBranchIds(user).length > 0
                          ? `${userBranchIds(user).length} branches`
                          : '—'}
                    </TableCell>
                    <TableCell>
                      {user.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="muted">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                      {formatDateTime(user.lastLoginAt)}
                    </TableCell>
                    {hasAnyRowAction ? (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Actions for ${user.displayName}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {canUpdate ? (
                              <DropdownMenuItem onClick={() => setEditTarget(user)}>
                                <Pencil aria-hidden /> Edit profile
                              </DropdownMenuItem>
                            ) : null}
                            {canManageRoles ? (
                              <DropdownMenuItem onClick={() => setRolesTarget(user)}>
                                <ShieldCheck aria-hidden /> Manage roles
                              </DropdownMenuItem>
                            ) : null}
                            {canManageBranches ? (
                              <DropdownMenuItem onClick={() => setBranchesTarget(user)}>
                                <Building2 aria-hidden /> Branch access
                              </DropdownMenuItem>
                            ) : null}
                            {canReset ? (
                              <DropdownMenuItem onClick={() => setResetTarget(user)}>
                                <KeyRound aria-hidden /> Reset password
                              </DropdownMenuItem>
                            ) : null}
                            {(user.isActive && canDeactivate) || (!user.isActive && canActivate) ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  destructive={user.isActive}
                                  onClick={() => setToggleTarget(user)}
                                >
                                  {user.isActive ? (
                                    <>
                                      <UserRoundX aria-hidden /> Deactivate
                                    </>
                                  ) : (
                                    <>
                                      <UserRoundCheck aria-hidden /> Activate
                                    </>
                                  )}
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>

      {/* Dialogs */}
      <UserFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <UserFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        user={editTarget}
      />
      <UserRolesDialog
        open={rolesTarget !== null}
        onOpenChange={(open) => !open && setRolesTarget(null)}
        user={rolesTarget}
      />
      <UserBranchAccessDialog
        open={branchesTarget !== null}
        onOpenChange={(open) => !open && setBranchesTarget(null)}
        user={branchesTarget}
      />
      <ResetPasswordDialog
        open={resetTarget !== null}
        onOpenChange={(open) => !open && setResetTarget(null)}
        user={resetTarget}
      />
      <ConfirmDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.isActive ? 'Deactivate user' : 'Activate user'}
        destructive={!!toggleTarget?.isActive}
        confirmLabel={toggleTarget?.isActive ? 'Deactivate' : 'Activate'}
        description={
          toggleTarget?.isActive ? (
            <>
              <span className="font-medium text-foreground">{toggleTarget?.displayName}</span> will no
              longer be able to sign in and all their active sessions will be revoked. Their history is
              preserved.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{toggleTarget?.displayName}</span> will be able
              to sign in again.
            </>
          )
        }
        onConfirm={async () => {
          if (toggleTarget) await toggleMutation.mutateAsync(toggleTarget);
        }}
      />
    </>
  );
}
