'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PackageOpen, TriangleAlert } from 'lucide-react';
import { EmployeeStatus } from '@gemerp/shared';
import { getErrorMessage } from '@/lib/api';
import { archiveEmployee, deactivateEmployee, separateEmployee } from '@/lib/endpoints';
import {
  employeeName,
  outstandingAssetLabel,
  separationOutstandingAssets,
  type Employee,
  type EmployeeSeparationResult,
} from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';

/* --------------------------- Deactivate dialog --------------------------- */

export function EmployeeDeactivateDialog({
  open,
  onOpenChange,
  employee,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = React.useState<string>(EmployeeStatus.INACTIVE);
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setStatus(EmployeeStatus.INACTIVE);
      setReason('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      deactivateEmployee(employee!.id, {
        status: status as EmployeeStatus,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      toast({
        title: status === EmployeeStatus.SUSPENDED ? 'Employee suspended' : 'Employee deactivated',
        description: employee ? employeeName(employee) : undefined,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const pending = mutation.isPending;
  const reasonMissing = reason.trim().length === 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Deactivate employee</DialogTitle>
        <DialogDescription>
          {employee ? employeeName(employee) : ''} will be unavailable for new custody or issuance.
          History is preserved.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />
        <FormField label="New status" htmlFor="emp-deact-status" required>
          <Select
            id="emp-deact-status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value={EmployeeStatus.INACTIVE}>Inactive</option>
            <option value={EmployeeStatus.SUSPENDED}>Suspended</option>
          </Select>
        </FormField>
        <FormField
          label="Reason"
          htmlFor="emp-deact-reason"
          required
          hint="Recorded in the audit trail."
        >
          <Textarea
            id="emp-deact-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            data-autofocus
          />
        </FormField>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => mutation.mutate()}
          loading={pending}
          disabled={reasonMissing}
        >
          {status === EmployeeStatus.SUSPENDED ? 'Suspend' : 'Deactivate'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ---------------------------- Separation dialog --------------------------- */

/**
 * Two-phase separation flow: submit the separation date, then review the
 * outstanding assigned assets returned by the API. Archive is offered only
 * when custody is clean — assets are never auto-returned.
 */
export function EmployeeSeparationDialog({
  open,
  onOpenChange,
  employee,
  canArchive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
  canArchive: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [separationDate, setSeparationDate] = React.useState('');
  const [result, setResult] = React.useState<EmployeeSeparationResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setSeparationDate(new Date().toISOString().slice(0, 10));
      setResult(null);
      setError(null);
    }
  }, [open]);

  const separateMutation = useMutation({
    mutationFn: () => separateEmployee(employee!.id, { separationDate }),
    onSuccess: (response) => {
      setResult(response);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      toast({
        title: 'Separation recorded',
        description: employee ? employeeName(employee) : undefined,
        variant: 'success',
      });
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveEmployee(employee!.id),
    onSuccess: () => {
      toast({
        title: 'Employee archived',
        description: employee ? employeeName(employee) : undefined,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const pending = separateMutation.isPending || archiveMutation.isPending;
  const outstanding = result ? separationOutstandingAssets(result) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Separate employee</DialogTitle>
        <DialogDescription>
          {employee ? employeeName(employee) : ''} — records the separation and checks outstanding
          custody. Assets are never returned automatically.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <FormError message={error} />

        {result === null ? (
          <FormField label="Separation date" htmlFor="emp-sep-date" required>
            <Input
              id="emp-sep-date"
              type="date"
              value={separationDate}
              onChange={(event) => setSeparationDate(event.target.value)}
              data-autofocus
            />
          </FormField>
        ) : outstanding.length > 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium text-warning">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              {outstanding.length} outstanding {outstanding.length === 1 ? 'asset' : 'assets'} still
              assigned
            </p>
            <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
              {outstanding.map((asset) => (
                <li key={asset.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {outstandingAssetLabel(asset)}
                    </span>
                    {asset.item?.name && asset.item.name !== outstandingAssetLabel(asset) ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {asset.item.name}
                      </span>
                    ) : null}
                  </span>
                  {asset.status ? <Badge variant="warning">{asset.status}</Badge> : null}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Return each asset before archiving this employee. Archival stays blocked while custody
              is outstanding.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-md border border-success/30 bg-success/5 px-4 py-6 text-center">
            <PackageOpen className="h-6 w-6 text-success" aria-hidden />
            <p className="text-sm font-medium text-success">No outstanding assets</p>
            <p className="text-sm text-muted-foreground">
              Custody is clean. {canArchive ? 'You can archive this employee now.' : 'An authorized user can archive this employee.'}
            </p>
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          {result === null ? 'Cancel' : 'Close'}
        </Button>
        {result === null ? (
          <Button
            variant="destructive"
            onClick={() => separateMutation.mutate()}
            loading={separateMutation.isPending}
            disabled={!separationDate}
          >
            Record separation
          </Button>
        ) : outstanding.length === 0 && canArchive ? (
          <Button onClick={() => archiveMutation.mutate()} loading={archiveMutation.isPending}>
            Archive employee
          </Button>
        ) : null}
      </DialogFooter>
    </Dialog>
  );
}

/* ----------------------------- Archive dialog ----------------------------- */

export function EmployeeArchiveDialog({
  open,
  onOpenChange,
  employee,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: Employee | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => archiveEmployee(employee!.id),
    onSuccess: () => {
      toast({
        title: 'Employee archived',
        description: employee ? employeeName(employee) : undefined,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Archive employee</DialogTitle>
        <DialogDescription>
          {employee ? employeeName(employee) : ''} will be hidden from day-to-day lists. History and
          custody records are preserved. Archival fails while assets are still assigned.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <FormError message={error} />
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          data-autofocus
        >
          Archive
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
