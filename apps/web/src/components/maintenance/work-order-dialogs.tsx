'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { AssetStatus } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  assignWorkOrder,
  completeWorkOrder,
  createWorkOrderPartsIssue,
  holdWorkOrder,
  scheduleWorkOrder,
  type WorkOrderHoldReason,
  type WorkOrderPartsIssueLineInput,
} from '@/lib/endpoints';
import {
  stockTransactionNumber,
  supplierRefLabel,
  woPlannedEnd,
  woPlannedStart,
  workOrderNumber,
  type Item,
  type WorkOrder,
} from '@/lib/types';
import {
  MAINTENANCE_COST_PERMISSIONS,
  WORK_ORDER_COMPLETION_OUTCOMES,
  WORK_ORDER_HOLD_REASONS,
} from '@/lib/status-maps';
import { itemUomChoices, useUomData } from '@/lib/uom';
import { useSession } from '@/components/auth/session-provider';
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
import { WarehouseSelect, ItemPicker, LookupSelect, useLotOptions, lotOptionLabel } from '@/components/inventory/pickers';
import { UserPicker } from '@/components/employees/employee-picker';
import { SupplierPicker } from '@/components/procurement/supplier-picker';

interface WoDialogProps {
  wo: WorkOrder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** WO actions can move the asset lifecycle too — refresh both cache families. */
function useWoInvalidate() {
  const queryClient = useQueryClient();
  return React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['maintenance-work-orders'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  }, [queryClient]);
}

/* --------------------------------- Assign --------------------------------- */

