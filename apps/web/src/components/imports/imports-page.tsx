'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileUp,
  IdCard,
  ListChecks,
  Package,
  TriangleAlert,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { downloadFile, getErrorMessage, saveBlob } from '@/lib/api';
import {
  commitImport,
  importTemplatePath,
  validateImport,
  type ImportType,
} from '@/lib/endpoints';
import {
  commitCounts,
  importCounts,
  type ImportCommitResult,
  type ImportRowIssue,
  type ImportValidationResult,
} from '@/lib/types';
import { cn, humanize } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FormError } from '@/components/ui/error-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';

/* --------------------------------- Config --------------------------------- */

interface ImportTypeConfig {
  type: ImportType;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Permission that unlocks this import type. */
  permission: string;
}

const IMPORT_TYPES: ImportTypeConfig[] = [
  {
    type: 'employees',
    label: 'Employees',
    description: 'Custody records: names, branch, department, position, status.',
    icon: IdCard,
    permission: PERMISSIONS.employee.import,
  },
  {
    type: 'items',
    label: 'Items',
    description: 'Item master: SKU, classification, units, tracking flags.',
    icon: Package,
    permission: PERMISSIONS.item.import,
  },
  {
    type: 'lookups',
    label: 'Lookups',
    description: 'Lookup values: list type, code, name, description.',
    icon: ListChecks,
    permission: PERMISSIONS.lookup.manage,
  },
];

const STEPS = ['Type', 'Upload', 'Review', 'Commit'] as const;

/* -------------------------------- Stepper --------------------------------- */

