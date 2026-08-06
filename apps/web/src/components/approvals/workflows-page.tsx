'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitBranchPlus, Pencil, Plus, Power, PowerOff } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import {
  activateApprovalWorkflow,
  deactivateApprovalWorkflow,
  listApprovalWorkflows,
} from '@/lib/endpoints';
import { formatMoney, refLabel, workflowDocumentType, workflowStepCount, type ApprovalWorkflow } from '@/lib/types';
import { APPROVAL_DOCUMENT_TYPES, approvalDocumentTypeLabel } from '@/lib/status-maps';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { workflowActiveBadge } from '@/components/approvals/badges';

/** Workflow admin list (approval.manage) — contract §7.2. */
export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [documentType, setDocumentType] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState('');
  const [toggleTarget, setToggleTarget] = React.useState<ApprovalWorkflow | null>(null);

  React.useEffect(() => {
    setPage(1);
  }, [documentType, activeFilter, pageSize]);

  const params = {
    page,
    pageSize,
    documentType: documentType || undefined,
    isActive: activeFilter === '' ? undefined : activeFilter === 'true',
    sort: 'name:asc',
  };

  const workflowsQuery = useQuery({
    queryKey: ['approval-workflows', 'list', params],
    queryFn: ({ signal }) => listApprovalWorkflows(params, signal),
    placeholderData: keepPreviousData,
  });

  const toggleMutation = useMutation({
    mutationFn: (workflow: ApprovalWorkflow) =>
      workflow.isActive === false
        ? activateApprovalWorkflow(workflow.id)
        : deactivateApprovalWorkflow(workflow.id),
    onSuccess: (_result, workflow) => {
      toast({
        title: workflow.isActive === false ? 'Workflow activated' : 'Workflow deactivated',
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['approval-workflows'] });
    },
    onError: (err) =>
      toast({ title: 'Could not update workflow', description: getErrorMessage(err), variant: 'destructive' }),
  });

  const data = workflowsQuery.data;

  return (
    <>
      <PageHeader
        title="Approval workflows"
        description="Who signs off on what — per document type, branch scope, amount thresholds, and ordered steps."
        actions={
          <Link href="/approvals/workflows/new" className={buttonVariants({})}>
            <Plus aria-hidden /> New workflow
          </Link>
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-3">
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
            aria-label="Filter by active state"
            value={activeFilter}
            onChange={(event) => setActiveFilter(event.target.value)}
          >
            <option value="">Active + inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </Select>
        </div>

        {workflowsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : workflowsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={workflowsQuery.error} onRetry={() => workflowsQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={GitBranchPlus}
            title="No approval workflows"
            description="Without a matching workflow, documents fall back to the single-step default approval."
            action={
              <Link href="/approvals/workflows/new" className={buttonVariants({})}>
                <Plus aria-hidden /> New workflow
              </Link>
            }
          />
        ) : data ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Document type</TableHead>
                  <TableHead className="hidden md:table-cell">Branch</TableHead>
                  <TableHead className="hidden lg:table-cell">Thresholds</TableHead>
                  <TableHead className="hidden sm:table-cell">Steps</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((workflow) => {
                  return (
                    <TableRow key={workflow.id}>
                      <TableCell>
                        <Link
                          href={`/approvals/workflows/${workflow.id}/edit`}
                          className="text-sm font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {workflow.name ?? workflow.code ?? workflow.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden max-w-[14rem] truncate text-sm text-muted-foreground sm:table-cell">
                        {approvalDocumentTypeLabel(workflowDocumentType(workflow))}
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {workflow.branch ? refLabel(workflow.branch) : 'All branches'}
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums text-muted-foreground lg:table-cell">
                        {workflow.minAmount !== undefined && workflow.minAmount !== null
                          ? `from ${formatMoney(workflow.minAmount)}`
                          : ''}
                        {workflow.maxAmount !== undefined && workflow.maxAmount !== null
                          ? `${workflow.minAmount !== undefined && workflow.minAmount !== null ? ' ' : ''}up to ${formatMoney(workflow.maxAmount)}`
                          : workflow.minAmount === undefined || workflow.minAmount === null
                            ? 'Any amount'
                            : ''}
                      </TableCell>
                      <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                        {workflowStepCount(workflow)}
                      </TableCell>
                      <TableCell>{workflowActiveBadge(workflow.isActive)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Link
                            href={`/approvals/workflows/${workflow.id}/edit`}
                            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                            aria-label={`Edit ${workflow.name ?? 'workflow'}`}
                          >
                            <Pencil aria-hidden />
                          </Link>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setToggleTarget(workflow)}
                            aria-label={
                              workflow.isActive === false
                                ? `Activate ${workflow.name ?? 'workflow'}`
                                : `Deactivate ${workflow.name ?? 'workflow'}`
                            }
                          >
                            {workflow.isActive === false ? <Power aria-hidden /> : <PowerOff aria-hidden />}
                          </Button>
                        </div>
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

      <ConfirmDialog
        open={toggleTarget !== null}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.isActive === false ? 'Activate workflow?' : 'Deactivate workflow?'}
        description={
          toggleTarget?.isActive === false
            ? 'New matching documents will route through this workflow again.'
            : 'New matching documents fall back to the default approval. Requests already in flight are not affected.'
        }
        confirmLabel={toggleTarget?.isActive === false ? 'Activate' : 'Deactivate'}
        destructive={toggleTarget?.isActive !== false}
        onConfirm={async () => {
          if (toggleTarget) await toggleMutation.mutateAsync(toggleTarget);
        }}
      />
    </>
  );
}
