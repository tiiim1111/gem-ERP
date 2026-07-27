'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, MoreHorizontal, Pencil, Plus, Power, PowerOff } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { activateBranch, deactivateBranch, listBranches } from '@/lib/endpoints';
import type { Branch } from '@/lib/types';
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
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { BranchFormDialog } from './branch-form-dialog';

type ActiveFilter = 'all' | 'active' | 'inactive';

export function BranchesPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [activeFilter, setActiveFilter] = React.useState<ActiveFilter>('all');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<Branch | null>(null);
  const [toggleTarget, setToggleTarget] = React.useState<Branch | null>(null);

  React.useEffect(() => {
    setPage(1);
  }, [activeFilter, pageSize]);

  const params = {
    page,
    pageSize,
    isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
  };

  const branchesQuery = useQuery({
    queryKey: ['branches', 'list', params],
    queryFn: ({ signal }) => listBranches(params, signal),
    placeholderData: keepPreviousData,
  });

  const toggleMutation = useMutation({
    mutationFn: (branch: Branch) =>
      branch.isActive ? deactivateBranch(branch.id) : activateBranch(branch.id),
    onSuccess: (_, branch) => {
      toast({
        title: branch.isActive ? 'Branch deactivated' : 'Branch activated',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['branches'] });
    },
  });

  const canCreate = can(PERMISSIONS.branch.create);
  const canUpdate = can(PERMISSIONS.branch.update);
  const canActivate = can(PERMISSIONS.branch.activate);
  const canDeactivate = can(PERMISSIONS.branch.deactivate);
  const hasRowActions = canUpdate || canActivate || canDeactivate;

  const data = branchesQuery.data;

  return (
    <>
      <PageHeader
        title="Branches"
        description="Company branches, their warehouses, and storage locations."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden /> New branch
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
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

        {branchesQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : branchesQuery.isError ? (
          <div className="p-4">
            <ErrorState error={branchesQuery.error} onRetry={() => branchesQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No branches found"
            description={activeFilter !== 'all' ? 'Try changing the status filter.' : undefined}
            action={
              canCreate && activeFilter === 'all' ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden /> New branch
                </Button>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead className="hidden md:table-cell">Address</TableHead>
                  <TableHead className="hidden lg:table-cell">Timezone</TableHead>
                  <TableHead>Status</TableHead>
                  {hasRowActions ? <TableHead className="w-12 text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((branch) => (
                  <TableRow key={branch.id}>
                    <TableCell>
                      <Link
                        href={`/branches/${branch.id}`}
                        className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {branch.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{branch.code}</p>
                    </TableCell>
                    <TableCell className="hidden max-w-md truncate text-sm text-muted-foreground md:table-cell">
                      {branch.address ?? '—'}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {branch.timezone ?? '—'}
                    </TableCell>
                    <TableCell>
                      {branch.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="muted">Inactive</Badge>
                      )}
                    </TableCell>
                    {hasRowActions ? (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label={`Actions for ${branch.name}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <MoreHorizontal className="h-4 w-4" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            {canUpdate ? (
                              <DropdownMenuItem onClick={() => setEditTarget(branch)}>
                                <Pencil aria-hidden /> Edit
                              </DropdownMenuItem>
                            ) : null}
                            {(branch.isActive && canDeactivate) || (!branch.isActive && canActivate) ? (
                              <>
                                {canUpdate ? <DropdownMenuSeparator /> : null}
                                <DropdownMenuItem
                                  destructive={branch.isActive}
                                  onClick={() => setToggleTarget(branch)}
                                >
                                  {branch.isActive ? (
                                    <>
                                      <PowerOff aria-hidden /> Deactivate
                                    </>
                                  ) : (
                                    <>
                                      <Power aria-hidden /> Activate
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

      <BranchFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <BranchFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        branch={editTarget}
      />
      <ConfirmDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.isActive ? 'Deactivate branch' : 'Activate branch'}
        destructive={!!toggleTarget?.isActive}
        confirmLabel={toggleTarget?.isActive ? 'Deactivate' : 'Activate'}
        description={
          toggleTarget?.isActive ? (
            <>
              <span className="font-medium text-foreground">{toggleTarget?.name}</span> will be unavailable
              for new activity. Existing records and history are preserved.
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{toggleTarget?.name}</span> will be available
              again for new activity.
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
