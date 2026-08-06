'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import {
  createApprovalWorkflow,
  getApprovalWorkflow,
  listPositions,
  listRoles,
  updateApprovalWorkflow,
  type ApprovalStepInput,
  type ApprovalWorkflowUpdateBody,
} from '@/lib/endpoints';
import { workflowDocumentType, workflowSteps } from '@/lib/types';
import {
  APPROVAL_APPROVER_TYPES,
  APPROVAL_DOCUMENT_SUBTYPES,
  APPROVAL_DOCUMENT_TYPES,
} from '@/lib/status-maps';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckboxList } from '@/components/ui/checkbox-list';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useBranchOptions } from '@/components/inventory/pickers';
import { UserPicker } from '@/components/approvals/user-picker';

interface StepDraft {
  key: string;
  name: string;
  approverType: 'ROLE' | 'POSITION' | 'DEPT_HEAD' | 'USER';
  approverRoleId: string;
  approverPositionId: string;
  approverUserId: string | null;
  approverUserLabel: string | null;
}

let stepKeyCounter = 1;

function newStep(): StepDraft {
  return {
    key: `wf-step-${stepKeyCounter++}`,
    name: '',
    approverType: 'ROLE',
    approverRoleId: '',
    approverPositionId: '',
    approverUserId: null,
    approverUserLabel: null,
  };
}

/**
 * Workflow editor (approval.manage): document type + branch scope + amount
 * thresholds + ordered steps. Each step picks ONE of the four approver
 * resolutions (GemCor requirement): role, position, requester's department
 * head, or a named user.
 */
