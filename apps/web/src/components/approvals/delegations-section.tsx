'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Plus, UserRoundCheck } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import {
  createApprovalDelegation,
  deleteApprovalDelegation,
  listApprovalDelegations,
  unwrapList,
} from '@/lib/endpoints';
import { delegationIsCurrent, type ApprovalDelegation } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { UserPicker } from '@/components/approvals/user-picker';

/** Local datetime-input value -> ISO string (server stores UTC). */
function toIso(value: string): string {
  return new Date(value).toISOString();
}

function CreateDelegationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [delegateUserId, setDelegateUserId] = React.useState<string | null>(null);
  const [startsAt, setStartsAt] = React.useState('');
  const [endsAt, setEndsAt] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setDelegateUserId(null);
      setStartsAt('');
      setEndsAt('');
      setReason('');
      setError(null);
    }
  }, [open]);

  const createMutation = useMutation({
    mutationFn: () =>
      createApprovalDelegation({
        delegateUserId: delegateUserId!,
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Delegation created', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['approval-delegations'] });
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!delegateUserId) return setError('Pick the user who will act for you.');
    if (!startsAt || !endsAt) return setError('Both start and end are required.');
    if (new Date(endsAt) <= new Date(startsAt)) return setError('End must be after start.');
    setError(null);
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !createMutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Delegate my approvals</DialogTitle>
      </DialogHeader>
      <form className="contents" onSubmit={handleSubmit}>
        <DialogBody className="space-y-3">
          <p className="text-sm text-muted-foreground">
            During the window below, the delegate can act on approval requests assigned to you. Every
            delegated action is recorded against both names.
          </p>
          <FormField label="Delegate" htmlFor="delegation-user" required>
            <UserPicker
              id="delegation-user"
              value={delegateUserId}
              onSelect={(user) => setDelegateUserId(user?.id ?? null)}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Starts" htmlFor="delegation-starts" required>
              <Input
                id="delegation-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </FormField>
            <FormField label="Ends" htmlFor="delegation-ends" required>
              <Input
                id="delegation-ends"
                type="datetime-local"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Reason" htmlFor="delegation-reason" hint="Optional — e.g. annual leave.">
            <Input
              id="delegation-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Annual leave"
            />
          </FormField>
          <FormError message={error} />
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" loading={createMutation.isPending}>
            <UserRoundCheck aria-hidden /> Create delegation
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * Self-service delegation manager (contract §7.2): list own delegations,
 * create one with a delegate + time window, revoke.
 */
export function DelegationsSection() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState<ApprovalDelegation | null>(null);

  const delegationsQuery = useQuery({
    queryKey: ['approval-delegations', 'list'],
    queryFn: ({ signal }) => listApprovalDelegations({ page: 1, pageSize: 100 }, signal),
  });

  const delegations = delegationsQuery.data ? unwrapList(delegationsQuery.data) : [];
  const delegatorId = (delegation: ApprovalDelegation) =>
    delegation.delegatorId ?? delegation.delegator?.id ?? null;
  const delegateId = (delegation: ApprovalDelegation) =>
    delegation.delegateId ?? delegation.delegateUserId ?? delegation.delegate?.id ?? null;
  // The server returns delegations the caller gave or received; split them.
  const received = delegations.filter(
    (delegation) => delegateId(delegation) === user.id && delegatorId(delegation) !== user.id,
  );
  const given = delegations.filter((delegation) => !received.includes(delegation));

  const renderRow = (delegation: ApprovalDelegation, direction: 'given' | 'received') => {
    const current = delegationIsCurrent(delegation);
    const counterpart =
      direction === 'given'
        ? (delegation.delegate?.displayName ?? delegation.delegateUserId ?? delegation.delegateId ?? 'Unknown user')
        : (delegation.delegator?.displayName ?? 'Unknown user');
    return (
      <li key={delegation.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">
            {direction === 'given' ? `To ${counterpart}` : `From ${counterpart}`}
          </span>
          <span className="block truncate text-xs tabular-nums text-muted-foreground">
            {formatDateTime(delegation.startsAt)} → {formatDateTime(delegation.endsAt)}
            {delegation.reason ? ` · ${delegation.reason}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {delegation.isActive === false ? (
            <Badge variant="muted">Revoked</Badge>
          ) : current ? (
            <Badge variant="success">Active now</Badge>
          ) : (
            <Badge variant="outline">Scheduled</Badge>
          )}
          {direction === 'given' && delegation.isActive !== false ? (
            <Button variant="outline" size="sm" onClick={() => setRevokeTarget(delegation)}>
              Revoke
            </Button>
          ) : null}
        </span>
      </li>
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle>My delegations</CardTitle>
          <CardDescription>
            Hand your approval authority to a colleague for a date range (leave, travel, …).
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus aria-hidden /> New delegation
        </Button>
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {delegationsQuery.isPending ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : delegationsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={delegationsQuery.error} onRetry={() => delegationsQuery.refetch()} />
          </div>
        ) : given.length === 0 && received.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No delegations"
            description="Approvals assigned to you always wait for you unless you delegate them."
          />
        ) : (
          <>
            {given.length > 0 ? <ul className="divide-y">{given.map((row) => renderRow(row, 'given'))}</ul> : null}
            {received.length > 0 ? (
              <>
                <p className="border-t px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-5">
                  Delegated to me
                </p>
                <ul className="divide-y">{received.map((row) => renderRow(row, 'received'))}</ul>
              </>
            ) : null}
          </>
        )}
      </CardContent>

      <CreateDelegationDialog open={createOpen} onOpenChange={setCreateOpen} />

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
        title="Revoke this delegation?"
        description="The delegate immediately loses the ability to act on your behalf."
        confirmLabel="Revoke"
        destructive
        onConfirm={async () => {
          if (!revokeTarget) return;
          await deleteApprovalDelegation(revokeTarget.id);
          toast({ title: 'Delegation revoked', variant: 'success' });
          queryClient.invalidateQueries({ queryKey: ['approval-delegations'] });
        }}
      />
    </Card>
  );
}
