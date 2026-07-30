'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  activateAsset,
  assignAsset,
  disposeAsset,
  inspectAsset,
  recoverAsset,
  releaseAsset,
  reportAssetDamage,
  reportAssetLoss,
  reserveAsset,
  retireAsset,
  returnAsset,
  reverseAssetDisposal,
  sendAssetToInspection,
  sendAssetToMaintenance,
  transferAssetAction,
} from '@/lib/endpoints';
import { useIdempotencyKey } from '@/lib/idempotency';
import { assetTag, type Asset } from '@/lib/types';
import { ASSET_ACTION_LABELS, type AssetAction } from '@/lib/status-maps';
import { Button } from '@/components/ui/button';
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
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { LocationSelect, LookupSelect, WarehouseSelect } from '@/components/inventory/pickers';

export interface AssetActionDialogsProps {
  asset: Asset;
  /** The action whose dialog is open (null = all closed). */
  action: AssetAction | null;
  onClose: () => void;
}

/**
 * Every asset lifecycle dialog in one place. Confirmations for simple
 * transitions, reason capture wherever spec §25 demands it, condition capture
 * on assign/return/inspect, and Idempotency-Keys on custody-changing calls.
 */
export function AssetActionDialogs({ asset, action, onClose }: AssetActionDialogsProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Stable while a dialog is open; a new dialog (action change) gets a new key.
  const idempotency = useIdempotencyKey(`${asset.id}:${action ?? 'none'}`);

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['employees'] });
  }, [queryClient]);

  const succeed = React.useCallback(
    (title: string) => {
      idempotency.rotate();
      toast({ title, description: assetTag(asset), variant: 'success' });
      invalidate();
      onClose();
    },
    [idempotency, toast, asset, invalidate, onClose],
  );

  const closeIf = (target: AssetAction) => (open: boolean) => {
    if (!open && action === target) onClose();
  };

  return (
    <>
      {/* Simple confirmations */}
      <ConfirmDialog
        open={action === 'activate'}
        onOpenChange={closeIf('activate')}
        title="Activate asset"
        description="Marks this draft as Available for assignment and transfer. Make sure the label is printed and applied."
        confirmLabel="Activate"
        onConfirm={async () => {
          await activateAsset(asset.id);
          succeed('Asset activated');
        }}
      />
      <ConfirmDialog
        open={action === 'reserve'}
        onOpenChange={closeIf('reserve')}
        title="Reserve asset"
        description="Holds this asset for a planned issue or transfer. Reserved assets cannot be assigned elsewhere."
        confirmLabel="Reserve"
        onConfirm={async () => {
          await reserveAsset(asset.id);
          succeed('Asset reserved');
        }}
      />
      <ConfirmDialog
        open={action === 'release'}
        onOpenChange={closeIf('release')}
        title="Release reservation"
        description="Returns this asset to Available."
        confirmLabel="Release"
        onConfirm={async () => {
          await releaseAsset(asset.id);
          succeed('Reservation released');
        }}
      />

      {/* Assign / reassign */}
      <AssignDialog
        open={action === 'assign' || action === 'reassign'}
        reassign={action === 'reassign'}
        asset={asset}
        idempotencyKey={idempotency.key}
        onOpenChange={(open) => !open && onClose()}
        onSuccess={() => succeed(action === 'reassign' ? 'Asset reassigned' : 'Asset assigned')}
      />

      {/* Return */}
      <ReturnDialog
        open={action === 'return'}
        asset={asset}
        idempotencyKey={idempotency.key}
        onOpenChange={closeIf('return')}
        onSuccess={() => succeed('Asset returned')}
      />

      {/* Inspection */}
      <NotesDialog
        open={action === 'send-to-inspection'}
        title="Send to inspection"
        description="Moves the asset to Under Inspection for a condition check."
        confirmLabel="Send to inspection"
        onOpenChange={closeIf('send-to-inspection')}
        onConfirm={async (notes) => {
          await sendAssetToInspection(asset.id, notes || undefined);
          succeed('Asset sent to inspection');
        }}
      />
      <InspectDialog
        open={action === 'inspection-pass' || action === 'inspection-fail'}
        onOpenChange={(open) => !open && onClose()}
        onConfirm={async (body) => {
          await inspectAsset(asset.id, body);
          succeed('Inspection recorded');
        }}
      />
      <NotesDialog
        open={action === 'send-to-maintenance'}
        title="Send to maintenance"
        description="Flags the asset as Under Maintenance. It cannot be assigned or transferred until maintenance completes."
        confirmLabel="Send to maintenance"
        onOpenChange={closeIf('send-to-maintenance')}
        onConfirm={async (notes) => {
          await sendAssetToMaintenance(asset.id, notes || undefined);
          succeed('Asset sent to maintenance');
        }}
      />

      {/* Incidents */}
      <IncidentDialog
        open={action === 'report-damage'}
        kind="damage"
        onOpenChange={closeIf('report-damage')}
        onConfirm={async (description, conditionId) => {
          await reportAssetDamage(asset.id, {
            description,
            ...(conditionId ? { conditionId } : {}),
          });
          succeed('Damage reported');
        }}
      />
      <IncidentDialog
        open={action === 'report-loss'}
        kind="loss"
        onOpenChange={closeIf('report-loss')}
        onConfirm={async (description) => {
          await reportAssetLoss(asset.id, { description });
          succeed('Loss reported');
        }}
      />

      {/* Reason-gated lifecycle events */}
      <ReasonDialog
        open={action === 'recover'}
        onOpenChange={closeIf('recover')}
        title="Recover lost asset"
        description="Authorized recovery moves the asset to Under Inspection — it can never return directly to Available."
        confirmLabel="Recover"
        onConfirm={async (reason) => {
          await recoverAsset(asset.id, { reason });
          succeed('Asset recovered');
        }}
      />
      <ReasonDialog
        open={action === 'retire' || action === 'write-off'}
        onOpenChange={(open) => !open && onClose()}
        title={action === 'write-off' ? 'Write off asset' : 'Retire asset'}
        description={
          action === 'write-off'
            ? 'Writes off a lost asset into Retired. The loss stays on record.'
            : 'Takes the asset out of service. Retired assets can only be disposed or reinstated by an authorized flow.'
        }
        confirmLabel={action === 'write-off' ? 'Write off' : 'Retire'}
        destructive
        onConfirm={async (reason) => {
          await retireAsset(asset.id, { reason });
          succeed(action === 'write-off' ? 'Asset written off' : 'Asset retired');
        }}
      />
      <DisposeDialog
        open={action === 'dispose'}
        idempotencyKey={idempotency.key}
        assetId={asset.id}
        onOpenChange={closeIf('dispose')}
        onSuccess={() => succeed('Asset disposed')}
      />
      <ReasonDialog
        open={action === 'reverse-disposal'}
        onOpenChange={closeIf('reverse-disposal')}
        title="Reverse disposal"
        description="Authorized reversal returns the asset to Retired. The original disposal record is retained."
        confirmLabel="Reverse disposal"
        destructive
        onConfirm={async (reason) => {
          await reverseAssetDisposal(asset.id, { reason }, idempotency.key);
          succeed('Disposal reversed');
        }}
      />
    </>
  );
}

