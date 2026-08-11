'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  ClipboardCheck,
  EyeOff,
  ListChecks,
  MoveRight,
  Play,
  RotateCcw,
  ScanLine,
  Search,
} from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  cancelCountSession,
  completeCountSession,
  createCountAdjustments,
  fetchCountSheet,
  getCountSession,
  getCountVariance,
  recordCountLine,
  recountCountSession,
  scanCountSession,
  startCountSession,
  type CountLineRecordBody,
} from '@/lib/endpoints';
import { useIdempotencyKey } from '@/lib/idempotency';
import {
  countLineCounted,
  countLineExpected,
  countLineFound,
  countLineIsCounted,
  countLineLocation,
  countLineRecount,
  countLineTitle,
  countLineValueImpact,
  countLineVariance,
  countScopeSummary,
  countSessionAdjustments,
  countSessionIsBlind,
  countSessionLines,
  countSessionNumber,
  formatMoney,
  formatQuantity,
  normalizeVarianceRows,
  refLabel,
  type CountLine,
  type CountSession,
} from '@/lib/types';
import {
  COUNT_SESSION_STEPS,
  countSessionActionPermissions,
  countSessionActionsFor,
  stockTransactionTypeLabel,
  type CountSessionAction,
} from '@/lib/status-maps';
import { cn, formatDateTime } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { LookupSelect } from '@/components/inventory/pickers';
import { stockTransactionStatusBadge } from '@/components/inventory/badges';
import { countLineFlagBadge, countSessionStatusBadge, countTypeBadge } from '@/components/counts/badges';
import { PrintDocumentButton } from '@/components/reports/print-document-button';

/* --------------------------------- Stepper --------------------------------- */

