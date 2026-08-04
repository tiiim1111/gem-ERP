'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Plus, Save, Trash2 } from 'lucide-react';
import { PERMISSIONS, TrackingMethod } from '@gemerp/shared';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import {
  createStockTransaction,
  type StockTransactionCreateBody,
  type StockTransactionLineInput,
} from '@/lib/endpoints';
import { stockTransactionNumber, type Item } from '@/lib/types';
import { convertToBase, itemUomChoices, useUomData } from '@/lib/uom';
import {
  CREATABLE_TRANSACTION_TYPES,
  STOCK_TRANSACTION_TYPE_PERMISSION,
  stockTransactionTypeLabel,
  transactionTypeNeedsDepartment,
  transactionTypeNeedsEmployee,
  transactionTypeNeedsReason,
} from '@/lib/status-maps';
import { cn } from '@/lib/utils';
import { useSession } from '@/components/auth/session-provider';
import { EmployeePicker } from '@/components/employees/employee-picker';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  BranchSelect,
  DepartmentSelect,
  ItemPicker,
  LocationSelect,
  LookupSelect,
  lotOptionLabel,
  useLotOptions,
  WarehouseSelect,
} from '@/components/inventory/pickers';

/* ------------------------------ Line drafts ------------------------------- */

interface LineDraft {
  key: string;
  item: Item | null;
  uomId: string;
  quantity: string;
  lotMode: 'existing' | 'new';
  lotId: string;
  newLotNumber: string;
  newLotExpiry: string;
  locationId: string;
  unitCost: string;
}

let lineKeyCounter = 1;

function emptyLine(): LineDraft {
  return {
    key: `line-${lineKeyCounter++}`,
    item: null,
    uomId: '',
    quantity: '',
    lotMode: 'existing',
    lotId: '',
    newLotNumber: '',
    newLotExpiry: '',
    locationId: '',
    unitCost: '',
  };
}

// UOM choices + conversion preview live in lib/uom.ts — the item list payload
// has no scalar UOM ids or global conversions, so the helpers combine the
// nested UOM objects with the global catalog/conversion graph.

function isLotTrackedItem(item: Item | null): boolean {
  return !!item && (item.trackingMethod === TrackingMethod.LOT || item.isLotTracked);
}

/* ------------------------------ Line editor ------------------------------- */

