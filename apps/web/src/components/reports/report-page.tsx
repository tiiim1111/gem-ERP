'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileChartColumn, FileDown } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import {
  createExport,
  listDepartments,
  listItemCategories,
  runReport,
  type ExportFormat,
  type ReportQueryParams,
} from '@/lib/endpoints';
import { reportRowKey, supplierName } from '@/lib/types';
import { REPORTS_EXPORT_PERMISSIONS } from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ItemPicker, useBranchOptions, WarehouseSelect } from '@/components/inventory/pickers';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { SupplierPicker } from '@/components/procurement/supplier-picker';
import { REPORT_REGISTRY, type ReportFilterKey } from '@/components/reports/report-registry';

/* ----------------------- Saved filters (localStorage) ---------------------- */

type ReportFilters = Partial<Record<ReportFilterKey, string>>;

/** Display labels for combobox selections restored across sessions. */
interface FilterLabels {
  itemLabel?: string;
  employeeLabel?: string;
  supplierLabel?: string;
}

function storageKey(reportKey: string): string {
  return `gemerp:report-filters:${reportKey}`;
}

/** Keep only known string-valued keys from a persisted payload. */
function sanitizeFilters(value: unknown, allowed: readonly ReportFilterKey[]): ReportFilters {
  const filters: ReportFilters = {};
  if (value && typeof value === 'object') {
    for (const key of allowed) {
      const entry = (value as Record<string, unknown>)[key];
      if (typeof entry === 'string' && entry) filters[key] = entry;
    }
  }
  return filters;
}

function sanitizeLabels(value: unknown): FilterLabels {
  const labels: FilterLabels = {};
  if (value && typeof value === 'object') {
    for (const key of ['itemLabel', 'employeeLabel', 'supplierLabel'] as const) {
      const entry = (value as Record<string, unknown>)[key];
      if (typeof entry === 'string' && entry) labels[key] = entry;
    }
  }
  return labels;
}

/* ------------------------------ Extra pickers ------------------------------ */

/** Item-category filter select (top-level categories, house pageSize cap). */
function CategorySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const categoriesQuery = useQuery({
    queryKey: ['item-categories', 'options'],
    queryFn: ({ signal }) => listItemCategories({ page: 1, pageSize: 100, isActive: true }, signal),
  });
  return (
    <Select
      aria-label="Filter by category"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={categoriesQuery.isPending}
    >
      <option value="">Any category</option>
      {(categoriesQuery.data?.data ?? []).map((category) => (
        <option key={category.id} value={category.id}>
          {category.name}
        </option>
      ))}
    </Select>
  );
}

/** Department filter select ("Any department" empty option). */
function DepartmentFilterSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (departmentId: string) => void;
}) {
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: ({ signal }) => listDepartments({ page: 1, pageSize: 100, isActive: true }, signal),
  });
  return (
    <Select
      aria-label="Filter by department"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={departmentsQuery.isPending}
    >
      <option value="">Any department</option>
      {(departmentsQuery.data?.data ?? []).map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      ))}
    </Select>
  );
}

/* -------------------------------- The page --------------------------------- */

