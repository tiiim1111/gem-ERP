'use client';

import * as React from 'react';
import Link from 'next/link';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download, FileDown } from 'lucide-react';
import type { Paginated } from '@gemerp/shared';
import { downloadFile, getErrorMessage, saveBlob } from '@/lib/api';
import { exportDownloadPath, listExports, unwrapList } from '@/lib/endpoints';
import {
  exportJobCompletedAt,
  exportJobError,
  exportJobFileName,
  exportJobReportKey,
  exportJobRequestedAt,
  type ExportJob,
} from '@/lib/types';
import { exportJobIsActive, exportJobStatusKind } from '@/lib/status-maps';
import { formatDateTime, formatRelativeTime, humanize } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PaginationControls } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { exportJobStatusBadge } from '@/components/reports/badges';
import { REPORT_REGISTRY } from '@/components/reports/report-registry';

/** Report display name — registry title when the key is known. */
function jobReportTitle(job: ExportJob): string {
  const key = exportJobReportKey(job);
  if (!key) return 'Export';
  return REPORT_REGISTRY[key]?.title ?? humanize(key);
}

export function ExportCenterPage() {
  const { toast } = useToast();
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);

  const exportsQuery = useQuery({
    queryKey: ['exports', 'list', { page, pageSize }],
    queryFn: ({ signal }) => listExports({ page, pageSize }, signal),
    placeholderData: keepPreviousData,
    // Poll while any listed job is still queued/processing.
    refetchInterval: (query) => {
      const payload = query.state.data;
      if (!payload) return false;
      const jobs = unwrapList(payload);
      return jobs.some((job) => exportJobIsActive(job.status)) ? 4000 : false;
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (job: ExportJob) => {
      const { blob, filename } = await downloadFile(
        exportDownloadPath(job.id),
        exportJobFileName(job),
      );
      return { blob, filename };
    },
    onSuccess: ({ blob, filename }) => {
      saveBlob(blob, filename);
    },
    onError: (error) => {
      toast({
        title: 'Download failed',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const payload = exportsQuery.data;
  const jobs = payload ? unwrapList(payload) : [];
  const meta = payload && !Array.isArray(payload) ? (payload as Paginated<ExportJob>).meta : null;

  return (
    <>
      <PageHeader
        title="Export center"
        description="Your queued and finished report exports. Files download only for the requester."
        actions={
          <Link href="/reports" className={buttonVariants({ variant: 'ghost' })}>
            <ArrowLeft aria-hidden /> All reports
          </Link>
        }
      />

      <Card>
        {exportsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : exportsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={exportsQuery.error} onRetry={() => exportsQuery.refetch()} />
          </div>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={FileDown}
            title="No exports yet"
            description="Queue one from any report page — CSV, XLSX, or PDF."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead className="hidden sm:table-cell">Format</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Requested</TableHead>
                  <TableHead className="hidden lg:table-cell">Finished</TableHead>
                  <TableHead className="w-32 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const kind = exportJobStatusKind(job.status);
                  const error = exportJobError(job);
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {jobReportTitle(job)}
                          {job.truncated ? <Badge variant="warning">Truncated</Badge> : null}
                        </p>
                        {kind === 'failed' && error ? (
                          <p className="max-w-[24rem] truncate text-xs text-destructive" title={error}>
                            {error}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="font-mono text-xs uppercase">{job.format ?? '—'}</span>
                      </TableCell>
                      <TableCell>{exportJobStatusBadge(job.status)}</TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        <span title={formatDateTime(exportJobRequestedAt(job))}>
                          {formatRelativeTime(exportJobRequestedAt(job))}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                        {formatDateTime(exportJobCompletedAt(job))}
                      </TableCell>
                      <TableCell className="text-right">
                        {kind === 'ready' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            loading={
                              downloadMutation.isPending &&
                              downloadMutation.variables?.id === job.id
                            }
                            onClick={() => downloadMutation.mutate(job)}
                          >
                            <Download aria-hidden /> Download
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {meta ? (
              <PaginationControls meta={meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