function LineEditor({
  line,
  index,
  warehouseId,
  canViewCost,
  serverError,
  onChange,
  onRemove,
  removable,
}: {
  line: LineDraft;
  index: number;
  warehouseId: string;
  canViewCost: boolean;
  serverError?: string;
  onChange: (next: LineDraft) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const lotTracked = isLotTrackedItem(line.item);
  const { lots, isLoading: lotsLoading } = useLotOptions(
    lotTracked ? (line.item?.id ?? null) : null,
    warehouseId,
  );
  const uomData = useUomData();

  const quantityNumber = Number(line.quantity);
  const basePreview =
    line.item && line.uomId && Number.isFinite(quantityNumber) && quantityNumber > 0
      ? convertToBase(line.item, line.uomId, quantityNumber, uomData)
      : null;
  const uomOptions = line.item ? itemUomChoices(line.item, uomData) : [];
  const baseCode = line.item?.baseUom?.code ?? 'base units';

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold">Line {index + 1}</p>
        {removable ? (
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove line ${index + 1}`}>
            <Trash2 aria-hidden /> Remove
          </Button>
        ) : null}
      </div>

      <FormError message={serverError} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <FormField label="Item" htmlFor={`${line.key}-item`} required>
          <ItemPicker
            id={`${line.key}-item`}
            value={line.item?.id ?? null}
            selectedLabel={line.item?.name}
            onSelect={(item) =>
              onChange({
                ...line,
                item,
                uomId: item?.baseUom?.id ?? item?.baseUomId ?? '',
                lotId: '',
                lotMode: 'existing',
                newLotNumber: '',
                newLotExpiry: '',
              })
            }
          />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="UOM"
            htmlFor={`${line.key}-uom`}
            required
            hint={line.item ? `Base UOM: ${baseCode}` : undefined}
          >
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
          <FormField
            label="Quantity"
            htmlFor={`${line.key}-qty`}
            required
            hint={
              basePreview !== null && line.uomId !== (line.item?.baseUom?.id ?? line.item?.baseUomId)
                ? `≈ ${Number(basePreview.toFixed(4))} ${baseCode}`
                : undefined
            }
          >
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
      </div>

      {lotTracked ? (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Lot / batch
            </p>
            <div className="flex gap-1" role="radiogroup" aria-label="Lot mode">
              <Button
                size="sm"
                variant={line.lotMode === 'existing' ? 'secondary' : 'ghost'}
                onClick={() => onChange({ ...line, lotMode: 'existing' })}
                aria-pressed={line.lotMode === 'existing'}
              >
                Existing lot
              </Button>
              <Button
                size="sm"
                variant={line.lotMode === 'new' ? 'secondary' : 'ghost'}
                onClick={() => onChange({ ...line, lotMode: 'new', lotId: '' })}
                aria-pressed={line.lotMode === 'new'}
              >
                New lot
              </Button>
            </div>
          </div>
          {line.lotMode === 'existing' ? (
            <FormField label="Lot" htmlFor={`${line.key}-lot`} required>
              <Select
                id={`${line.key}-lot`}
                value={line.lotId}
                onChange={(event) => onChange({ ...line, lotId: event.target.value })}
                disabled={lotsLoading}
              >
                <option value="">
                  {lotsLoading ? 'Loading lots…' : lots.length === 0 ? 'No lots yet — use "New lot"' : 'Select lot (FEFO order)…'}
                </option>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    {lotOptionLabel(lot)}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Lot number"
                htmlFor={`${line.key}-newlot`}
                hint="Leave blank to auto-generate."
              >
                <Input
                  id={`${line.key}-newlot`}
                  value={line.newLotNumber}
                  onChange={(event) => onChange({ ...line, newLotNumber: event.target.value })}
                />
              </FormField>
              <FormField
                label="Expiry date"
                htmlFor={`${line.key}-expiry`}
                required={!!line.item?.isExpiryTracked}
              >
                <Input
                  id={`${line.key}-expiry`}
                  type="date"
                  value={line.newLotExpiry}
                  onChange={(event) => onChange({ ...line, newLotExpiry: event.target.value })}
                />
              </FormField>
            </div>
          )}
        </div>
      ) : null}

      <div className={cn('grid grid-cols-1 gap-3', canViewCost ? 'sm:grid-cols-2' : '')}>
        <FormField label="Storage location" htmlFor={`${line.key}-location`}>
          <LocationSelect
            id={`${line.key}-location`}
            warehouseId={warehouseId}
            value={line.locationId}
            onChange={(locationId) => onChange({ ...line, locationId })}
          />
        </FormField>
        {canViewCost ? (
          <FormField label="Unit cost (PHP)" htmlFor={`${line.key}-cost`}>
            <Input
              id={`${line.key}-cost`}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={line.unitCost}
              onChange={(event) => onChange({ ...line, unitCost: event.target.value })}
            />
          </FormField>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------- Wizard ---------------------------------- */

const STEPS = ['Type', 'Header', 'Lines'] as const;

export function TransactionCreateWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can, canAny } = useSession();
  const { toast } = useToast();
  const canViewCost = can(PERMISSIONS.inventory.viewCost);

  const [step, setStep] = React.useState(0);
  const [type, setType] = React.useState('');
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [employeeId, setEmployeeId] = React.useState<string | null>(null);
  const [departmentId, setDepartmentId] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<LineDraft[]>([emptyLine()]);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [lineErrors, setLineErrors] = React.useState<Record<number, string>>({});

  const availableTypes = CREATABLE_TRANSACTION_TYPES.filter((entry) =>
    canAny([STOCK_TRANSACTION_TYPE_PERMISSION[entry] ?? PERMISSIONS.inventory.adjust]),
  );

  const needsEmployee = transactionTypeNeedsEmployee(type);
  const needsDepartment = transactionTypeNeedsDepartment(type);
  const needsReason = transactionTypeNeedsReason(type);

  React.useEffect(() => {
    // Reset warehouse when the branch changes.
    setWarehouseId('');
  }, [branchId]);

  const createMutation = useMutation({
    mutationFn: (body: StockTransactionCreateBody) => createStockTransaction(body),
    onSuccess: (created) => {
      toast({
        title: 'Draft saved',
        description: `Transaction ${stockTransactionNumber(created)} created as a draft.`,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['stock-transactions'] });
      router.push(`/inventory/transactions/${created.id}`);
    },
    onError: (error) => {
      if (isApiClientError(error) && error.details) {
        const perLine: Record<number, string> = {};
        for (const detail of error.details) {
          const match = /^lines[.[](\d+)/.exec(detail.field ?? '');
          if (match) {
            const index = Number(match[1]);
            if (!(index in perLine)) perLine[index] = detail.message;
          }
        }
        setLineErrors(perLine);
      }
      setFormError(getErrorMessage(error));
    },
  });

  const validateHeader = (): string | null => {
    if (!type) return 'Pick a transaction type.';
    if (!branchId) return 'Branch is required.';
    if (!warehouseId) return 'Warehouse is required.';
    if (needsEmployee && !employeeId) return 'This transaction type requires an employee.';
    if (needsDepartment && !departmentId) return 'This transaction type requires a department.';
    if (needsReason && !reasonCode) return 'A reason is required for adjustments and write-offs.';
    return null;
  };

  const validateLines = (): string | null => {
    if (lines.length === 0) return 'Add at least one line.';
    for (const [index, line] of lines.entries()) {
      const label = `Line ${index + 1}`;
      if (!line.item) return `${label}: pick an item.`;
      if (!line.uomId) return `${label}: pick a unit of measure.`;
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `${label}: quantity must be greater than zero.`;
      }
      if (isLotTrackedItem(line.item)) {
        if (line.lotMode === 'existing' && !line.lotId) {
          return `${label}: select a lot or switch to "New lot".`;
        }
        if (line.lotMode === 'new' && line.item.isExpiryTracked && !line.newLotExpiry) {
          return `${label}: expiry date is required for this lot-tracked item.`;
        }
      }
    }
    return null;
  };

  const handleSaveDraft = () => {
    setFormError(null);
    setLineErrors({});
    const headerError = validateHeader();
    if (headerError) {
      setFormError(headerError);
      setStep(headerError.startsWith('Pick a transaction') ? 0 : 1);
      return;
    }
    const linesError = validateLines();
    if (linesError) {
      setFormError(linesError);
      setStep(2);
      return;
    }

    const body: StockTransactionCreateBody = {
      type,
      branchId,
      warehouseId,
      lines: lines.map((line): StockTransactionLineInput => {
        const input: StockTransactionLineInput = {
          itemId: line.item!.id,
          uomId: line.uomId,
          quantity: line.quantity,
        };
        if (isLotTrackedItem(line.item)) {
          if (line.lotMode === 'existing' && line.lotId) {
            input.lotId = line.lotId;
          } else if (line.lotMode === 'new') {
            input.lotInput = {
              lotNumber: line.newLotNumber || undefined,
              expiryDate: line.newLotExpiry || undefined,
            };
          }
        }
        if (line.locationId) input.locationId = line.locationId;
        if (canViewCost && line.unitCost) input.unitCost = line.unitCost;
        return input;
      }),
      reasonCode: reasonCode || undefined,
      employeeId: needsEmployee ? (employeeId ?? undefined) : undefined,
      departmentId: needsDepartment ? departmentId || undefined : undefined,
      notes: notes || undefined,
    };
    createMutation.mutate(body);
  };

  const goNext = () => {
    setFormError(null);
    if (step === 0 && !type) {
      setFormError('Pick a transaction type to continue.');
      return;
    }
    if (step === 1) {
      const headerError = validateHeader();
      if (headerError) {
        setFormError(headerError);
        return;
      }
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  return (
    <>
      <PageHeader
        title="New stock transaction"
        description="Drafts do not affect stock — submit, approve, and post to move quantities."
        actions={
          <Button variant="outline" onClick={() => router.push('/inventory/transactions')}>
            <ArrowLeft aria-hidden /> Back to list
          </Button>
        }
      />

      {/* Stepper */}
      <ol className="mb-4 flex items-center gap-2" aria-label="Wizard steps">
        {STEPS.map((label, index) => (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={step === index ? 'step' : undefined}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
                index < step
                  ? 'bg-success text-success-foreground'
                  : index === step
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {index + 1}
            </span>
            <span
              className={cn(
                'text-sm',
                index === step ? 'font-semibold' : 'text-muted-foreground',
              )}
            >
              {label}
            </span>
            {index < STEPS.length - 1 ? <span className="mx-1 h-px w-6 bg-border" aria-hidden /> : null}
          </li>
        ))}
      </ol>

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormError message={formError} />

          {step === 0 ? (
            availableTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You do not have permission to create any stock transaction type.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Transaction type">
                {availableTypes.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    role="radio"
                    aria-checked={type === entry}
                    onClick={() => setType(entry)}
                    className={cn(
                      'rounded-md border p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      type === entry
                        ? 'border-primary bg-primary/5 font-medium'
                        : 'hover:border-primary/40',
                    )}
                  >
                    {stockTransactionTypeLabel(entry)}
                  </button>
                ))}
              </div>
            )
          ) : null}

          {step === 1 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Type" htmlFor="txn-type-summary">
                <Input id="txn-type-summary" value={stockTransactionTypeLabel(type)} readOnly disabled />
              </FormField>
              <div />
              <FormField label="Branch" htmlFor="txn-branch" required>
                <BranchSelect id="txn-branch" value={branchId} onChange={setBranchId} />
              </FormField>
              <FormField label="Warehouse" htmlFor="txn-warehouse" required>
                <WarehouseSelect
                  id="txn-warehouse"
                  branchId={branchId}
                  value={warehouseId}
                  onChange={setWarehouseId}
                />
              </FormField>
              {needsEmployee ? (
                <FormField label="Employee" htmlFor="txn-employee" required>
                  <EmployeePicker id="txn-employee" value={employeeId} onChange={setEmployeeId} />
                </FormField>
              ) : null}
              {needsDepartment ? (
                <FormField label="Department" htmlFor="txn-department" required>
                  <DepartmentSelect id="txn-department" value={departmentId} onChange={setDepartmentId} />
                </FormField>
              ) : null}
              {needsReason ? (
                <FormField label="Reason" htmlFor="txn-reason" required>
                  <LookupSelect
                    id="txn-reason"
                    type="adjustment-reasons"
                    valueField="code"
                    value={reasonCode}
                    onChange={setReasonCode}
                    placeholder="Select reason…"
                  />
                </FormField>
              ) : null}
              <FormField label="Notes" htmlFor="txn-notes" className="sm:col-span-2">
                <Textarea
                  id="txn-notes"
                  rows={2}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </FormField>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              {lines.map((line, index) => (
                <LineEditor
                  key={line.key}
                  line={line}
                  index={index}
                  warehouseId={warehouseId}
                  canViewCost={canViewCost}
                  serverError={lineErrors[index]}
                  removable={lines.length > 1}
                  onChange={(next) =>
                    setLines((current) => current.map((entry) => (entry.key === next.key ? next : entry)))
                  }
                  onRemove={() =>
                    setLines((current) => current.filter((entry) => entry.key !== line.key))
                  }
                />
              ))}
              <Button variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>
                <Plus aria-hidden /> Add line
              </Button>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
            <Button
              variant="outline"
              onClick={() => setStep((current) => Math.max(current - 1, 0))}
              disabled={step === 0 || createMutation.isPending}
            >
              <ArrowLeft aria-hidden /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={goNext} disabled={availableTypes.length === 0}>
                Continue <ArrowRight aria-hidden />
              </Button>
            ) : (
              <Button onClick={handleSaveDraft} loading={createMutation.isPending}>
                <Save aria-hidden /> Save draft
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
