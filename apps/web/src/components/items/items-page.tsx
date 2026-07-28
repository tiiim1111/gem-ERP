'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Package, PackagePlus, ScanBarcode, Search } from 'lucide-react';
import { ItemBusinessCategory, PERMISSIONS, TrackingMethod } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { listItemCategories, listItems, resolveBarcode } from '@/lib/endpoints';
import { resolvedItemId, type Item } from '@/lib/types';
import { humanize } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
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

export function businessCategoryBadge(category: Item['businessCategory']) {
  const variant =
    category === ItemBusinessCategory.SERIALIZED_ASSET
      ? ('default' as const)
      : category === ItemBusinessCategory.CONSUMABLE
        ? ('secondary' as const)
        : ('outline' as const);
  const label =
    category === ItemBusinessCategory.SERIALIZED_ASSET
      ? 'Serialized asset'
      : category === ItemBusinessCategory.CONSUMABLE
        ? 'Consumable'
        : 'Bulk non-consumable';
  return <Badge variant={variant}>{label}</Badge>;
}

export function trackingMethodBadge(method: Item['trackingMethod']) {
  return <Badge variant="outline">{humanize(method)}</Badge>;
}

/** Scanner-friendly box: resolves any barcode and jumps to the item. */
function BarcodeSearch() {
  const router = useRouter();
  const { toast } = useToast();
  const [code, setCode] = React.useState('');
  const [resolving, setResolving] = React.useState(false);

  const handleResolve = async () => {
    const trimmed = code.trim();
    if (!trimmed || resolving) return;
    setResolving(true);
    try {
      const resolved = await resolveBarcode(trimmed);
      const itemId = resolvedItemId(resolved);
      if (itemId) {
        setCode('');
        router.push(`/items/${itemId}`);
      } else {
        toast({
          title: 'Not an item barcode',
          description: `“${trimmed}” resolves to a ${humanize(resolved.kind ?? resolved.type ?? 'record').toLowerCase()}.`,
        });
      }
    } catch (error) {
      if (isApiClientError(error) && error.status === 404) {
        toast({
          title: 'Barcode not found',
          description: `No record matches “${trimmed}”.`,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Barcode lookup failed',
          description: getErrorMessage(error),
          variant: 'destructive',
        });
      }
    } finally {
      setResolving(false);
    }
  };

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void handleResolve();
      }}
    >
      <div className="relative flex-1 sm:w-56 sm:flex-none">
        <ScanBarcode
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Scan or type a barcode…"
          aria-label="Resolve a barcode"
          className="pl-8"
        />
      </div>
      <Button type="submit" variant="outline" loading={resolving} disabled={!code.trim()}>
        Go
      </Button>
    </form>
  );
}

type ActiveFilter = 'all' | 'active' | 'inactive';

export function ItemsPage() {
  const { can } = useSession();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [businessCategory, setBusinessCategory] = React.useState('');
  const [trackingMethod, setTrackingMethod] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState<ActiveFilter>('all');
  const debouncedSearch = useDebouncedValue(search);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, businessCategory, trackingMethod, categoryId, activeFilter, pageSize]);

  const params = {
    page,
    pageSize,
    q: debouncedSearch || undefined,
    businessCategory: businessCategory || undefined,
    trackingMethod: trackingMethod || undefined,
    categoryId: categoryId || undefined,
    isActive: activeFilter === 'all' ? undefined : activeFilter === 'active',
  };

  const itemsQuery = useQuery({
    queryKey: ['items', 'list', params],
    queryFn: ({ signal }) => listItems(params, signal),
    placeholderData: keepPreviousData,
  });

  const categoriesQuery = useQuery({
    queryKey: ['item-categories', 'options'],
    queryFn: ({ signal }) => listItemCategories({ page: 1, pageSize: 100 }, signal),
  });

  const categoryName = React.useCallback(
    (item: Item) => {
      if (item.category) return item.category.name;
      if (!item.categoryId) return '—';
      return categoriesQuery.data?.data.find((entry) => entry.id === item.categoryId)?.name ?? '—';
    },
    [categoriesQuery.data],
  );

  const canCreate = can(PERMISSIONS.item.create);
  const data = itemsQuery.data;
  const hasFilters = !!(
    debouncedSearch ||
    businessCategory ||
    trackingMethod ||
    categoryId ||
    activeFilter !== 'all'
  );

  return (
    <>
      <PageHeader
        title="Items"
        description="The item master — SKUs, tracking rules, units, and barcodes."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <BarcodeSearch />
            {canCreate ? (
              <Link href="/items/new" className={buttonVariants({})}>
                <PackagePlus aria-hidden /> New item
              </Link>
            ) : null}
          </div>
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
              placeholder="Search SKU or name…"
              aria-label="Search items"
              className="pl-8"
            />
          </div>
          <Select
            aria-label="Filter by business category"
            value={businessCategory}
            onChange={(event) => setBusinessCategory(event.target.value)}
          >
            <option value="">All business categories</option>
            <option value={ItemBusinessCategory.SERIALIZED_ASSET}>Serialized asset</option>
            <option value={ItemBusinessCategory.CONSUMABLE}>Consumable</option>
            <option value={ItemBusinessCategory.BULK_NON_CONSUMABLE}>Bulk non-consumable</option>
          </Select>
          <Select
            aria-label="Filter by tracking method"
            value={trackingMethod}
            onChange={(event) => setTrackingMethod(event.target.value)}
          >
            <option value="">All tracking methods</option>
            {Object.values(TrackingMethod).map((method) => (
              <option key={method} value={method}>
                {humanize(method)}
              </option>
            ))}
          </Select>
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
            value={activeFilter}
            onChange={(event) => setActiveFilter(event.target.value as ActiveFilter)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </Select>
        </div>

        {itemsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : itemsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={itemsQuery.error} onRetry={() => itemsQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No items found"
            description={
              hasFilters ? 'Try adjusting your search or filters.' : 'Create the first item to get started.'
            }
            action={
              canCreate && !hasFilters ? (
                <Link href="/items/new" className={buttonVariants({})}>
                  <PackagePlus aria-hidden /> New item
                </Link>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Business category</TableHead>
                  <TableHead className="hidden lg:table-cell">Tracking</TableHead>
                  <TableHead className="hidden xl:table-cell">Category</TableHead>
                  <TableHead className="hidden xl:table-cell">Brand</TableHead>
                  <TableHead className="hidden sm:table-cell">Base UOM</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        href={`/items/${item.id}`}
                        className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.sku}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/items/${item.id}`}
                        className="text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {businessCategoryBadge(item.businessCategory)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {trackingMethodBadge(item.trackingMethod)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                      {categoryName(item)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                      {item.brand?.name ?? '—'}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">
                      {item.baseUom?.code ?? '—'}
                    </TableCell>
                    <TableCell>
                      {item.isActive ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="muted">Inactive</Badge>
                      )}
                    </TableCell>
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
