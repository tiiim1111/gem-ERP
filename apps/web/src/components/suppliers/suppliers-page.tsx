'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Factory, Plus } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { listLookupValues, listSuppliers } from '@/lib/endpoints';
import { supplierCategories, supplierContactsCount, supplierName } from '@/lib/types';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SupplierFormDialog } from './supplier-form-dialog';

export function SuppliersPage() {
  const { can } = useSession();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [active, setActive] = React.useState('');
  const [createOpen, setCreateOpen] = React.useState(false);

  const debouncedSearch = useDebouncedValue(search);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, categoryId, active, pageSize]);

  const params = {
    page,
    pageSize,
    q: debouncedSearch || undefined,
    categoryId: categoryId || undefined,
    isActive: active === '' ? undefined : active === 'true',
    sort: 'code:asc',
  };

  const suppliersQuery = useQuery({
    queryKey: ['suppliers', 'list', params],
    queryFn: ({ signal }) => listSuppliers(params, signal),
    placeholderData: keepPreviousData,
  });

  const categoriesQuery = useQuery({
    queryKey: ['lookups', 'supplier-categories', 'options'],
    queryFn: ({ signal }) =>
      listLookupValues('supplier-categories', { page: 1, pageSize: 100, isActive: true }, signal),
  });

  const canCreate = can(PERMISSIONS.supplier.create);
  const data = suppliersQuery.data;
  const hasFilters = !!(debouncedSearch || categoryId || active);

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Vendor master records — codes are permanent, deactivation preserves history."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden /> New supplier
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code or name…"
            aria-label="Search suppliers"
            className="lg:col-span-2"
          />
          <Select
            aria-label="Filter by category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">All categories</option>
            {(categoriesQuery.data?.data ?? []).map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by active state"
            value={active}
            onChange={(event) => setActive(event.target.value)}
          >
            <option value="">Active + inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </Select>
        </div>

        {suppliersQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : suppliersQuery.isError ? (
          <div className="p-4">
            <ErrorState error={suppliersQuery.error} onRetry={() => suppliersQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={Factory}
            title="No suppliers"
            description={
              hasFilters ? 'Try adjusting your filters.' : 'Create the first supplier to start purchasing.'
            }
            action={
              canCreate && !hasFilters ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus aria-hidden /> New supplier
                </Button>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Categories</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Contacts</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((supplier) => {
                  const categories = supplierCategories(supplier);
                  const contactsCount = supplierContactsCount(supplier);
                  return (
                    <TableRow key={supplier.id}>
                      <TableCell>
                        <Link
                          href={`/suppliers/${supplier.id}`}
                          className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {supplier.code}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        <Link href={`/suppliers/${supplier.id}`} className="font-medium hover:underline">
                          {supplierName(supplier)}
                        </Link>
                        {supplier.tradeName && supplier.legalName ? (
                          <p className="text-xs text-muted-foreground">{supplier.legalName}</p>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {categories.length === 0 ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {categories.map((category) => (
                              <Badge key={category.id} variant="secondary">
                                {category.name}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-right text-sm tabular-nums text-muted-foreground sm:table-cell">
                        {contactsCount ?? '—'}
                      </TableCell>
                      <TableCell>
                        {supplier.archivedAt ? (
                          <Badge variant="muted">Archived</Badge>
                        ) : supplier.isActive ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="muted">Inactive</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>

      <SupplierFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
