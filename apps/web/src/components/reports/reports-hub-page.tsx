'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FileChartColumn, FileDown } from 'lucide-react';
import { listReportCatalog } from '@/lib/endpoints';
import { reportCatalogKey, type ReportCatalogEntry } from '@/lib/types';
import { REPORTS_EXPORT_PERMISSIONS } from '@/lib/status-maps';
import { humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import {
  REPORT_AREAS,
  REPORT_REGISTRY,
  type ReportArea,
  type ReportDefinition,
} from '@/components/reports/report-registry';

/** Registry metadata when known; server-only reports still get a card. */
function cardFor(entry: ReportCatalogEntry): {
  key: string;
  title: string;
  description: string | null;
  area: ReportArea | 'Other';
} | null {
  const key = reportCatalogKey(entry);
  if (!key) return null;
  const known: ReportDefinition | undefined = REPORT_REGISTRY[key];
  return {
    key,
    title: known?.title ?? entry.title ?? entry.name ?? humanize(key),
    description: known?.description ?? entry.description ?? null,
    area: known?.area ?? (entry.area as ReportArea | undefined) ?? 'Other',
  };
}

export function ReportsHubPage() {
  const { canAny } = useSession();
  const canExport = canAny(REPORTS_EXPORT_PERMISSIONS);

  const catalogQuery = useQuery({
    queryKey: ['reports', 'catalog'],
    queryFn: ({ signal }) => listReportCatalog(signal),
  });

  const cards = (catalogQuery.data ?? [])
    .map(cardFor)
    .filter((card): card is NonNullable<ReturnType<typeof cardFor>> => card !== null);

  const groups = [...REPORT_AREAS, 'Other' as const]
    .map((area) => ({
      area,
      reports: cards.filter((card) => card.area === area),
    }))
    .filter((group) => group.reports.length > 0);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Operational reports across assets, inventory, procurement, and maintenance."
        actions={
          canExport ? (
            <Link href="/reports/exports" className={buttonVariants({ variant: 'outline' })}>
              <FileDown aria-hidden /> Export center
            </Link>
          ) : undefined
        }
      />

      {catalogQuery.isPending ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : catalogQuery.isError ? (
        <ErrorState error={catalogQuery.error} onRetry={() => catalogQuery.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={FileChartColumn}
          title="No reports available"
          description="Your account has no runnable reports. Ask an administrator for report access."
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.area}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.area}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {group.reports.map((report) => (
                  <Link
                    key={report.key}
                    href={`/reports/${report.key}`}
                    className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Card className="h-full transition-colors hover:border-primary/40">
                      <CardContent className="flex h-full items-start gap-3 p-4">
                        <div className="rounded-md bg-primary/10 p-2">
                          <FileChartColumn className="h-4 w-4 text-primary" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{report.title}</p>
                          {report.description ? (
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                              {report.description}
                            </p>
                          ) : null}
                        </div>
                        <ChevronRight
                          className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
