'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { MonitorSmartphone, Plus, Printer, X } from 'lucide-react';
import { AssetStatus, PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage, saveBlob } from '@/lib/api';
import { fetchAssetLabelSheet, listAssets } from '@/lib/endpoints';
import { assetCustodian, assetTag, conditionLabel, employeeName, itemRefLabel, refLabel } from '@/lib/types';
import { ASSET_LABEL_PERMISSIONS } from '@/lib/status-maps';
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
import { useToast } from '@/components/ui/toast';
import { assetStatusBadge } from '@/components/inventory/badges';
import { LookupSelect, useBranchOptions } from '@/components/inventory/pickers';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { AssetRegisterDialog } from './asset-register-dialog';

/** The batch endpoint caps a sheet at 100 assets. */
const MAX_LABEL_BATCH = 100;

export function AssetsPage() {
  const { can, canAny } = useSession();
  const { branches } = useBranchOptions();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [conditionId, setConditionId] = React.useState('');
  const [custodianEmployeeId, setCustodianEmployeeId] = React.useState<string | null>(null);
  const [warrantyExpiring, setWarrantyExpiring] = React.useState(false);
  const [registerOpen, setRegisterOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [labelSize, setLabelSize] = React.useState<'2x1' | '3x2'>('2x1');
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
  const canPrintLabels = canAny(ASSET_LABEL_PERMISSIONS);
  const data = assetsQuery.data;

  const toggleSelected = (assetId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) {
        next.delete(assetId);
      } else if (next.size < MAX_LABEL_BATCH) {
        next.add(assetId);
      }
      return next;
    });
  };

  const pageIds = (data?.data ?? []).map((asset) => asset.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someOnPageSelected = pageIds.some((id) => selectedIds.has(id));

  const togglePage = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allOnPageSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) {
          if (next.size >= MAX_LABEL_BATCH) break;
          next.add(id);
        }
      }
      return next;
    });
  };

  const labelSheetMutation = useMutation({
    mutationFn: async () => {
      const { blob } = await fetchAssetLabelSheet([...selectedIds], labelSize);
      return blob;
    },
    onSuccess: (blob) => {
      // Open the printable sheet in a new tab; fall back to a download when
      // the browser blocks the popup.
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) {
        saveBlob(blob, `asset-labels-${labelSize}.html`);
        toast({
          title: 'Label sheet downloaded',
          description: 'Pop-ups are blocked — open the downloaded HTML file and print it.',
        });
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    onError: (error) => {
      toast({
        title: 'Could not generate labels',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });
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
            {canPrintLabels && selectedIds.size > 0 ? (
              <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-3 py-2">
                <span className="text-sm font-medium">
                  {selectedIds.size} selected
                  {selectedIds.size >= MAX_LABEL_BATCH ? ' (max per sheet)' : ''}
                </span>
                <Select
                  aria-label="Label size"
                  className="w-44"
                  value={labelSize}
                  onChange={(event) => setLabelSize(event.target.value as '2x1' | '3x2')}
                >
                  <option value="2x1">2×1 in labels</option>
                  <option value="3x2">3×2 in labels</option>
                </Select>
                <Button
                  size="sm"
                  loading={labelSheetMutation.isPending}
                  onClick={() => labelSheetMutation.mutate()}
                >
                  <Printer aria-hidden /> Print label sheet
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
                  <X aria-hidden /> Clear
                </Button>
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  {canPrintLabels ? (
                    <TableHead className="w-10">
                      <Checkbox
                        aria-label="Select all assets on this page for label printing"
                        checked={allOnPageSelected}
                        indeterminate={!allOnPageSelected && someOnPageSelected}
                        onChange={togglePage}
                      />
                    </TableHead>
                  ) : null}
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
                      {canPrintLabels ? (
                        <TableCell>
                          <Checkbox
                            aria-label={`Select ${assetTag(asset)} for label printing`}
                            checked={selectedIds.has(asset.id)}
                            onChange={() => toggleSelected(asset.id)}
                          />
                        </TableCell>
                      ) : null}
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
