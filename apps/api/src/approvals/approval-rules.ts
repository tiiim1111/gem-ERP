import { Prisma } from '@prisma/client';

/**
 * Pure approval-framework rules (spec §19, docs/status-transitions.md §7).
 * No Nest/Prisma clients — workflow matching, threshold evaluation, and
 * delegation windows are unit-testable without infrastructure.
 */

/** Document types the Phase 6 engine routes (canonical resource_type values). */
export const APPROVAL_RESOURCE_TYPES = [
  'STOCK_TRANSACTION',
  'PURCHASE_ORDER',
  'TRANSFER',
  'SUPPLIER_RETURN',
] as const;
export type ApprovalResourceType = (typeof APPROVAL_RESOURCE_TYPES)[number];

/** The workflow fields matching consults. */
export interface MatchableWorkflow {
  id: string;
  branchId: string | null;
  documentSubtypes: string[];
  minAmount: Prisma.Decimal | null;
  maxAmount: Prisma.Decimal | null;
  minQuantity: Prisma.Decimal | null;
  maxQuantity: Prisma.Decimal | null;
  createdAt: Date;
}

/** The document context a workflow is matched against. */
export interface MatchContext {
  branchId: string;
  /** Additional branches that satisfy a branch-scoped workflow (transfers). */
  extraBranchIds?: readonly string[];
  /** Document sub-type (e.g. stock transaction type); undefined = untyped. */
  subtype?: string;
  /** Total document amount; null/undefined when the document carries none. */
  amount?: Prisma.Decimal | null;
  /** Total base quantity; null/undefined when not applicable. */
  quantity?: Prisma.Decimal | null;
}

function boundsSatisfied(
  value: Prisma.Decimal | null | undefined,
  min: Prisma.Decimal | null,
  max: Prisma.Decimal | null,
): boolean {
  if (min === null && max === null) {
    return true;
  }
  // A bounded workflow cannot be evaluated against a document that carries
  // no value — it simply does not match (deny-nothing default: an unbounded
  // workflow still catches the document).
  if (value === null || value === undefined) {
    return false;
  }
  if (min !== null && value.lt(min)) {
    return false;
  }
  if (max !== null && value.gt(max)) {
    return false;
  }
  return true;
}

/** Whether one active workflow covers the document context. */
export function workflowMatches(
  workflow: MatchableWorkflow,
  ctx: MatchContext,
): boolean {
  if (workflow.branchId !== null) {
    const branches = [ctx.branchId, ...(ctx.extraBranchIds ?? [])];
    if (!branches.includes(workflow.branchId)) {
      return false;
    }
  }
  if (workflow.documentSubtypes.length > 0) {
    if (!ctx.subtype || !workflow.documentSubtypes.includes(ctx.subtype)) {
      return false;
    }
  }
  return (
    boundsSatisfied(ctx.amount, workflow.minAmount, workflow.maxAmount) &&
    boundsSatisfied(ctx.quantity, workflow.minQuantity, workflow.maxQuantity)
  );
}

/**
 * Specificity score — higher wins. Branch-scoped beats global; sub-type
 * scoped beats catch-all; each defined threshold bound adds precision.
 */
export function workflowSpecificity(workflow: MatchableWorkflow): number {
  let score = 0;
  if (workflow.branchId !== null) {
    score += 8;
  }
  if (workflow.documentSubtypes.length > 0) {
    score += 4;
  }
  if (workflow.minAmount !== null) score += 1;
  if (workflow.maxAmount !== null) score += 1;
  if (workflow.minQuantity !== null) score += 1;
  if (workflow.maxQuantity !== null) score += 1;
  return score;
}

/**
 * Pick the MOST SPECIFIC active workflow covering the context; ties break
 * on the oldest workflow (stable, deterministic routing). Null = no match →
 * the document keeps its pre-Phase-6 auto-approve behavior.
 */
export function pickWorkflow<T extends MatchableWorkflow>(
  workflows: readonly T[],
  ctx: MatchContext,
): T | null {
  const matching = workflows.filter((workflow) =>
    workflowMatches(workflow, ctx),
  );
  if (matching.length === 0) {
    return null;
  }
  return [...matching].sort(
    (a, b) =>
      workflowSpecificity(b) - workflowSpecificity(a) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  )[0];
}

// ---------------------------------------------------------------------------
// Delegation windows (spec §19: delegation with start and end dates)
// ---------------------------------------------------------------------------

export interface DelegationWindow {
  delegatorId: string;
  delegateId: string;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}

/** Whether a delegation authorizes the delegate at the given instant. */
export function isDelegationActive(
  delegation: DelegationWindow,
  now: Date,
): boolean {
  return (
    delegation.isActive &&
    delegation.startsAt.getTime() <= now.getTime() &&
    delegation.endsAt.getTime() >= now.getTime()
  );
}

export interface ActorResolution {
  authorized: boolean;
  /** The assignee the actor acts for when authorized via delegation. */
  delegatedForId: string | null;
}

/**
 * Resolve whether `actorId` may act on a step assigned to `assigneeIds`:
 * directly assigned, or the delegate of an assignee inside an active window.
 * Direct assignment always wins over delegation (cleaner history).
 */
export function resolveActingAuthority(
  assigneeIds: readonly string[],
  actorId: string,
  delegations: readonly DelegationWindow[],
  now: Date,
): ActorResolution {
  if (assigneeIds.includes(actorId)) {
    return { authorized: true, delegatedForId: null };
  }
  const active = delegations.find(
    (delegation) =>
      delegation.delegateId === actorId &&
      assigneeIds.includes(delegation.delegatorId) &&
      isDelegationActive(delegation, now),
  );
  if (active) {
    return { authorized: true, delegatedForId: active.delegatorId };
  }
  return { authorized: false, delegatedForId: null };
}