function Stepper({ current }: { current: number }) {
  return (
    <ol className="mb-5 flex items-center gap-2 overflow-x-auto" aria-label="Import steps">
      {STEPS.map((label, index) => {
        const step = index + 1;
        const state = step < current ? 'done' : step === current ? 'current' : 'todo';
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-sm',
                state === 'current' && 'border-primary bg-primary/10 font-medium text-primary',
                state === 'done' && 'border-success/40 text-success',
                state === 'todo' && 'text-muted-foreground',
              )}
            >
              {state === 'done' ? (
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <span
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold',
                    state === 'current' ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}
                  aria-hidden
                >
                  {step}
                </span>
              )}
              {label}
            </span>
            {step < STEPS.length ? (
              <span className="h-px w-6 shrink-0 bg-border" aria-hidden />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------- Issue list table ---------------------------- */

const ISSUES_PAGE_SIZE = 10;

function IssuesTable({ issues, tone }: { issues: ImportRowIssue[]; tone: 'error' | 'warning' }) {
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(Math.ceil(issues.length / ISSUES_PAGE_SIZE), 1);
  const slice = issues.slice((page - 1) * ISSUES_PAGE_SIZE, page * ISSUES_PAGE_SIZE);

  React.useEffect(() => setPage(1), [issues]);

  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Row</TableHead>
            <TableHead className="w-40">Field</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {slice.map((issue, index) => (
            <TableRow key={`${issue.row}-${issue.field}-${index}`}>
              <TableCell className="font-mono text-xs">{issue.row ?? '—'}</TableCell>
              <TableCell className="font-mono text-xs">{issue.field || '—'}</TableCell>
              <TableCell className={cn('text-sm', tone === 'error' ? 'text-destructive' : 'text-warning')}>
                {issue.message}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {totalPages > 1 ? (
        <div className="flex items-center justify-between border-t px-3 py-2 text-sm text-muted-foreground">
          <span>
            Page {page} of {totalPages} · {issues.length} {tone === 'error' ? 'errors' : 'warnings'}
          </span>
          <span className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Preview table ----------------------------- */

function PreviewTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = React.useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows.slice(0, 50)) {
      for (const key of Object.keys(row)) keys.add(key);
    }
    return [...keys];
  }, [rows]);

  if (rows.length === 0 || columns.length === 0) return null;

  const visible = rows.slice(0, 20);

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="max-h-72 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column} className="whitespace-nowrap">
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row, index) => (
              <TableRow key={index}>
                {columns.map((column) => (
                  <TableCell key={column} className="whitespace-nowrap text-sm">
                    {row[column] === null || row[column] === undefined || row[column] === ''
                      ? '—'
                      : String(row[column])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length > visible.length ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Showing the first {visible.length} of {rows.length} valid rows.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------- The page -------------------------------- */

export function ImportsPage() {
  const { can, canAny } = useSession();
  const { toast } = useToast();

  const availableTypes = IMPORT_TYPES.filter((config) => can(config.permission));
  const hasAccess = canAny([PERMISSIONS.employee.import, PERMISSIONS.item.import]) || can(PERMISSIONS.lookup.manage);

  const [step, setStep] = React.useState(1);
  const [type, setType] = React.useState<ImportType | null>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [validation, setValidation] = React.useState<ImportValidationResult | null>(null);
  const [mode, setMode] = React.useState<'strict' | 'partial'>('strict');
  const [commitResult, setCommitResult] = React.useState<ImportCommitResult | null>(null);
  const [stepError, setStepError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep(1);
    setType(null);
    setFile(null);
    setValidation(null);
    setCommitResult(null);
    setMode('strict');
    setStepError(null);
  };

  const templateMutation = useMutation({
    mutationFn: async (importType: ImportType) => {
      const { blob, filename } = await downloadFile(
        importTemplatePath(importType),
        `${importType}-import-template.csv`,
      );
      saveBlob(blob, filename);
    },
    onError: (error) => {
      toast({
        title: 'Template download failed',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
    },
  });

  const validateMutation = useMutation({
    mutationFn: ({ importType, upload }: { importType: ImportType; upload: File }) =>
      validateImport(importType, upload),
    onSuccess: (result) => {
      setValidation(result);
      const counts = importCounts(result);
      setMode(counts.invalid > 0 ? 'partial' : 'strict');
      setStep(3);
      setStepError(null);
    },
    onError: (error) => setStepError(getErrorMessage(error)),
  });

  const commitMutation = useMutation({
    mutationFn: () =>
      commitImport(type!, { stagingId: validation!.stagingId, mode }),
    onSuccess: (result) => {
      setCommitResult(result);
      setStepError(null);
      toast({ title: 'Import committed', variant: 'success' });
    },
    onError: (error) => setStepError(getErrorMessage(error)),
  });

  const acceptFile = (candidate: File | null) => {
    if (!candidate) return;
    if (!/\.(csv|xlsx)$/i.test(candidate.name)) {
      setStepError('Only CSV (.csv) and Excel (.xlsx) files are supported.');
      return;
    }
    setStepError(null);
    setFile(candidate);
  };

  if (!hasAccess) {
    return (
      <>
        <PageHeader
          title="Imports"
          description="Bulk-load employees, items, and lookup values from CSV or Excel."
        />
        <Card>
          <CardContent className="p-0 sm:p-0">
            <EmptyState
              icon={FileUp}
              title="No import permission"
              description="Ask an administrator for employee or item import access."
            />
          </CardContent>
        </Card>
      </>
    );
  }

  const counts = validation ? importCounts(validation) : null;
  const selectedConfig = IMPORT_TYPES.find((config) => config.type === type) ?? null;

  return (
    <>
      <PageHeader
        title="Imports"
        description="Staged imports from CSV or Excel (.xlsx): validate first, review row-level errors, then commit."
      />
      <Stepper current={commitResult ? 4 : step} />

      {/* ------------------------------- Step 1 ------------------------------- */}
      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>1 · Choose what to import</CardTitle>
            <CardDescription>
              Download the matching template, fill it in, then continue to upload. Templates are
              CSV; uploads may be CSV or Excel (.xlsx).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div role="radiogroup" aria-label="Import type" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {availableTypes.map((config) => {
                const selected = type === config.type;
                return (
                  <button
                    key={config.type}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setType(config.type)}
                    className={cn(
                      'flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
                    )}
                  >
                    <config.icon
                      className={cn('h-5 w-5', selected ? 'text-primary' : 'text-muted-foreground')}
                      aria-hidden
                    />
                    <span className="text-sm font-medium">{config.label}</span>
                    <span className="text-xs text-muted-foreground">{config.description}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="outline"
                disabled={!type}
                loading={templateMutation.isPending}
                onClick={() => type && templateMutation.mutate(type)}
              >
                <Download aria-hidden /> Download template
              </Button>
              <Button disabled={!type} onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------- Step 2 ------------------------------- */}
      {step === 2 && type ? (
        <Card>
          <CardHeader>
            <CardTitle>2 · Upload the {selectedConfig?.label.toLowerCase()} file</CardTitle>
            <CardDescription>
              The file is parsed and validated without writing anything.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormError message={stepError} />
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload import file"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                acceptFile(event.dataTransfer.files?.[0] ?? null);
              }}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                dragOver ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
              )}
            >
              <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="text-sm font-medium">Drag &amp; drop the file here, or click to browse</p>
              <p className="text-xs text-muted-foreground">.csv or .xlsx, up to a few thousand rows</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                aria-hidden
                tabIndex={-1}
                onChange={(event) => acceptFile(event.target.files?.[0] ?? null)}
              />
            </div>

            {file ? (
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Remove selected file"
                  onClick={() => setFile(null)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            ) : null}

            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep(1)} disabled={validateMutation.isPending}>
                Back
              </Button>
              <Button
                disabled={!file}
                loading={validateMutation.isPending}
                onClick={() => file && validateMutation.mutate({ importType: type, upload: file })}
              >
                Validate file
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------- Step 3 ------------------------------- */}
      {step === 3 && validation && counts && !commitResult ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>3 · Validation results</CardTitle>
              <CardDescription>Nothing has been written yet.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Total rows', value: counts.total, tone: 'default' as const },
                  { label: 'Valid', value: counts.valid, tone: 'success' as const },
                  { label: 'Invalid', value: counts.invalid, tone: 'destructive' as const },
                  { label: 'Warnings', value: counts.warnings, tone: 'warning' as const },
                ].map((tile) => (
                  <div key={tile.label} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{tile.label}</p>
                    <p
                      className={cn(
                        'text-xl font-semibold tabular-nums',
                        tile.tone === 'success' && tile.value > 0 && 'text-success',
                        tile.tone === 'destructive' && tile.value > 0 && 'text-destructive',
                        tile.tone === 'warning' && tile.value > 0 && 'text-warning',
                      )}
                    >
                      {tile.value}
                    </p>
                  </div>
                ))}
              </div>

              {(validation.errors ?? []).length > 0 ? (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                    <TriangleAlert className="h-4 w-4" aria-hidden /> Row errors
                  </h3>
                  <IssuesTable issues={validation.errors ?? []} tone="error" />
                </div>
              ) : null}

              {(validation.warnings ?? []).length > 0 ? (
                <div className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-warning">
                    <TriangleAlert className="h-4 w-4" aria-hidden /> Warnings
                  </h3>
                  <IssuesTable issues={validation.warnings ?? []} tone="warning" />
                </div>
              ) : null}

              {(validation.preview ?? []).length > 0 ? (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Preview of valid rows</h3>
                  <PreviewTable rows={validation.preview ?? []} />
                </div>
              ) : null}

              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  onClick={() => {
                    setValidation(null);
                    setFile(null);
                    setStep(2);
                  }}
                >
                  Back to upload
                </Button>
                <Button disabled={counts.valid === 0} onClick={() => setStep(4)}>
                  Continue to commit
                </Button>
              </div>
              {counts.valid === 0 ? (
                <p className="text-right text-xs text-muted-foreground">
                  Nothing to commit — fix the file and validate again.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* ------------------------------- Step 4 ------------------------------- */}
      {step === 4 && validation && counts && !commitResult ? (
        <Card>
          <CardHeader>
            <CardTitle>4 · Commit the import</CardTitle>
            <CardDescription>
              {counts.valid} valid {counts.valid === 1 ? 'row' : 'rows'} ready
              {counts.invalid > 0 ? `, ${counts.invalid} invalid` : ''}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormError message={stepError} />
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Commit mode</legend>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3',
                  mode === 'strict' && 'border-primary bg-primary/5',
                  counts.invalid > 0 && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="import-mode"
                  value="strict"
                  className="mt-1"
                  checked={mode === 'strict'}
                  disabled={counts.invalid > 0}
                  onChange={() => setMode('strict')}
                />
                <span>
                  <span className="block text-sm font-medium">Strict — all or nothing</span>
                  <span className="block text-xs text-muted-foreground">
                    Every row must be valid; a single failure rolls the whole import back.
                    {counts.invalid > 0 ? ' Unavailable while the file has invalid rows.' : ''}
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3',
                  mode === 'partial' && 'border-primary bg-primary/5',
                  counts.valid === 0 && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="import-mode"
                  value="partial"
                  className="mt-1"
                  checked={mode === 'partial'}
                  disabled={counts.valid === 0}
                  onChange={() => setMode('partial')}
                />
                <span>
                  <span className="block text-sm font-medium">Partial — import valid rows only</span>
                  <span className="block text-xs text-muted-foreground">
                    Valid rows are written; invalid rows are skipped and reported. Never imports broken
                    data silently.
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={() => setStep(3)} disabled={commitMutation.isPending}>
                Back
              </Button>
              <Button loading={commitMutation.isPending} onClick={() => commitMutation.mutate()}>
                <FileUp aria-hidden /> Commit import
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ------------------------------- Result ------------------------------- */}
      {commitResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden /> Import complete
            </CardTitle>
            <CardDescription>
              {selectedConfig?.label} import committed in {humanize(commitResult.mode ?? mode).toLowerCase()} mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {commitResult.status ? (
              <p className="text-sm">
                Status: <Badge variant="success">{humanize(commitResult.status)}</Badge>
              </p>
            ) : null}
            {commitCounts(commitResult).length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {commitCounts(commitResult).map((tile) => (
                  <div key={tile.label} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{tile.label}</p>
                    <p className="text-xl font-semibold tabular-nums">{tile.value}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {commitResult.resultFileUrl ? (
              <a
                href={commitResult.resultFileUrl}
                className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                download
              >
                <Download className="h-4 w-4" aria-hidden /> Download result file
              </a>
            ) : null}
            <div>
              <Button onClick={reset}>Start another import</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