export function WorkflowEditor({ workflowId }: { workflowId?: string }) {
  const isEdit = !!workflowId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { branches } = useBranchOptions();

  const workflowQuery = useQuery({
    queryKey: ['approval-workflows', workflowId],
    queryFn: ({ signal }) => getApprovalWorkflow(workflowId!, signal),
    enabled: isEdit,
  });

  const rolesQuery = useQuery({
    queryKey: ['roles', 'options'],
    queryFn: ({ signal }) => listRoles({ page: 1, pageSize: 100 }, signal),
  });
  const positionsQuery = useQuery({
    queryKey: ['positions', 'options'],
    queryFn: ({ signal }) => listPositions({ page: 1, pageSize: 100, isActive: true }, signal),
  });

  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [resourceType, setResourceType] = React.useState('');
  const [documentSubtypes, setDocumentSubtypes] = React.useState<string[]>([]);
  const [branchId, setBranchId] = React.useState('');
  const [minAmount, setMinAmount] = React.useState('');
  const [maxAmount, setMaxAmount] = React.useState('');
  const [minQuantity, setMinQuantity] = React.useState('');
  const [maxQuantity, setMaxQuantity] = React.useState('');
  const [steps, setSteps] = React.useState<StepDraft[]>(() => [newStep()]);
  const [error, setError] = React.useState<string | null>(null);
  const [hydrated, setHydrated] = React.useState(false);

  // Prefill once from the loaded workflow.
  const workflow = workflowQuery.data;
  React.useEffect(() => {
    if (!isEdit || !workflow || hydrated) return;
    setCode(workflow.code ?? '');
    setName(workflow.name ?? '');
    setDescription(workflow.description ?? '');
    setResourceType(workflowDocumentType(workflow));
    setDocumentSubtypes(workflow.documentSubtypes ?? []);
    setBranchId(workflow.branchId ?? '');
    setMinAmount(workflow.minAmount !== undefined && workflow.minAmount !== null ? String(workflow.minAmount) : '');
    setMaxAmount(workflow.maxAmount !== undefined && workflow.maxAmount !== null ? String(workflow.maxAmount) : '');
    setMinQuantity(workflow.minQuantity !== undefined && workflow.minQuantity !== null ? String(workflow.minQuantity) : '');
    setMaxQuantity(workflow.maxQuantity !== undefined && workflow.maxQuantity !== null ? String(workflow.maxQuantity) : '');
    const loaded = workflowSteps(workflow);
    setSteps(
      loaded.length > 0
        ? loaded.map((step) => ({
            key: `wf-step-${stepKeyCounter++}`,
            name: step.name ?? '',
            approverType: (step.approverType as StepDraft['approverType']) ?? 'ROLE',
            // The detail view hydrates the relation objects, not the raw ids.
            approverRoleId: step.approverRoleId ?? step.approverRole?.id ?? '',
            approverPositionId: step.approverPositionId ?? step.approverPosition?.id ?? '',
            approverUserId: step.approverUserId ?? step.approverUser?.id ?? null,
            approverUserLabel: step.approverUser?.displayName ?? null,
          }))
        : [newStep()],
    );
    setHydrated(true);
  }, [isEdit, workflow, hydrated]);

  const saveMutation = useMutation({
    // code + documentType are create-only (the update DTO whitelists neither).
    mutationFn: (body: ApprovalWorkflowUpdateBody) =>
      isEdit
        ? updateApprovalWorkflow(workflowId!, body)
        : createApprovalWorkflow({
            ...body,
            code: code.trim().toUpperCase().replace(/\s+/g, '-'),
            name: name.trim(),
            documentType: resourceType,
            steps: body.steps ?? [],
          }),
    onSuccess: () => {
      toast({ title: isEdit ? 'Workflow updated' : 'Workflow created', variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['approval-workflows'] });
      router.push('/approvals/workflows');
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const updateStep = (key: string, patch: Partial<StepDraft>) => {
    setSteps((current) => current.map((step) => (step.key === key ? { ...step, ...patch } : step)));
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    setSteps((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(target, 0, step!);
      return next;
    });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isEdit && !code.trim()) return setError('Code is required.');
    if (!isEdit && !/^[A-Z0-9][A-Z0-9 _-]*$/i.test(code.trim())) {
      return setError('Code may only contain letters, digits, hyphens, and underscores.');
    }
    if (!name.trim()) return setError('Name is required.');
    if (!resourceType) return setError('Pick the document type this workflow governs.');
    if (steps.length === 0) return setError('Add at least one approval step.');
    for (const [index, step] of steps.entries()) {
      if (step.approverType === 'ROLE' && !step.approverRoleId)
        return setError(`Step ${index + 1}: pick the approver role.`);
      if (step.approverType === 'POSITION' && !step.approverPositionId)
        return setError(`Step ${index + 1}: pick the approver position.`);
      if (step.approverType === 'USER' && !step.approverUserId)
        return setError(`Step ${index + 1}: pick the approver user.`);
    }
    if (minAmount && maxAmount && Number(minAmount) > Number(maxAmount)) {
      return setError('Minimum amount cannot exceed the maximum amount.');
    }
    if (minQuantity && maxQuantity && Number(minQuantity) > Number(maxQuantity)) {
      return setError('Minimum quantity cannot exceed the maximum quantity.');
    }
    setError(null);
    // Update-DTO shape; the create path layers code/documentType on top.
    saveMutation.mutate({
      name: name.trim(),
      description: description.trim() || null,
      documentSubtypes,
      branchId: branchId || null,
      minAmount: minAmount.trim() || null,
      maxAmount: maxAmount.trim() || null,
      minQuantity: minQuantity.trim() || null,
      maxQuantity: maxQuantity.trim() || null,
      steps: steps.map(
        (step, index): ApprovalStepInput => ({
          sequence: index + 1,
          name: step.name.trim() || undefined,
          approverType: step.approverType,
          approverRoleId: step.approverType === 'ROLE' ? step.approverRoleId : undefined,
          approverPositionId: step.approverType === 'POSITION' ? step.approverPositionId : undefined,
          approverUserId: step.approverType === 'USER' ? (step.approverUserId ?? undefined) : undefined,
        }),
      ),
    });
  };

  if (isEdit && workflowQuery.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isEdit && workflowQuery.isError) {
    return <ErrorState error={workflowQuery.error} onRetry={() => workflowQuery.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title={isEdit ? `Edit workflow — ${workflow?.name ?? ''}` : 'New approval workflow'}
        description="Matching documents route through the steps in order; every step must approve before the document proceeds."
        actions={
          <Link href="/approvals/workflows" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden /> All workflows
          </Link>
        }
      />

      <form onSubmit={handleSubmit} className="mx-auto max-w-3xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Workflow</CardTitle>
            <CardDescription>What the workflow is called and which documents it governs.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Code"
                htmlFor="wf-code"
                required={!isEdit}
                hint={isEdit ? 'Business codes are permanent.' : 'E.g. WF-PO-HIGH-VALUE. Immutable after creation.'}
              >
                <Input
                  id="wf-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  disabled={isEdit}
                  className="font-mono uppercase"
                  placeholder="WF-…"
                />
              </FormField>
              <FormField label="Name" htmlFor="wf-name" required>
                <Input id="wf-name" value={name} onChange={(event) => setName(event.target.value)} />
              </FormField>
              <FormField label="Document type" htmlFor="wf-resource-type" required>
                <Select
                  id="wf-resource-type"
                  value={resourceType}
                  onChange={(event) => {
                    setResourceType(event.target.value);
                    setDocumentSubtypes([]);
                  }}
                  disabled={isEdit}
                >
                  <option value="">Select document type…</option>
                  {APPROVAL_DOCUMENT_TYPES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            {APPROVAL_DOCUMENT_SUBTYPES[resourceType] ? (
              <FormField
                label="Sub-types"
                htmlFor="wf-subtypes"
                hint="Restrict to specific sub-types. Leave everything unticked to cover them all."
              >
                <CheckboxList
                  aria-label="Document sub-types"
                  items={APPROVAL_DOCUMENT_SUBTYPES[resourceType]!.map((entry) => ({
                    id: entry.value,
                    label: entry.label,
                  }))}
                  selectedIds={documentSubtypes}
                  onChange={setDocumentSubtypes}
                />
              </FormField>
            ) : null}
            <FormField label="Description" htmlFor="wf-description">
              <Textarea
                id="wf-description"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </FormField>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scope &amp; thresholds</CardTitle>
            <CardDescription>
              Restrict to one branch and/or an amount band. Leave empty to match everything.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Branch" htmlFor="wf-branch">
              <Select id="wf-branch" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
                <option value="">All branches</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Minimum amount (₱)" htmlFor="wf-min" hint="Applies from this document amount.">
                <Input
                  id="wf-min"
                  inputMode="decimal"
                  value={minAmount}
                  onChange={(event) => setMinAmount(event.target.value)}
                  placeholder="No minimum"
                />
              </FormField>
              <FormField label="Maximum amount (₱)" htmlFor="wf-max" hint="Applies up to this document amount.">
                <Input
                  id="wf-max"
                  inputMode="decimal"
                  value={maxAmount}
                  onChange={(event) => setMaxAmount(event.target.value)}
                  placeholder="No maximum"
                />
              </FormField>
              <FormField
                label="Minimum quantity"
                htmlFor="wf-min-qty"
                hint="Against the document's total base quantity."
              >
                <Input
                  id="wf-min-qty"
                  inputMode="decimal"
                  value={minQuantity}
                  onChange={(event) => setMinQuantity(event.target.value)}
                  placeholder="No minimum"
                />
              </FormField>
              <FormField
                label="Maximum quantity"
                htmlFor="wf-max-qty"
                hint="Against the document's total base quantity."
              >
                <Input
                  id="wf-max-qty"
                  inputMode="decimal"
                  value={maxQuantity}
                  onChange={(event) => setMaxQuantity(event.target.value)}
                  placeholder="No maximum"
                />
              </FormField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle>Approval steps</CardTitle>
              <CardDescription>
                Steps run top to bottom. Each step resolves its approver by role, position, the
                requester&apos;s department head, or a named user.
              </CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setSteps((current) => [...current, newStep()])}>
              <Plus aria-hidden /> Add step
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.map((step, index) => {
              const typeMeta = APPROVAL_APPROVER_TYPES.find((entry) => entry.value === step.approverType);
              return (
                <div key={step.key} className="space-y-3 rounded-md border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">Step {index + 1}</p>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => moveStep(index, -1)}
                        disabled={index === 0}
                        aria-label={`Move step ${index + 1} up`}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => moveStep(index, 1)}
                        disabled={index === steps.length - 1}
                        aria-label={`Move step ${index + 1} down`}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSteps((current) => current.filter((entry) => entry.key !== step.key))}
                        disabled={steps.length === 1}
                        aria-label={`Remove step ${index + 1}`}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <FormField label="Step name" htmlFor={`${step.key}-name`} hint="Optional label, e.g. “Branch manager review”.">
                      <Input
                        id={`${step.key}-name`}
                        value={step.name}
                        onChange={(event) => updateStep(step.key, { name: event.target.value })}
                      />
                    </FormField>
                    <FormField
                      label="Approver type"
                      htmlFor={`${step.key}-type`}
                      hint={typeMeta?.hint}
                      required
                    >
                      <Select
                        id={`${step.key}-type`}
                        value={step.approverType}
                        onChange={(event) =>
                          updateStep(step.key, {
                            approverType: event.target.value as StepDraft['approverType'],
                          })
                        }
                      >
                        {APPROVAL_APPROVER_TYPES.map((entry) => (
                          <option key={entry.value} value={entry.value}>
                            {entry.label}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  </div>
                  {step.approverType === 'ROLE' ? (
                    <FormField label="Approver role" htmlFor={`${step.key}-role`} required>
                      <Select
                        id={`${step.key}-role`}
                        value={step.approverRoleId}
                        onChange={(event) => updateStep(step.key, { approverRoleId: event.target.value })}
                        disabled={rolesQuery.isPending}
                      >
                        <option value="">Select role…</option>
                        {(rolesQuery.data?.data ?? []).map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  ) : step.approverType === 'POSITION' ? (
                    <FormField label="Approver position" htmlFor={`${step.key}-position`} required>
                      <Select
                        id={`${step.key}-position`}
                        value={step.approverPositionId}
                        onChange={(event) => updateStep(step.key, { approverPositionId: event.target.value })}
                        disabled={positionsQuery.isPending}
                      >
                        <option value="">Select position…</option>
                        {(positionsQuery.data?.data ?? []).map((position) => (
                          <option key={position.id} value={position.id}>
                            {position.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                  ) : step.approverType === 'USER' ? (
                    <FormField label="Approver user" htmlFor={`${step.key}-user`} required>
                      <UserPicker
                        id={`${step.key}-user`}
                        value={step.approverUserId}
                        selectedLabel={step.approverUserLabel}
                        onSelect={(user) =>
                          updateStep(step.key, {
                            approverUserId: user?.id ?? null,
                            approverUserLabel: user?.displayName ?? null,
                          })
                        }
                      />
                    </FormField>
                  ) : (
                    <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                      Nothing to pick — at request time the engine looks up the requester&apos;s
                      department and assigns its head as the approver.
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <FormError message={error} />

        <div className="flex justify-end gap-2">
          <Link href="/approvals/workflows" className={buttonVariants({ variant: 'outline' })}>
            Cancel
          </Link>
          <Button type="submit" loading={saveMutation.isPending}>
            <Save aria-hidden /> {isEdit ? 'Save workflow' : 'Create workflow'}
          </Button>
        </div>
      </form>
    </>
  );
}
