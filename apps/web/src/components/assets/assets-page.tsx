'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { MonitorSmartphone, Plus } from 'lucide-react';
import { AssetStatus, PERMISSIONS } from '@gemerp/shared';
import { listAssets } from '@/lib/endpoints';
import { assetCustodian, assetTag, conditionLabel, employeeName, itemRefLabel, refLabel } from '@/lib/types';
import { formatDate, humanize } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Input } from '@/components/ui/input';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { assetStatusBadge } from '@/components/inventory/badges';
import { LookupSelect, useBranchOptions } from '@/components/inventory/pickers';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { AssetRegisterDialog } from './asset-register-dialog';

export function AssetsPage() {
  const { can } = useSession();
  const { branches } = useBranchOptions();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [conditionId, setConditionId] = React.useState('');
  const [custodianEmployeeId, setCustodianEmployeeId] = React.useState<string | null>(null);
  const [warrantyExpiring, setWarrantyExpiring] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const debouncedSearch = useDebouncedValue(search);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, branchId, conditionId, custodianEmployeeId, warrantyExpiring, pageSize]);

  const params = {
    page,
    pageSize,
    q: debouncedSearch || undefined,
    status: status || undefined,
    branchId: branchId || undefined,
    conditionId: conditionId || undefined,
    custodianEmployeeId: custodianEmployeeId ?? undefined,
    warrantyExpiringDays: warrantyExpiring ? 90 : undefined,
  };

  const assetsQuery = useQuery({
    queryKey: ['assets', 'list', params],
    queryFn: ({ signal }) => listAssets(params, signal),
    placeholderData: keepPreviousData,
  });

  const canCreate = can(PERMISSIONS.asset.create);
  const data = assetsQuery.data;
  const hasFilters = !!(
    debouncedSearch ||
    status ||
    branchId ||
    conditionId ||
    custodianEmployeeId ||
    warrantyExpiring
  );

  return (
    <>
      <PageHeader
        title="Assets"
        description="Serialized asset registry — every unit has a tag, custody trail, and lifecycle history."
        actions={
          canCreate ? (
            <Button onClick={() => setRegisterOpen(true)}>
              <Plus aria-hidden /> Register assets
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tag, serial, or item…"
            aria-label="Search assets"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {Object.values(AssetStatus).map((entry) => (
              <option key={entry} value={entry}>
                {humanize(entry)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by branch"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            <option value="">All branches</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
          <LookupSelect
            id="assets-condition"
            type="asset-conditions"
            value={conditionId}
            onChange={setConditionId}
            placeholder="All conditions"
          />
          <EmployeePicker
            id="assets-custodian"
            value={custodianEmployeeId}
            onChange={setCustodianEmployeeId}
            placeholder="Filter by custodian…"
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={warrantyExpiring}
              onChange={(event) => setWarrantyExpiring(event.target.checked)}
            />
            Warranty expiring within 90 days
          </label>
        </div>

        {assetsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : assetsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={assetsQuery.error} onRetry={() => assetsQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={MonitorSmartphone}
            title="No assets found"
            description={
              hasFilters
                ? 'Try adjusting your search or filters.'
                : 'Register the first serialized asset to get started.'
            }
            action={
              canCreate && !hasFilters ? (
                <Button onClick={() => setRegisterOpen(true)}>
                  <Plus aria-hidden /> Register assets
                </Button>
              ) : undefined
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Condition</TableHead>
                  <TableHead className="hidden lg:table-cell">Custodian</TableHead>
                  <TableHead className="hidden xl:table-cell">Branch</TableHead>
                  <TableHead className="hidden sm:table-cell">Warranty ends</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((asset) => {
                  const custodian = assetCustodian(asset);
                  return (
                    <TableRow key={asset.id}>
                      <TableCell>
                        <Link
                          href={`/assets/${asset.id}`}
                          className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {assetTag(asset)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{itemRefLabel(asset.item ?? null)}</TableCell>
                      <TableCell>{assetStatusBadge(asset.status)}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {conditionLabel(asset.condition) ? (
                          <Badge variant="outline">{conditionLabel(asset.condition)}</Badge>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {custodian ? employeeName(custodian) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                        {asset.branch ? refLabel(asset.branch) : '—'}
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                        {formatDate(asset.warrantyEndDate)}
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

      <AssetRegisterDialog open={registerOpen} onOpenChange={setRegisterOpen} />
    </>
  );
}
