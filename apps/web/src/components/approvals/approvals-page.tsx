'use client';

import * as React from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Eye, Inbox } from 'lucide-react';
import { listApprovalRequests } from '@/lib/endpoints';
import {
  approvalDocumentLabel,
  approvalDocumentType,
  formatMoney,
  refLabel,
} from '@/lib/types';
import {
  APPROVAL_DOCUMENT_TYPES,
  APPROVAL_REQUEST_STATUS_LABELS,
  approvalDocumentTypeLabel,
} from '@/lib/status-maps';
import { formatRelativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBranchOptions } from '@/components/inventory/pickers';
import { approvalStatusBadge } from '@/components/approvals/badges';
import { ApprovalDetailSheet } from '@/components/approvals/approval-detail-sheet';
import { DelegationsSection } from '@/components/approvals/delegations-section';

/**
 * Approval inbox (contract §7.2). The server always scopes the queue to the
 * caller's own + assigned requests; approval.view widens it to everything in
 * branch scope. "Assigned to me" is ON by default so the inbox opens on
 * actionable work.
 */
export function ApprovalsPage({ initialRequestId }: { initialRequestId?: string }) {
  const { branches } = useBranchOptions();

  const [tab, setTab] = React.useState('inbox');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [status, setStatus] = React.useState('PENDING');
  const [documentType, setDocumentType] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [assignedToMe, setAssignedToMe] = React.useState(true);
  const [detailId, setDetailId] = React.useState<string | null>(initialRequestId ?? null);

  React.useEffect(() => {
    setPage(1);
  }, [status, documentType, branchId, assignedToMe, pageSize]);

  const params = {
    page,
    pageSize,
    status: status || undefined,
    documentType: documentType || undefined,
    branchId: branchId || undefined,
    assignedToMe: assignedToMe ? true : undefined,
    sort: 'requestedAt:desc',
  };

  const requestsQuery = useQuery({
    queryKey: ['approval-requests', 'list', params],
    queryFn: ({ signal }) => listApprovalRequests(params, signal),
    placeholderData: keepPreviousData,
  });

  const data = requestsQuery.data;
  const hasFilters = !!(status || documentType || branchId || assignedToMe);

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Requests waiting for you, everything you raised, and your delegations."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          <TabsTrigger value="delegations">Delegations</TabsTrigger>
        </TabsList>

        <TabsContent value="inbox">
          <Card>
            <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                aria-label="Filter by status"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">All statuses</option>
                {Object.entries(APPROVAL_REQUEST_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filter by document type"
                value={documentType}
                onChange={(event) => setDocumentType(event.target.value)}
              >
                <option value="">All document types</option>
                {APPROVAL_DOCUMENT_TYPES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="Filter by branch"
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
              >
                <option value="">Any branch</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={assignedToMe}
                  onChange={(event) => setAssignedToMe(event.target.checked)}
                />
                Assigned to me
              </label>
            </div>

            {requestsQuery.isPending ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : requestsQuery.isError ? (
              <div className="p-4">
                <ErrorState error={requestsQuery.error} onRetry={() => requestsQuery.refetch()} />
              </div>
            ) : data && data.data.length === 0 ? (
              <EmptyState
                icon={Inbox}
                title="Nothing to approve"
                description={
                  hasFilters
                    ? 'No requests match the current filters — try widening them.'
                    : 'Approval requests land here when documents need your sign-off.'
                }
              />
            ) : data ? (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead className="hidden sm:table-cell">Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="hidden md:table-cell">Requested by</TableHead>
                      <TableHead className="hidden lg:table-cell">Branch</TableHead>
                      <TableHead className="hidden text-right sm:table-cell">Amount</TableHead>
                      <TableHead className="hidden md:table-cell">Requested</TableHead>
                      <TableHead className="sr-only">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.data.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setDetailId(request.id)}
                            className="font-mono text-xs font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {approvalDocumentLabel(request)}
                          </button>
                        </TableCell>
                        <TableCell className="hidden max-w-[12rem] truncate text-sm text-muted-foreground sm:table-cell">
                          {approvalDocumentTypeLabel(approvalDocumentType(request))}
                        </TableCell>
                        <TableCell>{approvalStatusBadge(request.status)}</TableCell>
                        <TableCell className="hidden max-w-[10rem] truncate text-sm text-muted-foreground md:table-cell">
                          {request.requestedBy?.displayName ?? '—'}
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                          {request.branch ? refLabel(request.branch) : '—'}
                        </TableCell>
                        <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                          {request.amount !== undefined && request.amount !== null
                            ? formatMoney(request.amount)
                            : '—'}
                        </TableCell>
                        <TableCell className="hidden text-sm tabular-nums text-muted-foreground md:table-cell">
                          {formatRelativeTime(request.requestedAt ?? request.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setDetailId(request.id)}>
                            <Eye aria-hidden /> View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
              </>
            ) : null}
          </Card>
        </TabsContent>

        <TabsContent value="delegations">
          <DelegationsSection />
        </TabsContent>
      </Tabs>

      <ApprovalDetailSheet
        requestId={detailId}
        open={detailId !== null}
        onOpenChange={(open) => !open && setDetailId(null)}
      />
    </>
  );
}