function CountStepper({ session }: { session: CountSession }) {
  if (session.status === 'CANCELED') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {countSessionStatusBadge(session.status)}
        <span className="text-sm text-muted-foreground">
          This count was canceled{session.cancelReason ? ` — ${session.cancelReason}` : ''}. No
          adjustments were generated.
        </span>
      </div>
    );
  }
  const currentIndex = COUNT_SESSION_STEPS.findIndex((step) => step.status === session.status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Count session progress">
      {COUNT_SESSION_STEPS.map((step, index) => {
        const done = currentIndex > index;
        const active = currentIndex === index;
        return (
          <li key={step.status} className="flex items-center gap-1.5">
            <span
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                done
                  ? 'bg-success text-success-foreground'
                  : active
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
            </span>
            <span className={cn('text-xs', active ? 'font-semibold' : 'text-muted-foreground')}>
              {step.label}
            </span>
            {index < COUNT_SESSION_STEPS.length - 1 ? (
              <MoveRight className="mx-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------ Line entry dialog --------------------------- */

/**
 * Per-line count entry. Quantity lines post `{countedQty}`; asset lines post
 * `{found, condition?, locationConfirmed?}` (contract §7.1). Big touch targets
 * for warehouse-floor use.
 */
function CountLineDialog({
  sessionId,
  line,
  hideExpected,
  onClose,
}: {
  sessionId: string;
  line: CountLine | null;
  hideExpected: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isAsset = !!(line?.assetId ?? line?.asset);

  const [qty, setQty] = React.useState('');
  const [found, setFound] = React.useState<boolean | null>(null);
  const [conditionId, setConditionId] = React.useState('');
  const [locationConfirmed, setLocationConfirmed] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Reset per line.
  React.useEffect(() => {
    if (!line) return;
    const counted = countLineCounted(line);
    setQty(counted !== null ? formatQuantity(counted).replace('—', '') : '');
    setFound(countLineFound(line));
    setConditionId(line.conditionId ?? line.condition?.id ?? '');
    setLocationConfirmed(line.locationConfirmed ?? true);
    setError(null);
  }, [line]);

  const recordMutation = useMutation({
    mutationFn: (body: CountLineRecordBody) => recordCountLine(sessionId, line!.id, body),
    onSuccess: () => {
      toast({ title: 'Count recorded', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['count-sessions'] });
      onClose();
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!line) return;
    if (isAsset) {
      if (found === null) return setError('Choose whether the asset was found.');
      recordMutation.mutate({
        found,
        conditionId: conditionId || undefined,
        locationConfirmed: found ? locationConfirmed : undefined,
      });
      return;
    }
    const trimmed = qty.trim();
    if (trimmed === '' || Number.isNaN(Number(trimmed)) || Number(trimmed) < 0) {
      return setError('Enter the counted quantity (0 or more).');
    }
    recordMutation.mutate({ countedQty: trimmed });
  };

  return (
    <Dialog open={line !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle>{line ? countLineTitle(line) : ''}</DialogTitle>
        <DialogDescription>
          {line
            ? [
                countLineLocation(line) ? refLabel(countLineLocation(line)) : null,
                line.lot ? (line.lot.lotNumber ?? line.lot.number) : null,
                line.uom ? (line.uom.code ?? line.uom.name) : null,
                !hideExpected && countLineExpected(line) !== null
                  ? `Expected ${formatQuantity(countLineExpected(line))}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : ''}
        </DialogDescription>
      </DialogHeader>
      <form className="contents" onSubmit={handleSubmit}>
        <DialogBody className="space-y-3">
          {isAsset ? (
            <>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Asset found">
                {(
                  [
                    { value: true, label: 'Found', style: 'success' },
                    { value: false, label: 'Not found', style: 'destructive' },
                  ] as const
                ).map((entry) => (
                  <button
                    key={String(entry.value)}
                    type="button"
                    role="radio"
                    aria-checked={found === entry.value}
                    onClick={() => setFound(entry.value)}
                    className={cn(
                      'flex h-14 items-center justify-center rounded-lg border text-sm font-semibold transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      found === entry.value
                        ? entry.style === 'success'
                          ? 'border-success bg-success/10 text-success'
                          : 'border-destructive bg-destructive/10 text-destructive'
                        : 'hover:border-primary/40',
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              {found ? (
                <>
                  <FormField
                    label="Condition"
                    htmlFor="count-line-condition"
                    hint="Optional — confirm or update the observed condition."
                  >
                    <LookupSelect
                      id="count-line-condition"
                      type="asset-conditions"
                      value={conditionId}
                      onChange={setConditionId}
                      placeholder="Condition unchanged…"
                    />
                  </FormField>
                  <label className="flex items-start gap-2.5 rounded-md border p-3">
                    <Checkbox
                      checked={locationConfirmed}
                      onChange={(event) => setLocationConfirmed(event.target.checked)}
                    />
                    <span>
                      <span className="block text-sm font-medium">Location confirmed</span>
                      <span className="block text-xs text-muted-foreground">
                        Untick when the asset was found somewhere else — it gets a Misplaced flag.
                      </span>
                    </span>
                  </label>
                </>
              ) : null}
            </>
          ) : (
            <FormField label="Counted quantity" htmlFor="count-line-qty" required>
              <Input
                id="count-line-qty"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                placeholder="0"
                className="h-14 text-center font-mono text-2xl"
                data-autofocus
              />
            </FormField>
          )}
          <FormError message={error} />
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={recordMutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={recordMutation.isPending} className="min-w-28">
            <Check aria-hidden /> Record
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ------------------------------- Scan panel -------------------------------- */

/** Rapid-scan entry posting to :id/scans — mirrors the /scan wedge pattern. */
function CountScanPanel({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient();
  const [value, setValue] = React.useState('');
  const [qty, setQty] = React.useState('1');
  const [recent, setRecent] = React.useState<Array<{ code: string; at: number; error?: string }>>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const scanMutation = useMutation({
    mutationFn: (body: { code: string; qty?: string }) => scanCountSession(sessionId, body),
    onSuccess: (_data, body) => {
      navigator.vibrate?.(80);
      setRecent((current) => [{ code: body.code, at: Date.now() }, ...current].slice(0, 5));
      queryClient.invalidateQueries({ queryKey: ['count-sessions'] });
    },
    onError: (err, body) => {
      navigator.vibrate?.([60, 60, 60]);
      const message =
        isApiClientError(err) && err.status === 404
          ? `No count line matches “${body.code}”.`
          : getErrorMessage(err);
      setRecent((current) => [{ code: body.code, at: Date.now(), error: message }, ...current].slice(0, 5));
    },
    onSettled: () => inputRef.current?.focus(),
  });

  const submit = () => {
    const code = value.trim();
    if (!code || scanMutation.isPending) return;
    const parsedQty = qty.trim();
    scanMutation.mutate({
      code,
      qty: parsedQty && parsedQty !== '1' ? parsedQty : undefined,
    });
    setValue('');
  };

  return (
    <Card>
      <CardContent className="space-y-3 pt-4 sm:pt-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ScanLine className="h-4 w-4" aria-hidden />
          Rapid scan — point the scanner or type a code and press Enter.
        </div>
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Waiting for scan…"
            aria-label="Scanned code"
            autoComplete="off"
            className="h-14 flex-1 text-center font-mono text-lg"
          />
          <Input
            value={qty}
            onChange={(event) => setQty(event.target.value)}
            inputMode="decimal"
            aria-label="Quantity per scan"
            className="h-14 w-20 text-center font-mono text-lg"
          />
        </div>
        {recent.length > 0 ? (
          <ul className="divide-y">
            {recent.map((entry, index) => (
              <li key={`${entry.code}-${entry.at}-${index}`} className="flex items-center justify-between gap-2 py-1.5">
                <span className="truncate font-mono text-xs">{entry.code}</span>
                <span className={cn('truncate text-xs', entry.error ? 'text-destructive' : 'text-success')}>
                  {entry.error ?? 'Recorded'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------ Variance table ------------------------------ */

function VarianceTable({
  sessionId,
  fallbackLines,
  canViewCost,
}: {
  sessionId: string;
  fallbackLines: CountLine[];
  canViewCost: boolean;
}) {
  const varianceQuery = useQuery({
    queryKey: ['count-sessions', sessionId, 'variance'],
    queryFn: ({ signal }) => getCountVariance(sessionId, signal),
    retry: false,
  });

  // The report returns { session, summary, lines } with EVERY line; show only
  // the exceptions. Falls back to the already-loaded lines if the call fails.
  const serverRows = varianceQuery.data ? normalizeVarianceRows(varianceQuery.data) : [];
  const rows = (serverRows.length > 0 ? serverRows : fallbackLines).filter((line) => {
    const variance = countLineVariance(line);
    return (variance !== null && variance !== 0) || (!!line.flag && line.flag !== 'MATCHED');
  });

  if (varianceQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="No variances"
        description="Every counted line matches the snapshot so far."
      />
    );
  }

  const totalImpact = canViewCost
    ? rows.reduce<number | null>((sum, row) => {
        const impact = countLineValueImpact(row);
        if (impact === null) return sum;
        return (sum ?? 0) + impact;
      }, null)
    : null;

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Line</TableHead>
            <TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Counted</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Recount</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            {canViewCost ? <TableHead className="hidden text-right md:table-cell">Value impact</TableHead> : null}
            <TableHead>Flag</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const variance = countLineVariance(row);
            const impact = canViewCost ? countLineValueImpact(row) : null;
            return (
              <TableRow key={row.id}>
                <TableCell className="max-w-[14rem]">
                  <span className="block truncate text-sm font-medium">{countLineTitle(row)}</span>
                  {countLineLocation(row) ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {refLabel(countLineLocation(row))}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {formatQuantity(countLineExpected(row))}
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">
                  {formatQuantity(countLineCounted(row))}
                </TableCell>
                <TableCell className="hidden text-right font-mono text-xs tabular-nums sm:table-cell">
                  {formatQuantity(countLineRecount(row))}
                </TableCell>
                <TableCell
                  className={cn(
                    'text-right font-mono text-xs font-semibold tabular-nums',
                    variance !== null && variance !== 0
                      ? variance > 0
                        ? 'text-success'
                        : 'text-destructive'
                      : undefined,
                  )}
                >
                  {variance === null ? '—' : variance > 0 ? `+${formatQuantity(variance)}` : formatQuantity(variance)}
                </TableCell>
                {canViewCost ? (
                  <TableCell className="hidden text-right font-mono text-xs tabular-nums md:table-cell">
                    {impact === null ? '—' : formatMoney(impact)}
                  </TableCell>
                ) : null}
                <TableCell>{countLineFlagBadge(row.flag)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {canViewCost && totalImpact !== null ? (
        <p className="border-t px-4 py-2.5 text-right text-sm">
          <span className="text-muted-foreground">Net value impact: </span>
          <span className="font-mono font-semibold tabular-nums">{formatMoney(totalImpact)}</span>
        </p>
      ) : null}
    </>
  );
}

/* --------------------------------- Detail ---------------------------------- */

export function CountDetail({ countId }: { countId: string }) {
  const { canAny } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const sessionQuery = useQuery({
    queryKey: ['count-sessions', countId],
    queryFn: ({ signal }) => getCountSession(countId, signal),
  });

  const [tab, setTab] = React.useState('counting');
  const [lineFilter, setLineFilter] = React.useState('');
  const [uncountedOnly, setUncountedOnly] = React.useState(false);
  const [activeLine, setActiveLine] = React.useState<CountLine | null>(null);
  const [recountIds, setRecountIds] = React.useState<Set<string>>(new Set());
  const [confirmComplete, setConfirmComplete] = React.useState(false);
  const [confirmAdjustments, setConfirmAdjustments] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const adjustmentsKey = useIdempotencyKey(confirmAdjustments);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['count-sessions'] });
  }, [queryClient]);

  const startMutation = useMutation({
    mutationFn: () => startCountSession(countId),
    onSuccess: () => {
      toast({ title: 'Count started', description: 'Expected balances snapshotted; lines generated.', variant: 'success' });
      invalidate();
    },
    onError: (err) => toast({ title: 'Could not start count', description: getErrorMessage(err), variant: 'destructive' }),
  });

  const recountMutation = useMutation({
    mutationFn: (lineIds: string[]) => recountCountSession(countId, lineIds),
    onSuccess: () => {
      toast({ title: 'Lines reopened for recount', variant: 'success' });
      setRecountIds(new Set());
      invalidate();
    },
    onError: (err) => toast({ title: 'Recount failed', description: getErrorMessage(err), variant: 'destructive' }),
  });

  if (sessionQuery.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (sessionQuery.isError) {
    return <ErrorState error={sessionQuery.error} onRetry={() => sessionQuery.refetch()} />;
  }

  const session = sessionQuery.data;
  const status = session.status;
  const blind = countSessionIsBlind(session);
  // Blind sessions hide expected quantities until counting is closed.
  const hideExpected = blind && (status === 'DRAFT' || status === 'IN_PROGRESS');
  const lines = countSessionLines(session);
  const adjustments = countSessionAdjustments(session);

  const allowed = (action: CountSessionAction) =>
    countSessionActionsFor(status).includes(action) && canAny(countSessionActionPermissions(action));

  const canStart = allowed('start');
  const canRecord = allowed('record');
  const canRecount = allowed('recount');
  const canComplete = allowed('complete');
  const canCreateAdjustments = allowed('create-adjustments') && adjustments.length === 0;
  const canCancel = allowed('cancel');

  const countedCount = lines.filter(countLineIsCounted).length;
  const filterText = lineFilter.trim().toLowerCase();
  const visibleLines = lines.filter((line) => {
    if (uncountedOnly && countLineIsCounted(line)) return false;
    if (!filterText) return true;
    const haystack = [
      countLineTitle(line),
      line.item?.sku,
      line.asset?.serialNumber,
      countLineLocation(line) ? refLabel(countLineLocation(line)) : null,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(filterText);
  });

  const toggleRecount = (lineId: string, checked: boolean) => {
    setRecountIds((current) => {
      const next = new Set(current);
      if (checked) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title={`Count ${countSessionNumber(session)}`}
        description={countScopeSummary(session)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/inventory/counts" className={buttonVariants({ variant: 'outline' })}>
              <ArrowLeft aria-hidden /> All counts
            </Link>
            <PrintDocumentButton
              fetchDocument={() => fetchCountSheet(session.id)}
              fileName={`count-${countSessionNumber(session)}-sheet.pdf`}
              label="Count sheet"
            />
            {canStart ? (
              <Button onClick={() => startMutation.mutate()} loading={startMutation.isPending}>
                <Play aria-hidden /> Start counting
              </Button>
            ) : null}
            {canComplete ? (
              <Button onClick={() => setConfirmComplete(true)}>
                <CheckCircle2 aria-hidden /> Complete count
              </Button>
            ) : null}
            {canCreateAdjustments ? (
              <Button variant="outline" onClick={() => setConfirmAdjustments(true)}>
                <ListChecks aria-hidden /> Create adjustments
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <Ban aria-hidden /> Cancel
              </Button>
            ) : null}
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="space-y-3 pt-4 sm:pt-5">
          <div className="flex flex-wrap items-center gap-2">
            {countSessionStatusBadge(status)}
            {countTypeBadge(session.type)}
            {blind ? (
              <Badge variant="outline">
                <EyeOff className="mr-1 h-3 w-3" aria-hidden /> Blind
              </Badge>
            ) : null}
          </div>
          <CountStepper session={session} />
          <dl className="grid grid-cols-1 gap-x-6 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex justify-between gap-3 border-b py-1.5">
              <dt className="text-muted-foreground">Branch</dt>
              <dd>{session.branch ? refLabel(session.branch) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b py-1.5">
              <dt className="text-muted-foreground">Snapshot taken</dt>
              <dd>{session.snapshotAt ? formatDateTime(session.snapshotAt) : 'Not started'}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b py-1.5">
              <dt className="text-muted-foreground">Created by</dt>
              <dd>{session.createdBy?.displayName ?? '—'}</dd>
            </div>
          </dl>
          {session.notes ? <p className="text-sm text-muted-foreground">{session.notes}</p> : null}
        </CardContent>
      </Card>

      {status === 'DRAFT' ? (
        <EmptyState
          icon={ClipboardCheck}
          title="Count not started yet"
          description="Starting the count freezes the expected balances and generates the count lines."
          action={
            canStart ? (
              <Button onClick={() => startMutation.mutate()} loading={startMutation.isPending}>
                <Play aria-hidden /> Start counting
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="counting">Counting ({countedCount}/{lines.length})</TabsTrigger>
            {!hideExpected ? <TabsTrigger value="variance">Variance</TabsTrigger> : null}
            {adjustments.length > 0 ? (
              <TabsTrigger value="adjustments">Adjustments ({adjustments.length})</TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="counting" className="space-y-4">
            {canRecord ? <CountScanPanel sessionId={countId} /> : null}

            <Card>
              <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    value={lineFilter}
                    onChange={(event) => setLineFilter(event.target.value)}
                    placeholder="Filter lines by item, tag, or bin…"
                    aria-label="Filter count lines"
                    className="pl-8"
                  />
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <Checkbox
                    checked={uncountedOnly}
                    onChange={(event) => setUncountedOnly(event.target.checked)}
                  />
                  Uncounted only
                </label>
              </div>

              {lines.length === 0 ? (
                <EmptyState
                  icon={ClipboardCheck}
                  title="No count lines"
                  description="The snapshot produced no lines for this scope."
                />
              ) : visibleLines.length === 0 ? (
                <EmptyState icon={Search} title="No lines match your filter" />
              ) : (
                <ul className="divide-y">
                  {visibleLines.map((line) => {
                    const counted = countLineIsCounted(line);
                    const expected = countLineExpected(line);
                    const countedQty = countLineRecount(line) ?? countLineCounted(line);
                    const isAsset = !!(line.assetId ?? line.asset);
                    return (
                      <li key={line.id} className="flex items-stretch">
                        {canRecount ? (
                          <label className="flex items-center border-r px-3">
                            <Checkbox
                              checked={recountIds.has(line.id)}
                              onChange={(event) => toggleRecount(line.id, event.target.checked)}
                              aria-label={`Select ${countLineTitle(line)} for recount`}
                            />
                          </label>
                        ) : null}
                        <button
                          type="button"
                          disabled={!canRecord}
                          onClick={() => canRecord && setActiveLine(line)}
                          className={cn(
                            'flex min-h-16 flex-1 items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors sm:px-4',
                            canRecord ? 'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring' : 'cursor-default',
                          )}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{countLineTitle(line)}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {[
                                isAsset ? 'Asset' : line.item?.sku,
                                countLineLocation(line) ? refLabel(countLineLocation(line)) : null,
                                line.lot ? (line.lot.lotNumber ?? line.lot.number) : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-right">
                            {countLineFlagBadge(line.flag)}
                            {isAsset ? (
                              counted ? (
                                countLineFound(line) === false ? (
                                  <Badge variant="destructive">Not found</Badge>
                                ) : (
                                  <Badge variant="success">Found</Badge>
                                )
                              ) : (
                                <Badge variant="muted">To verify</Badge>
                              )
                            ) : (
                              <span className="font-mono text-sm tabular-nums">
                                {counted ? formatQuantity(countedQty) : '—'}
                                {!hideExpected && expected !== null ? (
                                  <span className="text-muted-foreground"> / {formatQuantity(expected)}</span>
                                ) : null}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {canRecount && recountIds.size > 0 ? (
              <div className="sticky bottom-3 z-10 flex justify-center">
                <Button
                  onClick={() => recountMutation.mutate([...recountIds])}
                  loading={recountMutation.isPending}
                  className="shadow-lg"
                >
                  <RotateCcw aria-hidden /> Recount {recountIds.size} line{recountIds.size === 1 ? '' : 's'}
                </Button>
              </div>
            ) : null}
          </TabsContent>

          {!hideExpected ? (
            <TabsContent value="variance">
              <Card>
                <VarianceTable
                  sessionId={countId}
                  fallbackLines={lines}
                  canViewCost={canAny([PERMISSIONS.inventory.viewCost])}
                />
              </Card>
            </TabsContent>
          ) : null}

          {adjustments.length > 0 ? (
            <TabsContent value="adjustments">
              <Card>
                <CardHeader>
                  <CardTitle>Generated adjustments</CardTitle>
                  <CardDescription>
                    Draft stock adjustments created from the approved variances — they post through the
                    normal inventory approval flow.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0 sm:p-0">
                  <ul className="divide-y">
                    {adjustments.map((transaction) => (
                      <li key={transaction.id}>
                        <Link
                          href={`/inventory/transactions/${transaction.id}`}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 sm:px-5"
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-xs font-medium">
                              {transaction.transactionNumber ?? transaction.number ?? transaction.id.slice(0, 8)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {transaction.type ? stockTransactionTypeLabel(transaction.type) : ''}
                            </span>
                          </span>
                          {transaction.status ? stockTransactionStatusBadge(transaction.status) : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
          ) : null}
        </Tabs>
      )}

      <CountLineDialog
        sessionId={countId}
        line={activeLine}
        hideExpected={hideExpected}
        onClose={() => setActiveLine(null)}
      />

      <ConfirmDialog
        open={confirmComplete}
        onOpenChange={setConfirmComplete}
        title="Complete this count?"
        description={
          countedCount < lines.length
            ? `${lines.length - countedCount} of ${lines.length} lines are still uncounted. Completing locks all lines${blind ? ' and reveals the expected quantities' : ''}.`
            : `All ${lines.length} lines are counted. Completing locks the lines${blind ? ' and reveals the expected quantities' : ''}.`
        }
        confirmLabel="Complete count"
        onConfirm={async () => {
          await completeCountSession(countId);
          toast({ title: 'Count completed', variant: 'success' });
          invalidate();
        }}
      />

      <ConfirmDialog
        open={confirmAdjustments}
        onOpenChange={setConfirmAdjustments}
        title="Create adjustment transactions?"
        description="Draft stock adjustments will be generated for every approved variance. They still go through the inventory approval and posting flow before stock changes."
        confirmLabel="Create adjustments"
        onConfirm={async () => {
          await createCountAdjustments(countId, adjustmentsKey.key);
          adjustmentsKey.rotate();
          toast({
            title: 'Adjustments created',
            description: 'Draft transactions are linked on the Adjustments tab.',
            variant: 'success',
          });
          invalidate();
        }}
      />

      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this count session?"
        description="The snapshot and any recorded counts are kept for audit, but no adjustments will be generated."
        confirmLabel="Cancel count"
        destructive
        onConfirm={async (reason) => {
          await cancelCountSession(countId, reason);
          toast({ title: 'Count canceled', variant: 'success' });
          invalidate();
        }}
      />
    </>
  );
}
