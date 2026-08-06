import { Prisma } from '@prisma/client';

/**
 * Response shaping for the approvals module. Money serializes as strings
 * (api-outline 1.1); resolved assignees surface as {id, displayName} so the
 * inbox can render approver chips without extra requests.
 */

export const WORKFLOW_LIST_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  resourceType: true,
  documentSubtypes: true,
  branchId: true,
  branch: { select: { id: true, code: true, name: true } },
  minAmount: true,
  maxAmount: true,
  minQuantity: true,
  maxQuantity: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { steps: true, requests: true } },
} satisfies Prisma.ApprovalWorkflowSelect;

export const WORKFLOW_DETAIL_SELECT = {
  ...WORKFLOW_LIST_SELECT,
  steps: {
    orderBy: { sequence: 'asc' as const },
    select: {
      id: true,
      sequence: true,
      name: true,
      approverType: true,
      approverRole: { select: { id: true, code: true, name: true } },
      approverPosition: { select: { id: true, code: true, name: true } },
      approverUser: { select: { id: true, displayName: true, email: true } },
    },
  },
} satisfies Prisma.ApprovalWorkflowSelect;

type WorkflowListRow = Prisma.ApprovalWorkflowGetPayload<{
  select: typeof WORKFLOW_LIST_SELECT;
}>;
type WorkflowDetailRow = Prisma.ApprovalWorkflowGetPayload<{
  select: typeof WORKFLOW_DETAIL_SELECT;
}>;

function decimalString(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toString();
}

export function toWorkflowView(row: WorkflowListRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    documentType: row.resourceType,
    documentSubtypes: row.documentSubtypes,
    branch: row.branch,
    minAmount: decimalString(row.minAmount),
    maxAmount: decimalString(row.maxAmount),
    minQuantity: decimalString(row.minQuantity),
    maxQuantity: decimalString(row.maxQuantity),
    isActive: row.isActive,
    stepCount: row._count.steps,
    requestCount: row._count.requests,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export type WorkflowView = ReturnType<typeof toWorkflowView>;

export function toWorkflowDetailView(row: WorkflowDetailRow) {
  return {
    ...toWorkflowView(row),
    steps: row.steps.map((step) => ({
      id: step.id,
      sequence: step.sequence,
      name: step.name,
      approverType: step.approverType,
      approverRole: step.approverRole,
      approverPosition: step.approverPosition,
      approverUser: step.approverUser,
    })),
  };
}
export type WorkflowDetailView = ReturnType<typeof toWorkflowDetailView>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const REQUEST_LIST_SELECT = {
  id: true,
  resourceType: true,
  resourceId: true,
  resourceNumber: true,
  status: true,
  amount: true,
  quantity: true,
  branch: { select: { id: true, code: true, name: true } },
  workflow: { select: { id: true, code: true, name: true } },
  requestedBy: { select: { id: true, displayName: true, email: true } },
  requestedAt: true,
  completedAt: true,
  currentStep: { select: { id: true, sequence: true, name: true } },
} satisfies Prisma.ApprovalRequestSelect;

export const REQUEST_DETAIL_SELECT = {
  ...REQUEST_LIST_SELECT,
  steps: {
    orderBy: { sequence: 'asc' as const },
    select: {
      id: true,
      sequence: true,
      status: true,
      assigneeUserIds: true,
      actedById: true,
      actedAt: true,
      comment: true,
      step: {
        select: { id: true, name: true, approverType: true },
      },
      actedBy: { select: { id: true, displayName: true, email: true } },
    },
  },
  actions: {
    orderBy: { actedAt: 'asc' as const },
    select: {
      id: true,
      action: true,
      comment: true,
      actedAt: true,
      actor: { select: { id: true, displayName: true, email: true } },
      delegatedFor: { select: { id: true, displayName: true, email: true } },
      step: { select: { sequence: true, name: true } },
    },
  },
} satisfies Prisma.ApprovalRequestSelect;

type RequestListRow = Prisma.ApprovalRequestGetPayload<{
  select: typeof REQUEST_LIST_SELECT;
}>;
type RequestDetailRow = Prisma.ApprovalRequestGetPayload<{
  select: typeof REQUEST_DETAIL_SELECT;
}>;

export function toRequestView(row: RequestListRow) {
  return {
    id: row.id,
    documentType: row.resourceType,
    documentId: row.resourceId,
    documentNumber: row.resourceNumber,
    status: row.status,
    amount: decimalString(row.amount),
    quantity: decimalString(row.quantity),
    branch: row.branch,
    workflow: row.workflow,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    currentStep: row.currentStep
      ? { sequence: row.currentStep.sequence, name: row.currentStep.name }
      : null,
  };
}
export type RequestView = ReturnType<typeof toRequestView>;

export interface UserRef {
  id: string;
  displayName: string;
  email: string;
}

export function toRequestDetailView(
  row: RequestDetailRow,
  assigneesById: Map<string, UserRef>,
) {
  return {
    ...toRequestView(row),
    steps: row.steps.map((step) => ({
      sequence: step.sequence,
      name: step.step.name,
      approverType: step.step.approverType,
      status: step.status,
      assignees: step.assigneeUserIds.map(
        (id) => assigneesById.get(id) ?? { id, displayName: id, email: '' },
      ),
      actedBy: step.actedBy,
      actedAt: step.actedAt ? step.actedAt.toISOString() : null,
      comment: step.comment,
    })),
    history: row.actions.map((action) => ({
      id: action.id,
      action: action.action,
      comment: action.comment,
      actedAt: action.actedAt.toISOString(),
      actor: action.actor,
      delegatedFor: action.delegatedFor,
      step: action.step
        ? { sequence: action.step.sequence, name: action.step.name }
        : null,
    })),
  };
}
export type RequestDetailView = ReturnType<typeof toRequestDetailView>;

// ---------------------------------------------------------------------------
// Delegations
// ---------------------------------------------------------------------------

export const DELEGATION_SELECT = {
  id: true,
  delegator: { select: { id: true, displayName: true, email: true } },
  delegate: { select: { id: true, displayName: true, email: true } },
  startsAt: true,
  endsAt: true,
  reason: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.ApprovalDelegationSelect;

type DelegationRow = Prisma.ApprovalDelegationGetPayload<{
  select: typeof DELEGATION_SELECT;
}>;

export function toDelegationView(row: DelegationRow) {
  return {
    id: row.id,
    delegator: row.delegator,
    delegate: row.delegate,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}
export type DelegationView = ReturnType<typeof toDelegationView>;