export function AssignWorkOrderDialog({ wo, open, onOpenChange }: WoDialogProps) {
  const { toast } = useToast();
  const invalidate = useWoInvalidate();
  const [technicianUserId, setTechnicianUserId] = React.useState<string | null>(null);
  const [team, setTeam] = React.useState('');
  const [vendorId, setVendorId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setTechnicianUserId(wo.technicianUserId ?? wo.technician?.id ?? null);
      setTeam(wo.assignedTeam ?? '');
      setVendorId(wo.assignedVendorId ?? wo.assignedVendor?.id ?? null);
      setError(null);
    }
  }, [open, wo]);

  const mutation = useMutation({
    mutationFn: () =>
      assignWorkOrder(wo.id, {
        technicianUserId: technicianUserId ?? undefined,
        team: team.trim() || undefined,
        vendorId: vendorId ?? undefined,
      }),
    onSuccess: () => {
      toast({ title: 'Work order assigned', variant: 'success' });
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = () => {
    setError(null);
    if (!technicianUserId && !team.trim() && !vendorId) {
      return setError('Designate a technician, a team, or a vendor.');
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Assign {workOrderNumber(wo)}</DialogTitle>
        <DialogDescription>Designate who executes this work order.</DialogDescription>
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
          <FormField label="Technician" htmlFor="wo-assign-technician" hint="Internal technician user account.">
            <UserPicker
              id="wo-assign-technician"
              value={technicianUserId}
              onChange={setTechnicianUserId}
              selectedLabel={wo.technician?.displayName ?? undefined}
            />
          </FormField>
          <FormField label="Team" htmlFor="wo-assign-team" hint="Free text, e.g. Facilities night shift.">
            <Input id="wo-assign-team" value={team} onChange={(event) => setTeam(event.target.value)} />
          </FormField>
          <FormField label="External vendor" htmlFor="wo-assign-vendor">
            <SupplierPicker
              id="wo-assign-vendor"
              value={vendorId}
              selectedLabel={wo.assignedVendor ? supplierRefLabel(wo.assignedVendor) : undefined}
              onSelect={(supplier) => setVendorId(supplier?.id ?? null)}
              placeholder="Search vendors…"
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Assign
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* -------------------------------- Schedule --------------------------------- */

function toLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ScheduleWorkOrderDialog({ wo, open, onOpenChange }: WoDialogProps) {
  const { toast } = useToast();
  const invalidate = useWoInvalidate();
  const [plannedStart, setPlannedStart] = React.useState('');
  const [plannedEnd, setPlannedEnd] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setPlannedStart(toLocalInput(woPlannedStart(wo)));
      setPlannedEnd(toLocalInput(woPlannedEnd(wo)));
      setError(null);
    }
  }, [open, wo]);

  const mutation = useMutation({
    mutationFn: () =>
      scheduleWorkOrder(wo.id, {
        plannedStart: new Date(plannedStart).toISOString(),
        plannedEnd: new Date(plannedEnd).toISOString(),
      }),
    onSuccess: () => {
      toast({ title: 'Work order scheduled', variant: 'success' });
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = () => {
    setError(null);
    if (!plannedStart) return setError('Planned start is required.');
    if (!plannedEnd) return setError('Planned end is required.');
    if (new Date(plannedEnd) <= new Date(plannedStart)) {
      return setError('Planned end must be after the planned start.');
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Schedule {workOrderNumber(wo)}</DialogTitle>
        <DialogDescription>Set the planned maintenance window.</DialogDescription>
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Planned start" htmlFor="wo-schedule-start" required>
              <Input
                id="wo-schedule-start"
                type="datetime-local"
                value={plannedStart}
                onChange={(event) => setPlannedStart(event.target.value)}
              />
            </FormField>
            <FormField label="Planned end" htmlFor="wo-schedule-end" required>
              <Input
                id="wo-schedule-end"
                type="datetime-local"
                value={plannedEnd}
                onChange={(event) => setPlannedEnd(event.target.value)}
              />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Schedule
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ---------------------------------- Hold ----------------------------------- */

export function HoldWorkOrderDialog({ wo, open, onOpenChange }: WoDialogProps) {
  const { toast } = useToast();
  const invalidate = useWoInvalidate();
  const [reason, setReason] = React.useState<WorkOrderHoldReason>('On Hold');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setReason('On Hold');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () => holdWorkOrder(wo.id, reason),
    onSuccess: () => {
      toast({ title: `Work order moved to ${reason}`, variant: 'success' });
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const selected = WORK_ORDER_HOLD_REASONS.find((entry) => entry.reason === reason);

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Put {workOrderNumber(wo)} on hold</DialogTitle>
        <DialogDescription>Pauses the work until it is resumed.</DialogDescription>
      </DialogHeader>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <DialogBody className="space-y-3">
          <FormError message={error} />
          <FormField label="Waiting on" htmlFor="wo-hold-reason" required hint={selected?.hint}>
            <Select
              id="wo-hold-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value as WorkOrderHoldReason)}
            >
              {WORK_ORDER_HOLD_REASONS.map((entry) => (
                <option key={entry.reason} value={entry.reason}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Hold work order
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* -------------------------------- Complete --------------------------------- */

export function CompleteWorkOrderDialog({ wo, open, onOpenChange }: WoDialogProps) {
  const { canAny } = useSession();
  const { toast } = useToast();
  const invalidate = useWoInvalidate();
  const canViewCost = canAny(MAINTENANCE_COST_PERMISSIONS);

  const [resolution, setResolution] = React.useState('');
  const [actionTaken, setActionTaken] = React.useState('');
  const [finalConditionId, setFinalConditionId] = React.useState('');
  const [assetNextStatus, setAssetNextStatus] = React.useState<string>(AssetStatus.AVAILABLE);
  const [reason, setReason] = React.useState('');
  const [laborCost, setLaborCost] = React.useState('');
  const [externalCost, setExternalCost] = React.useState('');
  const [downtimeMinutes, setDowntimeMinutes] = React.useState('');
  const [nextMaintenanceDate, setNextMaintenanceDate] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setResolution(wo.resolution ?? '');
      setActionTaken(wo.actionTaken ?? '');
      setFinalConditionId('');
      setAssetNextStatus(AssetStatus.AVAILABLE);
      setReason('');
      setLaborCost('');
      setExternalCost('');
      setDowntimeMinutes('');
      setNextMaintenanceDate('');
      setError(null);
    }
  }, [open, wo]);

  const outcomeNeedsReason =
    assetNextStatus === AssetStatus.DAMAGED || assetNextStatus === AssetStatus.RETIRED;

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        resolution: resolution.trim(),
        actionTaken: actionTaken.trim(),
        finalConditionId,
        assetNextStatus,
        reason: outcomeNeedsReason ? reason.trim() : undefined,
        downtimeMinutes: downtimeMinutes === '' ? undefined : Number(downtimeMinutes),
        nextMaintenanceDate: nextMaintenanceDate || undefined,
        ...(canViewCost && laborCost !== '' ? { laborCost } : {}),
        ...(canViewCost && externalCost !== '' ? { externalCost } : {}),
      };
      return completeWorkOrder(wo.id, body);
    },
    onSuccess: () => {
      toast({ title: 'Work order completed', variant: 'success' });
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const handleSubmit = () => {
    setError(null);
    if (!resolution.trim()) return setError('Resolution is required.');
    if (!actionTaken.trim()) return setError('Action taken is required.');
    if (!finalConditionId) return setError('Record the asset’s final condition.');
    if (outcomeNeedsReason && !reason.trim()) {
      return setError('A reason is required for a Damaged or Retired outcome.');
    }
    if (downtimeMinutes !== '') {
      const downtime = Number(downtimeMinutes);
      if (!Number.isInteger(downtime) || downtime < 0) {
        return setError('Downtime must be zero or a positive whole number of minutes.');
      }
    }
    mutation.mutate();
  };

  const outcome = WORK_ORDER_COMPLETION_OUTCOMES.find((entry) => entry.value === assetNextStatus);

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Complete {workOrderNumber(wo)}</DialogTitle>
        <DialogDescription>
          Records the outcome and applies the asset&apos;s next lifecycle status. Required checklist
          tasks must be done and open parts issues posted or canceled.
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
          <FormField label="Action taken" htmlFor="wo-complete-action" required>
            <Textarea
              id="wo-complete-action"
              rows={2}
              value={actionTaken}
              onChange={(event) => setActionTaken(event.target.value)}
            />
          </FormField>
          <FormField label="Resolution" htmlFor="wo-complete-resolution" required>
            <Textarea
              id="wo-complete-resolution"
              rows={2}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Final condition" htmlFor="wo-complete-condition" required>
              <LookupSelect
                id="wo-complete-condition"
                type="asset-conditions"
                value={finalConditionId}
                onChange={setFinalConditionId}
              />
            </FormField>
            <FormField
              label="Asset outcome"
              htmlFor="wo-complete-outcome"
              required
              hint={outcome?.hint}
            >
              <Select
                id="wo-complete-outcome"
                value={assetNextStatus}
                onChange={(event) => setAssetNextStatus(event.target.value)}
              >
                {WORK_ORDER_COMPLETION_OUTCOMES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Downtime (minutes)"
              htmlFor="wo-complete-downtime"
              hint="Leave blank to use the actual start → completion span."
            >
              <Input
                id="wo-complete-downtime"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={downtimeMinutes}
                onChange={(event) => setDowntimeMinutes(event.target.value)}
              />
            </FormField>
            <FormField
              label="Next maintenance date"
              htmlFor="wo-complete-next"
              hint="For preventive work — schedules the next cycle."
            >
              <Input
                id="wo-complete-next"
                type="date"
                value={nextMaintenanceDate}
                onChange={(event) => setNextMaintenanceDate(event.target.value)}
              />
            </FormField>
            {canViewCost ? (
              <>
                <FormField label="Labor cost (PHP)" htmlFor="wo-complete-labor">
                  <Input
                    id="wo-complete-labor"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={laborCost}
                    onChange={(event) => setLaborCost(event.target.value)}
                  />
                </FormField>
                <FormField
                  label="External service cost (PHP)"
                  htmlFor="wo-complete-external"
                  hint="Parts cost rolls in automatically from posted parts issues."
                >
                  <Input
                    id="wo-complete-external"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={externalCost}
                    onChange={(event) => setExternalCost(event.target.value)}
                  />
                </FormField>
              </>
            ) : null}
          </div>
          {outcomeNeedsReason ? (
            <FormField
              label="Reason"
              htmlFor="wo-complete-reason"
              required
              hint="Damaged and Retired outcomes require a recorded reason."
            >
              <Textarea
                id="wo-complete-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </FormField>
          ) : null}
          {assetNextStatus === AssetStatus.RETIRED ? (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              Retiring the asset routes through the retirement approval flow.
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Complete work order
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* -------------------------------- Add parts -------------------------------- */

interface PartLineDraft {
  key: string;
  item: Item | null;
  uomId: string;
  quantity: string;
  lotId: string;
}

let partKeyCounter = 1;

function emptyPartLine(): PartLineDraft {
  return { key: `wo-part-${partKeyCounter++}`, item: null, uomId: '', quantity: '', lotId: '' };
}

function PartLineEditor({
  line,
  index,
  warehouseId,
  onChange,
  onRemove,
  removable,
}: {
  line: PartLineDraft;
  index: number;
  warehouseId: string;
  onChange: (next: PartLineDraft) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const uomData = useUomData();
  const uomOptions = line.item ? itemUomChoices(line.item, uomData) : [];
  const lotTracked = !!line.item?.isLotTracked;
  const { lots } = useLotOptions(lotTracked ? (line.item?.id ?? null) : null, warehouseId);

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Part {index + 1}</p>
        {removable ? (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove part ${index + 1}`}>
            <Trash2 aria-hidden /> Remove
          </Button>
        ) : null}
      </div>
      <FormField label="Item" htmlFor={`${line.key}-item`} required>
        <ItemPicker
          id={`${line.key}-item`}
          value={line.item?.id ?? null}
          selectedLabel={line.item?.name}
          onSelect={(item) =>
            onChange({
              ...line,
              item,
              uomId: item?.issueUom?.id ?? item?.issueUomId ?? item?.baseUom?.id ?? item?.baseUomId ?? '',
              lotId: '',
            })
          }
        />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="UOM" htmlFor={`${line.key}-uom`} required>
          <Select
            id={`${line.key}-uom`}
            value={line.uomId}
            onChange={(event) => onChange({ ...line, uomId: event.target.value })}
            disabled={!line.item}
          >
            <option value="">Select…</option>
            {uomOptions.map((uom) => (
              <option key={uom.id} value={uom.id}>
                {uom.code}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Quantity" htmlFor={`${line.key}-qty`} required>
          <Input
            id={`${line.key}-qty`}
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={line.quantity}
            onChange={(event) => onChange({ ...line, quantity: event.target.value })}
          />
        </FormField>
      </div>
      {lotTracked ? (
        <FormField label="Lot" htmlFor={`${line.key}-lot`} hint="FEFO — earliest expiry first.">
          <Select
            id={`${line.key}-lot`}
            value={line.lotId}
            onChange={(event) => onChange({ ...line, lotId: event.target.value })}
          >
            <option value="">Let the server pick (FEFO)</option>
            {lots.map((lot) => (
              <option key={lot.id} value={lot.id}>
                {lotOptionLabel(lot)}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
    </div>
  );
}

/** Draft a linked MAINTENANCE_ISSUE stock transaction for needed spare parts. */
export function AddPartsDialog({ wo, open, onOpenChange }: WoDialogProps) {
  const { toast } = useToast();
  const invalidate = useWoInvalidate();
  const [warehouseId, setWarehouseId] = React.useState('');
  const [lines, setLines] = React.useState<PartLineDraft[]>([emptyPartLine()]);
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const branchId = wo.branchId ?? wo.branch?.id ?? '';

  React.useEffect(() => {
    if (open) {
      setWarehouseId('');
      setLines([emptyPartLine()]);
      setNotes('');
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      createWorkOrderPartsIssue(wo.id, {
        warehouseId,
        lines: lines.map(
          (line): WorkOrderPartsIssueLineInput => ({
            itemId: line.item!.id,
            uomId: line.uomId,
            quantity: line.quantity,
            lotId: line.lotId || undefined,
          }),
        ),
        notes: notes.trim() || undefined,
      }),
    onSuccess: (txn) => {
      toast({
        title: 'Parts issue drafted',
        description: `Stock issue ${stockTransactionNumber(txn)} created — post it via Inventory to consume the parts.`,
        variant: 'success',
      });
      invalidate();
      onOpenChange(false);
    },
    onError: (err) => {
      if (isApiClientError(err) && err.code === 'INSUFFICIENT_STOCK') {
        setError(
          `Not enough stock in the selected warehouse: ${err.message} Reduce the quantity or pick another warehouse.`,
        );
        return;
      }
      setError(getErrorMessage(err));
    },
  });

  const handleSubmit = () => {
    setError(null);
    if (!warehouseId) return setError('Pick the warehouse the parts come from.');
    for (const [index, line] of lines.entries()) {
      const label = `Part ${index + 1}`;
      if (!line.item) return setError(`${label}: pick an item.`);
      if (!line.uomId) return setError(`${label}: pick a unit of measure.`);
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return setError(`${label}: quantity must be greater than zero.`);
      }
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogHeader>
        <DialogTitle>Add parts to {workOrderNumber(wo)}</DialogTitle>
        <DialogDescription>
          Creates a draft maintenance-parts stock issue linked to this work order. Parts are consumed
          only when the issue is posted (Inventory → Transactions).
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
          <FormField label="From warehouse" htmlFor="wo-parts-warehouse" required>
            <WarehouseSelect
              id="wo-parts-warehouse"
              branchId={branchId}
              value={warehouseId}
              onChange={setWarehouseId}
            />
          </FormField>
          {lines.map((line, index) => (
            <PartLineEditor
              key={line.key}
              line={line}
              index={index}
              warehouseId={warehouseId}
              removable={lines.length > 1}
              onChange={(next) =>
                setLines((current) => current.map((entry) => (entry.key === next.key ? next : entry)))
              }
              onRemove={() => setLines((current) => current.filter((entry) => entry.key !== line.key))}
            />
          ))}
          <Button variant="outline" onClick={() => setLines((current) => [...current, emptyPartLine()])}>
            <Plus aria-hidden /> Add another part
          </Button>
          <FormField label="Notes" htmlFor="wo-parts-notes">
            <Textarea
              id="wo-parts-notes"
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
            Create parts issue
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
