'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/api';
import { listBranches, listRoles, setUserBranchAccess, setUserRoles } from '@/lib/endpoints';
import { userBranchIds, type UserRecord } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { CheckboxList } from '@/components/ui/checkbox-list';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/ui/error-state';
import { useToast } from '@/components/ui/toast';

/** Replace a user's role assignment (PUT /users/:id/roles). */
export function UserRolesDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRecord | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const rolesQuery = useQuery({
    queryKey: ['roles', 'options'],
    queryFn: ({ signal }) => listRoles({ page: 1, pageSize: 100 }, signal),
    enabled: open,
  });

  React.useEffect(() => {
    if (open && user) {
      setSelected(user.roles?.map((role) => role.id) ?? []);
      setServerError(null);
    }
  }, [open, user]);

  const mutation = useMutation({
    mutationFn: () => setUserRoles(user!.id, selected),
    onSuccess: () => {
      toast({ title: 'Roles updated', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
    },
    onError: (error) => setServerError(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Manage roles</DialogTitle>
        <DialogDescription>
          Replace the role assignment for <span className="font-medium text-foreground">{user?.displayName}</span>.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <FormError message={serverError} />
        {rolesQuery.isError ? (
          <FormError message={getErrorMessage(rolesQuery.error, 'Failed to load roles.')} />
        ) : (
          <CheckboxList
            aria-label="Roles"
            items={(rolesQuery.data?.data ?? []).map((role) => ({
              id: role.id,
              label: role.name,
              description: role.description ?? role.code,
            }))}
            selectedIds={selected}
            onChange={setSelected}
            emptyLabel={rolesQuery.isPending ? 'Loading roles…' : 'No roles found.'}
          />
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!user}>
          Save roles
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/** Replace a user's branch access (PUT /users/:id/branch-access). */
export function UserBranchAccessDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserRecord | null;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const branchesQuery = useQuery({
    queryKey: ['branches', 'options'],
    queryFn: ({ signal }) => listBranches({ page: 1, pageSize: 100 }, signal),
    enabled: open,
  });

  React.useEffect(() => {
    if (open && user) {
      setSelected(userBranchIds(user));
      setServerError(null);
    }
  }, [open, user]);

  const mutation = useMutation({
    mutationFn: () => setUserBranchAccess(user!.id, selected),
    onSuccess: () => {
      toast({ title: 'Branch access updated', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onOpenChange(false);
    },
    onError: (error) => setServerError(getErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Branch access</DialogTitle>
        <DialogDescription>
          Choose which branches <span className="font-medium text-foreground">{user?.displayName}</span> may
          access. Permission checks and branch scope are both enforced by the server.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <FormError message={serverError} />
        {branchesQuery.isError ? (
          <FormError message={getErrorMessage(branchesQuery.error, 'Failed to load branches.')} />
        ) : (
          <CheckboxList
            aria-label="Branches"
            items={(branchesQuery.data?.data ?? []).map((branch) => ({
              id: branch.id,
              label: branch.name,
              description: branch.code,
            }))}
            selectedIds={selected}
            onChange={setSelected}
            emptyLabel={branchesQuery.isPending ? 'Loading branches…' : 'No branches found.'}
          />
        )}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!user}>
          Save access
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
