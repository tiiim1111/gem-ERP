'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage } from '@/lib/api';
import { createWorkOrder } from '@/lib/endpoints';
import { assetTag, workOrderNumber, type Asset } from '@/lib/types';
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
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { AssetPicker, LookupSelect } from '@/components/inventory/pickers';

/**
 * Create a work order (Draft). When `asset` is provided (from the asset page)
 * the asset picker is pre-filled and locked.
 */
export function WorkOrderCreateDialog({
  open,
  onOpenChange,
  asset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset?: Asset | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [assetId, setAssetId] = React.useState<string | null>(null);
  const [typeId, setTypeId] = React.useState('');
  const [priorityId, setPriorityId] = React.useState('');
  const [problem, setProblem] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setAssetId(asset?.id ?? null);
      setTypeId('');
      setPriorityId('');
      setProblem('');
      setError(null);
    }
  }, [open, asset]);

  const createMutation = useMutation({
    mutationFn: () =>
      createWorkOrder({
        assetId: assetId as string,
        typeId,
        priorityId: priorityId || undefined,
        problem: problem.trim(),
      }),
    onSuccess: (wo) => {
      toast({
        title: 'Work order created',
        description: `${workOrderNumber(wo)} is open — assign, schedule, and start the work.`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['maintenance-work-orders'] });
      onOpenChange(false);
      router.push(`/maintenance/work-orders/${wo.id}`);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = () => {
    setError(null);
    if (!assetId) return setError('Pick the asset needing maintenance.');
    if (!typeId) return setError('Maintenance type is required.');
    if (!problem.trim()) return setError('Describe the problem or requested work.');
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !createMutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>New work order</DialogTitle>
        <DialogDescription>
          Opens immediately — assign, schedule, and start the work from its page.
        </DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <DialogBody className="space-y-3">
          <FormError message={error} />
          <FormField label="Asset" htmlFor="wo-create-asset" required>
            <AssetPicker
              id="wo-create-asset"
              value={assetId}
              selectedLabel={asset ? assetTag(asset) : undefined}
              onSelect={(picked) => setAssetId(picked?.id ?? null)}
              disabled={!!asset}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Type" htmlFor="wo-create-type" required>
              <LookupSelect id="wo-create-type" type="maintenance-types" value={typeId} onChange={setTypeId} />
            </FormField>
            <FormField label="Priority" htmlFor="wo-create-priority">
              <LookupSelect
                id="wo-create-priority"
                type="maintenance-priorities"
                value={priorityId}
                onChange={setPriorityId}
              />
            </FormField>
          </div>
          <FormField label="Problem / requested work" htmlFor="wo-create-problem" required>
            <Textarea
              id="wo-create-problem"
              rows={3}
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              placeholder="What is wrong, or what needs to be done?"
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={createMutation.isPending}>
            Create work order
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