export function ReportPage({ reportKey }: { reportKey: string }) {
  const definition = REPORT_REGISTRY[reportKey];
  const { canAny } = useSession();
  const { branches } = useBranchOptions();
  const { toast } = useToast();
  const canExport = canAny(REPORTS_EXPORT_PERMISSIONS);

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [filters, setFilters] = React.useState<ReportFilters>({});
  const [labels, setLabels] = React.useState<FilterLabels>({});
  // Last-used filters restore after mount (avoids SSR/localStorage mismatch).
  const [restored, setRestored] = React.useState(false);

  const allowedFilters = React.useMemo(
    () => (definition ? definition.filters : []),
    [definition],
  );

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey(reportKey));
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        setFilters(sanitizeFilters(parsed['filters'], allowedFilters));
        setLabels(sanitizeLabels(parsed['labels']));
      }
    } catch {
      // Corrupt/blocked storage — start from a clean slate.
    }
    setRestored(true);
  }, [reportKey, allowedFilters]);

  React.useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(storageKey(reportKey), JSON.stringify({ filters, labels }));
    } catch {
      // Storage full/blocked — saved filters are best-effort.
    }
  }, [filters, labels, restored, reportKey]);

  React.useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  const setFilter = (key: ReportFilterKey, value: string) => {
    setFilters((current) => {
      const next: ReportFilters = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      // A warehouse belongs to its branch — clear it when the branch changes.
      if (key === 'branchId') delete next.warehouseId;
      return next;
    });
  };

  const params: ReportQueryParams = { page, pageSize, ...filters };

  const reportQuery = useQuery({
    queryKey: ['reports', reportKey, params],
    queryFn: ({ signal }) => runReport(reportKey, params, signal),
    placeholderData: keepPreviousData,
    enabled: !!definition && restored,
  });

  const exportMutation = useMutation({
    mutationFn: (format: ExportFormat) =>
      createExport({
        reportKey,
        format,
        filters: Object.fromEntries(
          Object.entries(filters).filter(([, value]) => !!value),
        ) as Record<string, string>,
      }),
    onSuccess: () => {
      toast({
        title: 'Export queued',
        description: 'Check the Export center — you will also get a notification when it is ready.',
        variant: 'success',
      });
    },
    onError: (error) => {
      toast({
        title: 'Could not queue the export',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  if (!definition) {
    return (
      <>
        <PageHeader
          title="Unknown report"
          actions={
            <Link href="/reports" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All reports
            </Link>
          }
        />
        <EmptyState
          icon={FileChartColumn}
          title="This report does not exist"
          description="Pick a report from the catalog."
        />
      </>
    );
  }

  const data = reportQuery.data;
  const rows = data?.data ?? [];
  // Cost columns render only when the server included their values (cost-gated).
  const columns = definition.columns.filter(
    (column) =>
      !column.costGated || rows.some((row) => (column.present ? column.present(row) : true)),
  );
  const hasFilters = Object.keys(filters).length > 0;
  const has = (key: ReportFilterKey) => definition.filters.includes(key);

  return (
    <>
      <PageHeader
        title={definition.title}
        description={definition.description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/reports" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All reports
            </Link>
            {canExport ? (
              <>
                {(['csv', 'xlsx', 'pdf'] as const).map((format) => (
                  <Button
                    key={format}
                    variant="outline"
                    disabled={exportMutation.isPending}
                    onClick={() => exportMutation.mutate(format)}
                  >
                    <FileDown aria-hidden /> {format.toUpperCase()}
                  </Button>
                ))}
                <Link href="/reports/exports" className={buttonVariants({ variant: 'ghost' })}>
                  Export center
                </Link>
              </>
            ) : null}
          </div>
        }
      />

      <Card>
        {definition.filters.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {has('branchId') ? (
              <Select
                aria-label="Filter by branch"
                value={filters.branchId ?? ''}
                onChange={(event) => setFilter('branchId', event.target.value)}
              >
                <option value="">Any branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            ) : null}
            {has('warehouseId') ? (
              <WarehouseSelect
                id={`report-${reportKey}-warehouse`}
                branchId={filters.branchId ?? ''}
                value={filters.warehouseId ?? ''}
                onChange={(warehouseId) => setFilter('warehouseId', warehouseId)}
              />
            ) : null}
            {has('categoryId') ? (
              <CategorySelect
                value={filters.categoryId ?? ''}
                onChange={(categoryId) => setFilter('categoryId', categoryId)}
              />
            ) : null}
            {has('itemId') ? (
              <ItemPicker
                id={`report-${reportKey}-item`}
                value={filters.itemId ?? null}
                selectedLabel={labels.itemLabel ?? null}
                onSelect={(item) => {
                  setFilter('itemId', item?.id ?? '');
                  setLabels((current) => ({ ...current, itemLabel: item?.name ?? undefined }));
                }}
                placeholder="Any item…"
              />
            ) : null}
            {has('employeeId') ? (
              <EmployeePicker
                id={`report-${reportKey}-employee`}
                value={filters.employeeId ?? null}
                selectedLabel={labels.employeeLabel ?? null}
                onChange={(employeeId) => setFilter('employeeId', employeeId ?? '')}
                placeholder="Any employee…"
              />
            ) : null}
            {has('departmentId') ? (
              <DepartmentFilterSelect
                value={filters.departmentId ?? ''}
                onChange={(departmentId) => setFilter('departmentId', departmentId)}
              />
            ) : null}
            {has('supplierId') ? (
              <SupplierPicker
                id={`report-${reportKey}-supplier`}
                value={filters.supplierId ?? null}
                selectedLabel={labels.supplierLabel ?? null}
                onSelect={(supplier) => {
                  setFilter('supplierId', supplier?.id ?? '');
                  setLabels((current) => ({
                    ...current,
                    supplierLabel: supplier ? supplierName(supplier) : undefined,
                  }));
                }}
                activeOnly={false}
                placeholder="Any supplier…"
              />
            ) : null}
            {has('status') && definition.statusOptions ? (
              <Select
                aria-label="Filter by status"
                value={filters.status ?? ''}
                onChange={(event) => setFilter('status', event.target.value)}
              >
                <option value="">All statuses</option>
                {definition.statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            ) : null}
            {has('from') ? (
              <Input
                type="date"
                value={filters.from ?? ''}
                onChange={(event) => setFilter('from', event.target.value)}
                aria-label="From date"
              />
            ) : null}
            {has('to') ? (
              <Input
                type="date"
                value={filters.to ?? ''}
                onChange={(event) => setFilter('to', event.target.value)}
                aria-label="To date"
              />
            ) : null}
            {hasFilters ? (
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters({});
                    setLabels({});
                  }}
                >
                  Reset filters
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {reportQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : reportQuery.isError ? (
          <div className="p-4">
            <ErrorState error={reportQuery.error} onRetry={() => reportQuery.refetch()} />
          </div>
        ) : data && rows.length === 0 ? (
          <EmptyState
            icon={FileChartColumn}
            title="No rows"
            description={
              hasFilters
                ? 'Try adjusting your filters.'
                : 'This report has no data yet for your branches.'
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className={cn(
                        column.align === 'right' && 'text-right',
                        column.hideBelow === 'md' && 'hidden md:table-cell',
                        column.hideBelow === 'lg' && 'hidden lg:table-cell',
                        column.hideBelow === 'xl' && 'hidden xl:table-cell',
                      )}
                    >
                      {column.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={reportRowKey(row, index)}>
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(
                          'text-sm',
                          column.align === 'right' && 'text-right font-mono text-xs tabular-nums',
                          column.hideBelow === 'md' && 'hidden md:table-cell',
                          column.hideBelow === 'lg' && 'hidden lg:table-cell',
                          column.hideBelow === 'xl' && 'hidden xl:table-cell',
                        )}
                      >
                        {column.render(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>
    </>
  );
}
