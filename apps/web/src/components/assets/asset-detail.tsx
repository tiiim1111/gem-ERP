'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, Pencil } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import {
  acknowledgeAsset,
  ATTACHMENT_RESOURCE_TYPES,
  fetchAssetAcknowledgmentForm,
  getAsset,
  listAssetAssignments,
  listAssetHistory,
  unwrapList,
} from '@/lib/endpoints';
import {
  assetCustodian,
  assetPermittedActions,
  assetTag,
  conditionLabel,
  daysUntil,
  employeeName,
  formatMoney,
  historyDetailName,
  historyDetailString,
  itemRefLabel,
  meEmployeeId,
  refLabel,
  type AssetHistoryEntry,
} from '@/lib/types';
import {
  ASSET_ACTION_LABELS,
  ASSET_LABEL_PERMISSIONS,
  assetActionPermissions,
  assetActionsFor,
  isKnownAssetAction,
  type AssetAction,
} from '@/lib/status-maps';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import { PERMISSIONS } from '@gemerp/shared';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { assetStatusBadge } from '@/components/inventory/badges';
import { AssetMaintenanceSection } from '@/components/maintenance/asset-maintenance-section';
import { AttachmentsPanel } from '@/components/attachments/attachments-panel';
import { PrintDocumentButton } from '@/components/reports/print-document-button';
import { AssetActionDialogs } from './asset-action-dialogs';
import { AssetEditDialog } from './asset-edit-dialog';
import { AssetLabelPanel } from './asset-label-panel';

/** Buttons that read as destructive/consequential. */
const DESTRUCTIVE_ACTIONS = new Set<AssetAction>([
  'report-damage',
  'report-loss',
  'retire',
  'write-off',
  'dispose',
]);

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b py-1.5 text-sm last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right">{value ?? '—'}</dd>
    </div>
  );
}

