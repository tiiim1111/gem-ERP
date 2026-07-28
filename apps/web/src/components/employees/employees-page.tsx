'use client';

import * as React from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Eye,
  IdCard,
  MoreHorizontal,
  Pencil,
  Search,
  UserRoundCheck,
  UserRoundMinus,
  UserRoundX,
  UserRoundPlus,
} from 'lucide-react';
import { EmployeeStatus, PERMISSIONS } from '@gemerp/shared';
import {
  activateEmployee,
  listBranches,
  listDepartments,
  listEmployees,
  listPositions,
} from '@/lib/endpoints';
import { employeeName, type Employee } from '@/lib/types';
import { humanize } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
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
import { EmployeeDetailSheet, employeeStatusBadge } from './employee-detail-sheet';
import { EmployeeFormDialog } from './employee-form-dialog';
import {
  EmployeeArchiveDialog,
  EmployeeDeactivateDialog,
  EmployeeSeparationDialog,
} from './employee-status-dialogs';

export function EmployeesPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [departmentId, setDepartmentId] = React.useState('');
  const [positionId, setPositionId] = React.useState('');
  const [status, setStatus] = React.useState('');
  const debouncedSearch = useDebouncedValue(search);

  // Dialog state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<Employee | null>(null);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = React.useState<Employee | null>(null);
  const [activateTarget, setActivateTarget] = React.useState<Employee | null>(null);
  const [separateTarget, setSeparateTarget] = React.useState<Employee | null>(null);
  const [archiveTarget, setArchiveTarget] = React.useState<Employee | null>(null);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, branchId, departmentId, positionId, status, pageSize]);

  const params = {
    page,
    pageSize,
    q: debouncedSearch || undefined,
    branchId: branchId || undefined,
    departmentId: departmentId || undefined,
    positionId: positionId || undefined,
    status: status || undefined,
  };

  const employeesQuery = useQuery({
    queryKey: ['employees', 'list', params],
    queryFn: ({ signal }) => listEmployees(params, signal),
    placeholderData: keepPreviousData,
  });

  // Filter option sources (also used as name fallbacks for table cells).
  const branchesQuery = useQuery({
    queryKey: ['branches', 'options'],
    queryFn: ({ signal }) => listBranches({ page: 1, pageSize: 100 }, signal),
  });
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: ({ signal }) => listDepartments({ page: 1, pageSize: 100 }, signal),
  });
  const positionsQuery = useQuery({
    queryKey: ['positions', 'options'],
    queryFn: ({ signal }) => listPositions({ page: 1, pageSize: 100 }, signal),
  });

  const branchName = React.useCallback(
    (employee: Employee) => {
      if (employee.branch) return employee.branch.code || employee.branch.name;
      const branch = branchesQuery.data?.data.find((entry) => entry.id === employee.branchId);
      return branch?.code ?? '—';
    },
    [branchesQuery.data],
  );
  const departmentName = React.useCallback(
    (employee: Employee) => {
      if (employee.department) return employee.department.name;
      if (!employee.departmentId) return '—';
      return (
        departmentsQuery.data?.data.find((entry) => entry.id === employee.departmentId)?.name ?? '—'
      );
    },
    [departmentsQuery.data],
  );
  const positionName = React.useCallback(
    (employee: Employee) => {
      if (employee.position) return employee.position.name;
      if (!employee.positionId) return '—';
      return positionsQuery.data?.data.find((entry) => entry.id === employee.positionId)?.name ?? '—';
    },
    [positionsQuery.data],
  );

  const activateMutation = useMutation({
    mutationFn: (employee: Employee) => activateEmployee(employee.id),
    onSuccess: (_, employee) => {
      toast({
        title: 'Employee activated',
        description: `${employeeName(employee)} is active again.`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
  });

  const canCreate = can(PERMISSIONS.employee.create);
  const canUpdate = can(PERMISSIONS.employee.update);
  const canArchive = can(PERMISSIONS.employee.archive);
  const hasRowActions = canUpdate || canArchive;

  const data = employeesQuery.data;
  const hasFilters = !!(debouncedSearch || branchId || departmentId || positionId || status);

  return (
    <>
      <PageHeader
        title="Employees"
        description="Custody records for asset assignment and issuance — not payroll."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <UserRoundPlus aria-hidden /> New employee
            </Button>
          ) : undefined
        }
      />

      <Card>
        {/* Filters */}
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name or number…"
              aria-label="Search employees"
              className="pl-8"
            />
          </div>
          <Select
            aria-label="Filter by branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">All branches</option>
            {(branchesQuery.data?.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">All departments</option>
            {(departmentsQuery.data?.data ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by position"
            value={positionId}
            onChange={(event) => setPositionId(event.target.value)}
          >
            <option value="">All positions</option>
            {(positionsQuery.data?.data ?? []).map((position) => (
              <option key={position.id} value={position.id}>
                {position.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.values(EmployeeStatus).map((value) => (
              <option key={value} value={value}>
                {humanize(value)}
              </option>
            ))}
          </Select>
        </div>

        {employeesQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : employeesQuery.isError ? (
          <div className="p-4">
            <ErrorState error={employeesQuery.error} onRetry={() => employeesQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title="No employees found"
            description={
              hasFilters
                ? 'Try adjusting your search or filters.'
                : 'Create the first employee record to get started.'
            }
            action={
              canCreate && !hasFilters ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <UserRoundPlus aria-hidden /> New employee
                </Button>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Employee #</TableHead>
                  <TableHead className="hidden md:table-cell">Branch</TableHead>
                  <TableHead className="hidden lg:table-cell">Department</TableHead>
                  <TableHead className="hidden lg:table-cell">Position</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden xl:table-cell">Email</TableHead>
                  <TableHead className="w-12 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setDetailId(employee.id)}
                        className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {employeeName(employee)}
                      </button>
                      <p className="font-mono text-xs text-muted-foreground sm:hidden">
                        {employee.employeeNumber}
                      </p>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">
                      {employee.employeeNumber}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {branchName(employee)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {departmentName(employee)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {positionName(employee)}
                    </TableCell>
                    <TableCell>{employeeStatusBadge(employee.status)}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                      {employee.workEmail || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          aria-label={`Actions for ${employeeName(employee)}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <MoreHorizontal className="h-4 w-4" aria-hidden />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onClick={() => setDetailId(employee.id)}>
                            <Eye aria-hidden /> View details
                          </DropdownMenuItem>
                          {canUpdate ? (
                            <DropdownMenuItem onClick={() => setEditTarget(employee)}>
                              <Pencil aria-hidden /> Edit
                            </DropdownMenuItem>
                          ) : null}
                          {hasRowActions ? <DropdownMenuSeparator /> : null}
                          {canUpdate && employee.status !== EmployeeStatus.ACTIVE && employee.status !== EmployeeStatus.SEPARATED ? (
                            <DropdownMenuItem onClick={() => setActivateTarget(employee)}>
                              <UserRoundCheck aria-hidden /> Activate
                            </DropdownMenuItem>
                          ) : null}
                          {canUpdate && employee.status === EmployeeStatus.ACTIVE ? (
                            <DropdownMenuItem onClick={() => setDeactivateTarget(employee)}>
                              <UserRoundMinus aria-hidden /> Deactivate…
                            </DropdownMenuItem>
                          ) : null}
                          {canArchive && employee.status !== EmployeeStatus.SEPARATED ? (
                            <DropdownMenuItem destructive onClick={() => setSeparateTarget(employee)}>
                              <UserRoundX aria-hidden /> Separate…
                            </DropdownMenuItem>
                          ) : null}
                          {canArchive && employee.status === EmployeeStatus.SEPARATED && !employee.archivedAt ? (
                            <DropdownMenuItem destructive onClick={() => setArchiveTarget(employee)}>
                              <Archive aria-hidden /> Archive
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>

      {/* Dialogs & drawers */}
      <EmployeeFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <EmployeeFormDialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        employee={editTarget}
      />
      <EmployeeDetailSheet
        open={detailId !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
        employeeId={detailId}
      />
      <EmployeeDeactivateDialog
        open={deactivateTarget !== null}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        employee={deactivateTarget}
      />
      <EmployeeSeparationDialog
        open={separateTarget !== null}
        onOpenChange={(open) => !open && setSeparateTarget(null)}
        employee={separateTarget}
        canArchive={canArchive}
      />
      <EmployeeArchiveDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        employee={archiveTarget}
      />
      <ConfirmDialog
        open={activateTarget !== null}
        onOpenChange={(open) => !open && setActivateTarget(null)}
        title="Activate employee"
        confirmLabel="Activate"
        description={
          <>
            <span className="font-medium text-foreground">
              {activateTarget ? employeeName(activateTarget) : ''}
            </span>{' '}
            will be available again for asset assignment and issuance.
          </>
        }
        onConfirm={async () => {
          if (activateTarget) await activateMutation.mutateAsync(activateTarget);
        }}
      />
    </>
  );
}
