'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { getErrorMessage, isVersionConflict } from '@/lib/api';
import {
  createMaintenancePlan,
  getMaintenancePlan,
  updateMaintenancePlan,
  type MaintenancePlanTaskInput,
  type MaintenancePlanWriteBody,
} from '@/lib/endpoints';
import {
  assetTag,
  planNextDue,
  planTaskIsRequired,
  planTasks,
  planType,
  supplierRefLabel,
  type Asset,
  type MaintenancePlan,
} from '@/lib/types';
import { MAINTENANCE_COST_PERMISSIONS } from '@/lib/status-maps';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { AssetPicker, LookupSelect } from '@/components/inventory/pickers';
import { SupplierPicker } from '@/components/procurement/supplier-picker';

type FrequencyMode = 'interval' | 'meter' | 'schedule';

interface TaskDraft {
  key: string;
  name: string;
  description: string;
  isRequired: boolean;
}

let taskKeyCounter = 1;

function emptyTask(): TaskDraft {
  return { key: `plan-task-${taskKeyCounter++}`, name: '', description: '', isRequired: true };
}

/** Create a new maintenance plan, or edit an existing one when `planId` is set. */
export function MaintenancePlanEditor({ planId }: { planId?: string }) {
  const isEdit = !!planId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { canAny } = useSession();
  const { toast } = useToast();
  const canViewCost = canAny(MAINTENANCE_COST_PERMISSIONS);

  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [typeId, setTypeId] = React.useState('');
  // Create only — the covered-asset set; edited later via the detail page.
  const [coveredAssets, setCoveredAssets] = React.useState<Asset[]>([]);
  const [assetPickerValue, setAssetPickerValue] = React.useState<string | null>(null);
  const [frequency, setFrequency] = React.useState<FrequencyMode>('interval');
  const [intervalDays, setIntervalDays] = React.useState('');
  const [meterInterval, setMeterInterval] = React.useState('');
  const [meterType, setMeterType] = React.useState('');
  const [scheduleCron, setScheduleCron] = React.useState('');
  const [nextDueAt, setNextDueAt] = React.useState('');
  const [assignedTeam, setAssignedTeam] = React.useState('');
  const [vendorId, setVendorId] = React.useState<string | null>(null);
  const [vendorLabel, setVendorLabel] = React.useState<string | null>(null);
  const [estimatedDurationHours, setEstimatedDurationHours] = React.useState('');
  const [estimatedCost, setEstimatedCost] = React.useState('');
  const [reminderLeadDays, setReminderLeadDays] = React.useState('');
  const [tasks, setTasks] = React.useState<TaskDraft[]>([]);
  const [formError, setFormError] = React.useState<string | null>(null);
  const hydratedRef = React.useRef(false);

  const planQuery = useQuery({
    queryKey: ['maintenance-plans', 'detail', planId],
    queryFn: ({ signal }) => getMaintenancePlan(planId as string, signal),
    enabled: isEdit,
  });
  const plan = planQuery.data;

  // One-time hydration of the form from the loaded plan.
  React.useEffect(() => {
    if (!isEdit || hydratedRef.current || !plan) return;
    hydratedRef.current = true;
    setCode(plan.code ?? '');
    setName(plan.name ?? '');
    setDescription(plan.description ?? '');
    setTypeId(plan.maintenanceTypeId ?? planType(plan)?.id ?? '');
    setNextDueAt(planNextDue(plan)?.slice(0, 10) ?? '');
    if (plan.intervalDays !== null && plan.intervalDays !== undefined) {
      setFrequency('interval');
      setIntervalDays(String(plan.intervalDays));
    } else if (plan.meterInterval !== null && plan.meterInterval !== undefined) {
      setFrequency('meter');
      setMeterInterval(String(plan.meterInterval));
    } else if (plan.scheduleCron) {
      setFrequency('schedule');
      setScheduleCron(plan.scheduleCron);
    }
    setMeterType(plan.meterType ?? '');
    setAssignedTeam(plan.assignedTeam ?? '');
    setVendorId(plan.vendorId ?? plan.vendor?.id ?? null);
    setVendorLabel(plan.vendor ? supplierRefLabel(plan.vendor) : null);
    setEstimatedDurationHours(
      plan.estimatedDurationHours !== null && plan.estimatedDurationHours !== undefined
        ? String(plan.estimatedDurationHours)
        : '',
    );
    setEstimatedCost(
      plan.estimatedCost !== null && plan.estimatedCost !== undefined
        ? String(plan.estimatedCost)
        : '',
    );
    setReminderLeadDays(
      plan.reminderLeadDays !== null && plan.reminderLeadDays !== undefined
        ? String(plan.reminderLeadDays)
        : '',
    );
    setTasks(
      planTasks(plan).map((task) => ({
        key: `plan-task-${taskKeyCounter++}`,
        name: task.name ?? '',
        description: task.description ?? '',
        isRequired: planTaskIsRequired(task),
      })),
    );
  }, [isEdit, plan]);

  const saveMutation = useMutation({
    mutationFn: (body: MaintenancePlanWriteBody) => {
      if (isEdit && plan) {
        // Business codes are immutable — never send `code` on PATCH.
        const { code: _code, ...rest } = body;
        return updateMaintenancePlan(plan.id, { ...rest, version: plan.version });
      }
      return createMaintenancePlan(body);
    },
    onSuccess: (saved: MaintenancePlan) => {
      toast({
        title: isEdit ? 'Plan updated' : 'Plan created',
        description: `Maintenance plan ${saved.name} saved.`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
      router.push(`/maintenance/plans/${saved.id}`);
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        toast({
          title: 'Plan changed',
          description:
            'This plan was modified by someone else. The latest version has been reloaded — please reapply your changes.',
          variant: 'destructive',
        });
        hydratedRef.current = false;
        queryClient.invalidateQueries({ queryKey: ['maintenance-plans'] });
        return;
      }
      setFormError(getErrorMessage(error));
    },
  });

  const handleSave = () => {
    setFormError(null);
    if (!name.trim()) return setFormError('Plan name is required.');
    if (!typeId) return setFormError('Maintenance type is required.');
    if (frequency === 'interval') {
      const days = Number(intervalDays);
      if (!Number.isInteger(days) || days <= 0) {
        return setFormError('Interval must be a whole number of days greater than zero.');
      }
    } else if (frequency === 'meter') {
      const interval = Number(meterInterval);
      if (!Number.isFinite(interval) || interval <= 0) {
        return setFormError('Meter interval must be greater than zero.');
      }
      if (!meterType.trim()) return setFormError('Meter type is required for meter-based plans.');
    } else {
      if (!scheduleCron.trim()) {
        return setFormError('Schedule expression is required for schedule-based plans.');
      }
      if (!nextDueAt) {
        return setFormError('Schedule-based plans need an explicit first due date.');
      }
    }
    for (const [index, task] of tasks.entries()) {
      if (!task.name.trim()) return setFormError(`Checklist task ${index + 1}: name is required.`);
    }

    // Task order comes from array position — the server assigns sequences.
    const taskInputs = tasks.map(
      (task): MaintenancePlanTaskInput => ({
        name: task.name.trim(),
        description: task.description.trim() || undefined,
        isRequired: task.isRequired,
      }),
    );

    const body: MaintenancePlanWriteBody = {
      name: name.trim(),
      description: description.trim() || null,
      maintenanceTypeId: typeId,
      intervalDays: frequency === 'interval' ? Number(intervalDays) : null,
      meterInterval: frequency === 'meter' ? meterInterval : null,
      meterType: frequency === 'meter' ? meterType.trim() : null,
      scheduleCron: frequency === 'schedule' ? scheduleCron.trim() : null,
      nextDueAt: nextDueAt ? new Date(`${nextDueAt}T00:00:00`).toISOString() : null,
      assignedTeam: assignedTeam.trim() || null,
      vendorId: vendorId ?? null,
      estimatedDurationHours: estimatedDurationHours === '' ? null : estimatedDurationHours,
      reminderLeadDays: reminderLeadDays === '' ? null : Number(reminderLeadDays),
      tasks: taskInputs,
    };
    if (canViewCost) {
      body.estimatedCost = estimatedCost === '' ? null : estimatedCost;
    }
    if (!isEdit) {
      body.code = code.trim() || undefined;
      if (coveredAssets.length > 0) {
        body.assetIds = coveredAssets.map((asset) => asset.id);
      }
    }
    saveMutation.mutate(body);
  };

  if (isEdit && planQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isEdit && (planQuery.isError || !plan)) {
    return <ErrorState error={planQuery.error} onRetry={() => planQuery.refetch()} />;
  }

  const backHref = isEdit && plan ? `/maintenance/plans/${plan.id}` : '/maintenance/plans';

  const moveTask = (index: number, direction: -1 | 1) => {
    setTasks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
  };

  return (
    <>
      <PageHeader
        title={isEdit && plan ? `Edit ${plan.name}` : 'New maintenance plan'}
        description="Preventive template — active plans generate work orders when due."
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft aria-hidden /> Back
          </Button>
        }
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormError message={formError} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              label="Code"
              htmlFor="plan-code"
              hint={isEdit ? 'Business codes are permanent.' : 'Optional — generated when left blank.'}
            >
              <Input
                id="plan-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={isEdit}
                className="font-mono"
              />
            </FormField>
            <FormField label="Name" htmlFor="plan-name" required>
              <Input id="plan-name" value={name} onChange={(event) => setName(event.target.value)} />
            </FormField>
            <FormField label="Maintenance type" htmlFor="plan-type" required>
              <LookupSelect id="plan-type" type="maintenance-types" value={typeId} onChange={setTypeId} />
            </FormField>
            <FormField label="Description" htmlFor="plan-description">
              <Textarea
                id="plan-description"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Covered assets</CardTitle>
          <CardDescription>Serialized assets this plan schedules maintenance for.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isEdit ? (
            <p className="text-sm text-muted-foreground">
              The covered-asset set is managed on the plan detail page.
            </p>
          ) : (
            <>
              <FormField label="Add asset" htmlFor="plan-add-asset">
                <AssetPicker
                  id="plan-add-asset"
                  value={assetPickerValue}
                  onSelect={(asset) => {
                    setAssetPickerValue(null);
                    if (asset && !coveredAssets.some((entry) => entry.id === asset.id)) {
                      setCoveredAssets((current) => [...current, asset]);
                    }
                  }}
                />
              </FormField>
              {coveredAssets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No assets yet — you can also add them later from the plan detail page.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {coveredAssets.map((asset) => (
                    <li
                      key={asset.id}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs"
                    >
                      {assetTag(asset)}
                      <button
                        type="button"
                        onClick={() =>
                          setCoveredAssets((current) => current.filter((entry) => entry.id !== asset.id))
                        }
                        aria-label={`Remove ${assetTag(asset)}`}
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Trash2 className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Frequency &amp; reminders</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Frequency by" htmlFor="plan-frequency">
              <Select
                id="plan-frequency"
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as FrequencyMode)}
              >
                <option value="interval">Date interval</option>
                <option value="meter">Usage meter</option>
                <option value="schedule">Configurable schedule</option>
              </Select>
            </FormField>
            {frequency === 'interval' ? (
              <FormField label="Every (days)" htmlFor="plan-interval" required>
                <Input
                  id="plan-interval"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={intervalDays}
                  onChange={(event) => setIntervalDays(event.target.value)}
                />
              </FormField>
            ) : null}
            {frequency === 'meter' ? (
              <>
                <FormField label="Every (meter units)" htmlFor="plan-meter-interval" required>
                  <Input
                    id="plan-meter-interval"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={meterInterval}
                    onChange={(event) => setMeterInterval(event.target.value)}
                  />
                </FormField>
                <FormField
                  label="Meter type"
                  htmlFor="plan-meter-type"
                  required
                  hint="e.g. hours, km, cycles — matches the asset's meter readings."
                >
                  <Input
                    id="plan-meter-type"
                    value={meterType}
                    onChange={(event) => setMeterType(event.target.value)}
                  />
                </FormField>
              </>
            ) : null}
            {frequency === 'schedule' ? (
              <FormField
                label="Schedule (cron)"
                htmlFor="plan-cron"
                required
                hint='Cron expression, e.g. "0 8 1 * *" = 08:00 on the 1st monthly.'
              >
                <Input
                  id="plan-cron"
                  value={scheduleCron}
                  onChange={(event) => setScheduleCron(event.target.value)}
                  className="font-mono"
                />
              </FormField>
            ) : null}
            <FormField
              label="First due date"
              htmlFor="plan-next-due"
              required={frequency === 'schedule'}
              hint={
                frequency === 'schedule'
                  ? 'Required for schedule-based plans.'
                  : 'Optional — defaults from the interval when left blank.'
              }
            >
              <Input
                id="plan-next-due"
                type="date"
                value={nextDueAt}
                onChange={(event) => setNextDueAt(event.target.value)}
              />
            </FormField>
            <FormField
              label="Reminder lead time (days)"
              htmlFor="plan-reminder"
              hint="How many days before due date to raise the reminder."
            >
              <Input
                id="plan-reminder"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={reminderLeadDays}
                onChange={(event) => setReminderLeadDays(event.target.value)}
              />
            </FormField>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Execution</CardTitle>
          <CardDescription>Who does the work and what it should cost.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Internal team" htmlFor="plan-team" hint="Free text, e.g. Facilities.">
              <Input
                id="plan-team"
                value={assignedTeam}
                onChange={(event) => setAssignedTeam(event.target.value)}
              />
            </FormField>
            <FormField label="External vendor" htmlFor="plan-vendor">
              <SupplierPicker
                id="plan-vendor"
                value={vendorId}
                selectedLabel={vendorLabel}
                onSelect={(supplier) => {
                  setVendorId(supplier?.id ?? null);
                  setVendorLabel(null);
                }}
                placeholder="Search vendors…"
              />
            </FormField>
            <FormField label="Estimated duration (hours)" htmlFor="plan-duration">
              <Input
                id="plan-duration"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={estimatedDurationHours}
                onChange={(event) => setEstimatedDurationHours(event.target.value)}
              />
            </FormField>
            {canViewCost ? (
              <FormField label="Estimated cost (PHP)" htmlFor="plan-cost">
                <Input
                  id="plan-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={estimatedCost}
                  onChange={(event) => setEstimatedCost(event.target.value)}
                />
              </FormField>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checklist</CardTitle>
          <CardDescription>Tasks copied onto every work order this plan generates.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No checklist tasks yet.</p>
          ) : (
            tasks.map((task, index) => (
              <div key={task.key} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Task {index + 1}</p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveTask(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move task ${index + 1} up`}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => moveTask(index, 1)}
                      disabled={index === tasks.length - 1}
                      aria-label={`Move task ${index + 1} down`}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTasks((current) => current.filter((entry) => entry.key !== task.key))}
                      aria-label={`Remove task ${index + 1}`}
                    >
                      <Trash2 aria-hidden /> Remove
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Task" htmlFor={`${task.key}-name`} required>
                    <Input
                      id={`${task.key}-name`}
                      value={task.name}
                      onChange={(event) =>
                        setTasks((current) =>
                          current.map((entry) =>
                            entry.key === task.key ? { ...entry, name: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </FormField>
                  <FormField label="Details" htmlFor={`${task.key}-description`}>
                    <Input
                      id={`${task.key}-description`}
                      value={task.description}
                      onChange={(event) =>
                        setTasks((current) =>
                          current.map((entry) =>
                            entry.key === task.key ? { ...entry, description: event.target.value } : entry,
                          ),
                        )
                      }
                    />
                  </FormField>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={task.isRequired}
                    onChange={(event) =>
                      setTasks((current) =>
                        current.map((entry) =>
                          entry.key === task.key ? { ...entry, isRequired: event.target.checked } : entry,
                        ),
                      )
                    }
                  />
                  Required before completion
                </label>
              </div>
            ))
          )}
          <Button variant="outline" onClick={() => setTasks((current) => [...current, emptyTask()])}>
            <Plus aria-hidden /> Add task
          </Button>

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => router.push(backHref)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saveMutation.isPending}>
              <Save aria-hidden /> {isEdit ? 'Save changes' : 'Create plan'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