function HistoryList({ entries, kind }: { entries: AssetHistoryEntry[]; kind: string }) {
  const filtered = entries.filter((entry) => entry.kind === kind);
  if (filtered.length === 0) {
    return <p className="text-sm text-muted-foreground">No {kind} history yet.</p>;
  }
  return (
    <ul className="space-y-3">
      {filtered.map((entry, index) => {
        const detail = entry.detail;
        let headline: string;
        let byline: string | null;
        if (kind === 'status') {
          const from = historyDetailString(detail, 'fromStatus');
          const to = historyDetailString(detail, 'toStatus');
          headline = from ? `${humanize(from)} → ${humanize(to ?? '')}` : humanize(to ?? 'Status change');
          byline = historyDetailName(detail, 'changedBy');
        } else if (kind === 'condition') {
          headline = historyDetailName(detail, 'condition') ?? 'Condition recorded';
          byline = historyDetailName(detail, 'recordedBy');
        } else {
          const parts: string[] = [];
          const fromBranch = historyDetailName(detail, 'fromBranch');
          const toBranch = historyDetailName(detail, 'toBranch');
          const fromWarehouse = historyDetailName(detail, 'fromWarehouse');
          const toWarehouse = historyDetailName(detail, 'toWarehouse');
          const fromLocation = historyDetailName(detail, 'fromLocation');
          const toLocation = historyDetailName(detail, 'toLocation');
          const fromEmployee = historyDetailName(detail, 'fromEmployee');
          const toEmployee = historyDetailName(detail, 'toEmployee');
          if (fromBranch || toBranch) parts.push(`${fromBranch ?? '—'} → ${toBranch ?? '—'}`);
          else if (fromWarehouse || toWarehouse) parts.push(`${fromWarehouse ?? '—'} → ${toWarehouse ?? '—'}`);
          else if (fromLocation || toLocation) parts.push(`${fromLocation ?? '—'} → ${toLocation ?? '—'}`);
          if (fromEmployee || toEmployee) parts.push(`custody ${fromEmployee ?? '—'} → ${toEmployee ?? '—'}`);
          headline = parts.length > 0 ? parts.join(' · ') : 'Movement';
          byline = historyDetailName(detail, 'movedBy');
        }
        const reason = historyDetailName(detail, 'reason');
        const notes = historyDetailString(detail, 'notes');
        return (
          <li key={index} className="flex items-start gap-3">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">{headline}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(entry.at)}
                {byline ? ` · ${byline}` : ''}
              </p>
              {reason ? <p className="text-xs text-muted-foreground">Reason: {reason}</p> : null}
              {notes ? <p className="text-xs text-muted-foreground">“{notes}”</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AssetDetail({
  assetId,
  initialAction,
}: {
  assetId: string;
  /** Quick action arriving from the scan page (?action=assign|return|…). */
  initialAction?: string;
}) {
  const queryClient = useQueryClient();
  const { user, can, canAny } = useSession();
  const { toast } = useToast();
  const [openAction, setOpenAction] = React.useState<AssetAction | null>(() =>
    initialAction && isKnownAssetAction(initialAction) ? initialAction : null,
  );
  const [editOpen, setEditOpen] = React.useState(false);
  const [tab, setTab] = React.useState('assignments');

  const assetQuery = useQuery({
    queryKey: ['assets', 'detail', assetId],
    queryFn: ({ signal }) => getAsset(assetId, signal),
  });
  const asset = assetQuery.data;

  const historyQuery = useQuery({
    queryKey: ['assets', 'history', assetId],
    queryFn: ({ signal }) => listAssetHistory(assetId, signal),
    enabled: !!asset,
  });
  const assignmentsQuery = useQuery({
    queryKey: ['assets', 'assignments', assetId],
    queryFn: ({ signal }) => listAssetAssignments(assetId, signal),
    enabled: !!asset,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: () => acknowledgeAsset(assetId),
    onSuccess: () => {
      toast({ title: 'Receipt acknowledged', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (error) => {
      toast({ title: 'Could not acknowledge', description: getErrorMessage(error), variant: 'destructive' });
    },
  });

  if (assetQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (assetQuery.isError || !asset) {
    return <ErrorState error={assetQuery.error} onRetry={() => assetQuery.refetch()} />;
  }

  // Actions: server-provided permittedActions when present, else the local map.
  const serverActions = assetPermittedActions(asset);
  const candidateActions: AssetAction[] = (
    serverActions ? serverActions.filter(isKnownAssetAction) : assetActionsFor(asset.status)
  ).filter((entry, index, all) => all.indexOf(entry) === index);
  const visibleActions = candidateActions.filter(
    (entry, _index, all) =>
      canAny(assetActionPermissions(entry)) &&
      // inspection-pass and inspection-fail share one "Record inspection" dialog.
      !(entry === 'inspection-fail' && all.includes('inspection-pass')),
  );

  const custodian = assetCustodian(asset);
  const openAssignment = asset.openAssignment ?? null;
  const myEmployeeId = meEmployeeId(user);
  const canAcknowledge =
    !!openAssignment &&
    !openAssignment.acknowledgedAt &&
    !!myEmployeeId &&
    (openAssignment.employee?.id === myEmployeeId || openAssignment.employeeId === myEmployeeId);

  // Non-lifecycle field edits (PATCH) — archived/disposed records are frozen.
  const canEdit =
    can(PERMISSIONS.asset.update) && !asset.archivedAt && asset.status !== 'DISPOSED';

  const warrantyDays = daysUntil(asset.warrantyEndDate);
  const location = asset.storageLocation ?? asset.location ?? null;
  const historyEntries = historyQuery.data ? unwrapList(historyQuery.data) : [];
  const assignments = assignmentsQuery.data ? unwrapList(assignmentsQuery.data) : [];

  return (
    <>
      <PageHeader
        title={assetTag(asset)}
        description={itemRefLabel(asset.item ?? null)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/assets" className={buttonVariants({ variant: 'ghost' })}>
              <ArrowLeft aria-hidden /> All assets
            </Link>
            <PrintDocumentButton
              fetchDocument={() => fetchAssetAcknowledgmentForm(asset.id)}
              fileName={`${assetTag(asset)}-acknowledgment.pdf`}
              label="Acknowledgment form"
            />
            {canEdit ? (
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
            ) : null}
            {canAcknowledge ? (
              <Button
                variant="outline"
                onClick={() => acknowledgeMutation.mutate()}
                loading={acknowledgeMutation.isPending}
              >
                <BadgeCheck aria-hidden /> Acknowledge receipt
              </Button>
            ) : null}
            {visibleActions.map((entry) => (
              <Button
                key={entry}
                variant={DESTRUCTIVE_ACTIONS.has(entry) ? 'outline' : 'default'}
                className={
                  DESTRUCTIVE_ACTIONS.has(entry)
                    ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
                    : undefined
                }
                onClick={() => setOpenAction(entry)}
              >
                {ASSET_ACTION_LABELS[entry]}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle>Details</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {assetStatusBadge(asset.status)}
              {conditionLabel(asset.condition) ? (
                <Badge variant="outline">{conditionLabel(asset.condition)}</Badge>
              ) : null}
              {asset.maintenanceRequired ? <Badge variant="warning">Maintenance required</Badge> : null}
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <InfoRow
                label="Item"
                value={
                  asset.item?.id ? (
                    <Link href={`/items/${asset.item.id}`} className="text-primary hover:underline">
                      {itemRefLabel(asset.item)}
                    </Link>
                  ) : (
                    itemRefLabel(asset.item ?? null)
                  )
                }
              />
              <InfoRow
                label="Serial number"
                value={asset.serialNumber ? <span className="font-mono text-xs">{asset.serialNumber}</span> : '—'}
              />
              <InfoRow label="Branch" value={asset.branch ? refLabel(asset.branch) : '—'} />
              <InfoRow
                label="Warehouse / location"
                value={
                  asset.warehouse
                    ? `${refLabel(asset.warehouse)}${location ? ` · ${refLabel(location)}` : ''}`
                    : location
                      ? refLabel(location)
                      : '—'
                }
              />
              <InfoRow
                label="Custodian"
                value={custodian ? employeeName(custodian) : '—'}
              />
              <InfoRow
                label="Expected return"
                value={
                  openAssignment?.expectedReturnAt ?? openAssignment?.expectedReturnDate
                    ? formatDate(openAssignment.expectedReturnAt ?? openAssignment.expectedReturnDate)
                    : '—'
                }
              />
              <InfoRow label="Department" value={asset.department?.name ?? '—'} />
              <InfoRow
                label="Criticality"
                value={asset.criticality ? (asset.criticality.name ?? asset.criticality.code) : '—'}
              />
              <InfoRow label="Acquisition date" value={formatDate(asset.acquisitionDate)} />
              {asset.acquisitionCost !== undefined && asset.acquisitionCost !== null ? (
                <InfoRow label="Acquisition cost" value={formatMoney(asset.acquisitionCost)} />
              ) : null}
              <InfoRow
                label="Warranty"
                value={
                  asset.warrantyEndDate ? (
                    <span className="inline-flex items-center gap-2">
                      {formatDate(asset.warrantyStartDate)} – {formatDate(asset.warrantyEndDate)}
                      {warrantyDays !== null && warrantyDays < 0 ? (
                        <Badge variant="destructive">Expired</Badge>
                      ) : warrantyDays !== null && warrantyDays <= 90 ? (
                        <Badge variant="warning">{warrantyDays}d left</Badge>
                      ) : null}
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <InfoRow label="Last inspection" value={formatDate(asset.lastInspectionAt)} />
              <InfoRow label="Next maintenance" value={formatDate(asset.nextMaintenanceAt)} />
              {asset.retiredAt ? <InfoRow label="Retired" value={formatDate(asset.retiredAt)} /> : null}
              {asset.disposedAt ? (
                <InfoRow
                  label="Disposed"
                  value={`${formatDate(asset.disposedAt)}${
                    asset.disposalMethod ? ` · ${asset.disposalMethod.name ?? asset.disposalMethod.code}` : ''
                  }`}
                />
              ) : null}
              {asset.disposalNotes ? <InfoRow label="Disposal notes" value={asset.disposalNotes} /> : null}
              {asset.notes ? <InfoRow label="Notes" value={asset.notes} /> : null}
            </dl>
          </CardContent>
        </Card>

        {canAny(ASSET_LABEL_PERMISSIONS) ? <AssetLabelPanel asset={asset} /> : null}
      </div>

      <Card className="mt-4">
        <CardContent className="pt-4 sm:pt-5">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="Asset history">
              <TabsTrigger value="assignments">Assignments</TabsTrigger>
              <TabsTrigger value="movement">Movements</TabsTrigger>
              <TabsTrigger value="status">Status history</TabsTrigger>
              <TabsTrigger value="condition">Condition history</TabsTrigger>
              {can(PERMISSIONS.maintenanceWorkOrder.view) ? (
                <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
              ) : null}
              {can(PERMISSIONS.attachment.view) ? (
                <TabsTrigger value="attachments">Attachments</TabsTrigger>
              ) : null}
            </TabsList>

            <TabsContent value="assignments">
              {assignmentsQuery.isPending ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : assignmentsQuery.isError ? (
                <ErrorState error={assignmentsQuery.error} onRetry={() => assignmentsQuery.refetch()} />
              ) : assignments.length === 0 ? (
                <EmptyState title="No custody history" description="This asset has not been assigned yet." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead className="hidden sm:table-cell">Assigned</TableHead>
                      <TableHead className="hidden md:table-cell">Expected return</TableHead>
                      <TableHead className="hidden md:table-cell">Returned</TableHead>
                      <TableHead>Acknowledged</TableHead>
                      <TableHead className="hidden lg:table-cell">Condition (issue → return)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((assignment) => (
                      <TableRow key={assignment.id}>
                        <TableCell className="text-sm font-medium">
                          {assignment.employee
                            ? employeeName(assignment.employee)
                            : (assignment.department?.name ?? assignment.projectRef ?? '—')}
                        </TableCell>
                        <TableCell className="hidden text-sm tabular-nums text-muted-foreground sm:table-cell">
                          {formatDate(assignment.assignedAt)}
                        </TableCell>
                        <TableCell className="hidden text-sm tabular-nums text-muted-foreground md:table-cell">
                          {formatDate(assignment.expectedReturnAt ?? assignment.expectedReturnDate)}
                        </TableCell>
                        <TableCell className="hidden text-sm tabular-nums text-muted-foreground md:table-cell">
                          {assignment.returnedAt ? formatDate(assignment.returnedAt) : '—'}
                        </TableCell>
                        <TableCell>
                          {assignment.acknowledgedAt ? (
                            <Badge variant="success">{formatDate(assignment.acknowledgedAt)}</Badge>
                          ) : assignment.returnedAt ? (
                            <span className="text-sm text-muted-foreground">—</span>
                          ) : (
                            <Badge variant="warning">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                          {conditionLabel(assignment.conditionAtIssue) ?? '—'}
                          {' → '}
                          {conditionLabel(assignment.conditionAtReturn) ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>

            {(['movement', 'status', 'condition'] as const).map((kind) => (
              <TabsContent key={kind} value={kind}>
                {historyQuery.isPending ? (
                  <div className="space-y-2">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-9 w-full" />
                  </div>
                ) : historyQuery.isError ? (
                  <ErrorState error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
                ) : (
                  <HistoryList entries={historyEntries} kind={kind} />
                )}
              </TabsContent>
            ))}

            {can(PERMISSIONS.maintenanceWorkOrder.view) ? (
              <TabsContent value="maintenance">
                <AssetMaintenanceSection asset={asset} />
              </TabsContent>
            ) : null}

            {can(PERMISSIONS.attachment.view) ? (
              <TabsContent value="attachments">
                <AttachmentsPanel
                  resourceType={ATTACHMENT_RESOURCE_TYPES.asset}
                  resourceId={asset.id}
                  managePermissions={[PERMISSIONS.asset.update]}
                  variant="bare"
                />
              </TabsContent>
            ) : null}
          </Tabs>
        </CardContent>
      </Card>

      <AssetActionDialogs asset={asset} action={openAction} onClose={() => setOpenAction(null)} />
      <AssetEditDialog asset={asset} open={editOpen} onOpenChange={setEditOpen} />
    </>
  );
}