/* ------------------------------ Assign dialog ----------------------------- */

function AssignDialog({
  open,
  reassign,
  asset,
  idempotencyKey,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  reassign: boolean;
  asset: Asset;
  idempotencyKey: string;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [employeeId, setEmployeeId] = React.useState<string | null>(null);
  const [conditionId, setConditionId] = React.useState('');
  const [expectedReturnDate, setExpectedReturnDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setEmployeeId(null);
      setConditionId('');
      setExpectedReturnDate('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (reassign) {
        return transferAssetAction(
          asset.id,
          {
            employeeId: employeeId!,
            conditionId: conditionId || undefined,
            expectedReturnDate: expectedReturnDate || undefined,
            notes: notes || undefined,
          },
          idempotencyKey,
        );
      }
      return assignAsset(
        asset.id,
        {
          employeeId: employeeId!,
          conditionId,
          expectedReturnDate: expectedReturnDate || undefined,
          notes: notes || undefined,
        },
        idempotencyKey,
      );
    },
    onSuccess,
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = () => {
    setError(null);
    if (!employeeId) {
      setError('Pick the custodian employee.');
      return;
    }
    if (!reassign && !conditionId) {
      setError('Condition at issuance is required.');
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{reassign ? 'Reassign asset' : 'Assign asset'}</DialogTitle>
        <DialogDescription>
          {reassign
            ? 'Hands custody to a new employee. Condition at hand-over is recorded.'
            : 'Assigns custody to an employee and requests their acknowledgment.'}
        </DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <FormField label="Employee" htmlFor="assign-employee" required>
            <EmployeePicker id="assign-employee" value={employeeId} onChange={setEmployeeId} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label={reassign ? 'Condition at hand-over' : 'Condition at issuance'}
              htmlFor="assign-condition"
              required={!reassign}
            >
              <LookupSelect
                id="assign-condition"
                type="asset-conditions"
                value={conditionId}
                onChange={setConditionId}
                placeholder="Select condition…"
              />
            </FormField>
            <FormField label="Expected return date" htmlFor="assign-return">
              <Input
                id="assign-return"
                type="date"
                value={expectedReturnDate}
                onChange={(event) => setExpectedReturnDate(event.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Notes" htmlFor="assign-notes">
            <Textarea
              id="assign-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            {reassign ? 'Reassign' : 'Assign'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ------------------------------ Return dialog ----------------------------- */

function ReturnDialog({
  open,
  asset,
  idempotencyKey,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  asset: Asset;
  idempotencyKey: string;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [conditionId, setConditionId] = React.useState('');
  const [damaged, setDamaged] = React.useState(false);
  const [warehouseId, setWarehouseId] = React.useState('');
  const [locationId, setLocationId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setConditionId('');
      setDamaged(false);
      setWarehouseId('');
      setLocationId('');
      setNotes('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      returnAsset(
        asset.id,
        {
          conditionId,
          damaged: damaged || undefined,
          warehouseId: warehouseId || undefined,
          locationId: locationId || undefined,
          notes: notes || undefined,
        },
        idempotencyKey,
      ),
    onSuccess,
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = () => {
    setError(null);
    if (!conditionId) {
      setError('Condition at return is required.');
      return;
    }
    if (damaged && !notes.trim()) {
      setError('Notes are required for a damaged return.');
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Return asset</DialogTitle>
        <DialogDescription>
          Closes the custody record. A damaged return routes the asset to Damaged instead of
          Available.
        </DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <FormField label="Condition at return" htmlFor="return-condition" required>
            <LookupSelect
              id="return-condition"
              type="asset-conditions"
              value={conditionId}
              onChange={setConditionId}
              placeholder="Select condition…"
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={damaged} onChange={(event) => setDamaged(event.target.checked)} />
            Returned damaged (raises a damage record)
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Return warehouse" htmlFor="return-warehouse">
              <WarehouseSelect
                id="return-warehouse"
                branchId={asset.branchId ?? asset.branch?.id ?? ''}
                value={warehouseId}
                onChange={(next) => {
                  setWarehouseId(next);
                  setLocationId('');
                }}
              />
            </FormField>
            <FormField label="Return location" htmlFor="return-location">
              <LocationSelect
                id="return-location"
                warehouseId={warehouseId}
                value={locationId}
                onChange={setLocationId}
              />
            </FormField>
          </div>
          <FormField label="Notes" htmlFor="return-notes" required={damaged}>
            <Textarea
              id="return-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Return
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ------------------------------ Inspect dialog ---------------------------- */

function InspectDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (body: {
    outcome: 'PASS' | 'FAIL';
    conditionId: string;
    notes?: string;
    maintenanceRequired?: boolean;
  }) => Promise<void>;
}) {
  const [outcome, setOutcome] = React.useState<'PASS' | 'FAIL'>('PASS');
  const [conditionId, setConditionId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [maintenanceRequired, setMaintenanceRequired] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setOutcome('PASS');
      setConditionId('');
      setNotes('');
      setMaintenanceRequired(false);
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    if (!conditionId) {
      setError('Condition is required.');
      return;
    }
    if (outcome === 'FAIL' && !notes.trim()) {
      setError('Findings are required when the inspection fails.');
      return;
    }
    setPending(true);
    try {
      await onConfirm({
        outcome,
        conditionId,
        notes: notes.trim() || undefined,
        maintenanceRequired: maintenanceRequired || undefined,
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Record inspection</DialogTitle>
        <DialogDescription>
          Pass returns the asset to Available; fail routes it to Damaged with findings.
        </DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Outcome" htmlFor="inspect-outcome" required>
              <Select
                id="inspect-outcome"
                value={outcome}
                onChange={(event) => setOutcome(event.target.value as 'PASS' | 'FAIL')}
              >
                <option value="PASS">Pass</option>
                <option value="FAIL">Fail</option>
              </Select>
            </FormField>
            <FormField label="Condition" htmlFor="inspect-condition" required>
              <LookupSelect
                id="inspect-condition"
                type="asset-conditions"
                value={conditionId}
                onChange={setConditionId}
                placeholder="Select condition…"
              />
            </FormField>
          </div>
          <FormField label="Findings / notes" htmlFor="inspect-notes" required={outcome === 'FAIL'}>
            <Textarea
              id="inspect-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </FormField>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={maintenanceRequired}
              onChange={(event) => setMaintenanceRequired(event.target.checked)}
            />
            Flag maintenance required
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} variant={outcome === 'FAIL' ? 'destructive' : 'default'}>
            Record {outcome === 'FAIL' ? 'failure' : 'pass'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ---------------------------- Incident dialogs ---------------------------- */

function IncidentDialog({
  open,
  kind,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  kind: 'damage' | 'loss';
  onOpenChange: (open: boolean) => void;
  onConfirm: (description: string, conditionId?: string) => Promise<void>;
}) {
  const [description, setDescription] = React.useState('');
  const [conditionId, setConditionId] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setDescription('');
      setConditionId('');
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    if (!description.trim()) {
      setError('A description of the incident is required.');
      return;
    }
    setPending(true);
    try {
      await onConfirm(description.trim(), conditionId || undefined);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{kind === 'damage' ? 'Report damage' : 'Report loss'}</DialogTitle>
        <DialogDescription>
          {kind === 'damage'
            ? 'Declares the asset Damaged. Any active assignment is closed with this record.'
            : 'Declares the asset Lost. It can only come back through the authorized recovery workflow.'}
        </DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <FormField label="What happened?" htmlFor="incident-description" required>
            <Textarea
              id="incident-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              data-autofocus
            />
          </FormField>
          {kind === 'damage' ? (
            <FormField label="Condition" htmlFor="incident-condition">
              <LookupSelect
                id="incident-condition"
                type="asset-conditions"
                value={conditionId}
                onChange={setConditionId}
                placeholder="Select condition…"
              />
            </FormField>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" loading={pending}>
            {kind === 'damage' ? 'Report damage' : 'Report loss'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ----------------------------- Dispose dialog ----------------------------- */

function DisposeDialog({
  open,
  assetId,
  idempotencyKey,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  assetId: string;
  idempotencyKey: string;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [disposalMethodId, setDisposalMethodId] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setDisposalMethodId('');
      setReason('');
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    setError(null);
    if (!disposalMethodId) {
      setError('Pick a disposal method.');
      return;
    }
    if (!reason.trim()) {
      setError('A disposal reason is required.');
      return;
    }
    setPending(true);
    try {
      await disposeAsset(assetId, { disposalMethodId, reason: reason.trim() }, idempotencyKey);
      onSuccess();
    } catch (err) {
      setError(getErrorMessage(err));
      if (isApiClientError(err) && err.code === 'IDEMPOTENCY_CONFLICT') {
        setError('This disposal was already submitted with different details. Close and reopen the dialog to retry.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Dispose asset</DialogTitle>
        <DialogDescription>
          Final lifecycle step. A posted disposal can never be deleted — only reversed by an
          authorized flow.
        </DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <DialogBody className="space-y-4">
          <FormError message={error} />
          <FormField label="Disposal method" htmlFor="dispose-method" required>
            <LookupSelect
              id="dispose-method"
              type="disposal-methods"
              value={disposalMethodId}
              onChange={setDisposalMethodId}
              placeholder="Select method…"
            />
          </FormField>
          <FormField label="Reason" htmlFor="dispose-reason" required>
            <Textarea
              id="dispose-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" loading={pending}>
            Dispose
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* --------------------------- Optional-notes dialog ------------------------- */

function NotesDialog({
  open,
  title,
  description,
  confirmLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (notes: string) => Promise<void>;
}) {
  const [notes, setNotes] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setNotes('');
      setPending(false);
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    setPending(true);
    setError(null);
    try {
      await onConfirm(notes.trim());
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <DialogBody className="space-y-3">
          <FormError message={error} />
          <FormField label="Notes (optional)" htmlFor={`${title}-notes`}>
            <Textarea
              id={`${title}-notes`}
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              data-autofocus
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/** Re-exported so the detail page can label its buttons consistently. */
export { ASSET_ACTION_LABELS };
