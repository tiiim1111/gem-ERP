import { Prisma } from '@prisma/client';
import {
  isDelegationActive,
  MatchableWorkflow,
  pickWorkflow,
  resolveActingAuthority,
  workflowMatches,
} from './approval-rules';

const D = (value: string) => new Prisma.Decimal(value);

function workflow(overrides: Partial<MatchableWorkflow> = {}): MatchableWorkflow {
  return {
    id: 'wf-1',
    branchId: null,
    documentSubtypes: [],
    minAmount: null,
    maxAmount: null,
    minQuantity: null,
    maxQuantity: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('workflowMatches — branch, sub-type, and threshold evaluation', () => {
  it('a global unbounded workflow matches everything', () => {
    expect(workflowMatches(workflow(), { branchId: 'b-1' })).toBe(true);
    expect(
      workflowMatches(workflow(), {
        branchId: 'b-2',
        subtype: 'ADJUSTMENT_INCREASE',
        amount: D('99999'),
      }),
    ).toBe(true);
  });

  it('branch-scoped workflows match only their branch (or an extra branch — transfers)', () => {
    const scoped = workflow({ branchId: 'b-1' });
    expect(workflowMatches(scoped, { branchId: 'b-1' })).toBe(true);
    expect(workflowMatches(scoped, { branchId: 'b-2' })).toBe(false);
    expect(
      workflowMatches(scoped, { branchId: 'b-2', extraBranchIds: ['b-1'] }),
    ).toBe(true);
  });

  it('sub-type scoped workflows require the document sub-type', () => {
    const adjustmentsOnly = workflow({
      documentSubtypes: ['ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE'],
    });
    expect(
      workflowMatches(adjustmentsOnly, {
        branchId: 'b-1',
        subtype: 'ADJUSTMENT_DECREASE',
      }),
    ).toBe(true);
    expect(
      workflowMatches(adjustmentsOnly, {
        branchId: 'b-1',
        subtype: 'NON_PURCHASE_RECEIPT',
      }),
    ).toBe(false);
    expect(workflowMatches(adjustmentsOnly, { branchId: 'b-1' })).toBe(false);
  });

  it('amount thresholds bound inclusively', () => {
    const highValue = workflow({ minAmount: D('10000') });
    expect(
      workflowMatches(highValue, { branchId: 'b-1', amount: D('9999.99') }),
    ).toBe(false);
    expect(
      workflowMatches(highValue, { branchId: 'b-1', amount: D('10000') }),
    ).toBe(true);
    const banded = workflow({ minAmount: D('100'), maxAmount: D('500') });
    expect(workflowMatches(banded, { branchId: 'b-1', amount: D('501') })).toBe(
      false,
    );
    expect(workflowMatches(banded, { branchId: 'b-1', amount: D('500') })).toBe(
      true,
    );
  });

  it('quantity thresholds evaluate independently of amount', () => {
    const bulky = workflow({ minQuantity: D('50') });
    expect(
      workflowMatches(bulky, { branchId: 'b-1', quantity: D('49.9999') }),
    ).toBe(false);
    expect(workflowMatches(bulky, { branchId: 'b-1', quantity: D('50') })).toBe(
      true,
    );
  });

  it('a bounded workflow never matches a document without the bounded value', () => {
    expect(
      workflowMatches(workflow({ minAmount: D('1') }), {
        branchId: 'b-1',
        amount: null,
      }),
    ).toBe(false);
    expect(
      workflowMatches(workflow({ maxQuantity: D('10') }), { branchId: 'b-1' }),
    ).toBe(false);
  });
});

describe('pickWorkflow — most specific wins', () => {
  it('branch-specific beats global', () => {
    const global = workflow({ id: 'wf-global' });
    const scoped = workflow({ id: 'wf-scoped', branchId: 'b-1' });
    expect(pickWorkflow([global, scoped], { branchId: 'b-1' })?.id).toBe(
      'wf-scoped',
    );
    // Outside the branch only the global one applies.
    expect(pickWorkflow([global, scoped], { branchId: 'b-2' })?.id).toBe(
      'wf-global',
    );
  });

  it('sub-type scoped beats catch-all; more threshold bounds beat fewer', () => {
    const catchAll = workflow({ id: 'wf-any' });
    const typed = workflow({
      id: 'wf-typed',
      documentSubtypes: ['ADJUSTMENT_DECREASE'],
    });
    const typedAndBanded = workflow({
      id: 'wf-typed-banded',
      documentSubtypes: ['ADJUSTMENT_DECREASE'],
      minQuantity: D('10'),
    });
    const picked = pickWorkflow([catchAll, typed, typedAndBanded], {
      branchId: 'b-1',
      subtype: 'ADJUSTMENT_DECREASE',
      quantity: D('25'),
    });
    expect(picked?.id).toBe('wf-typed-banded');
  });

  it('ties break on the oldest workflow (deterministic routing)', () => {
    const older = workflow({
      id: 'wf-old',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const newer = workflow({
      id: 'wf-new',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    expect(pickWorkflow([newer, older], { branchId: 'b-1' })?.id).toBe('wf-old');
  });

  it('returns null when nothing matches (documents keep auto-approve)', () => {
    expect(
      pickWorkflow([workflow({ branchId: 'b-9' })], { branchId: 'b-1' }),
    ).toBeNull();
  });
});

describe('delegation windows', () => {
  const window = {
    delegatorId: 'boss',
    delegateId: 'deputy',
    startsAt: new Date('2026-08-10T00:00:00.000Z'),
    endsAt: new Date('2026-08-20T23:59:59.000Z'),
    isActive: true,
  };

  it('is active strictly inside (and at the edges of) the window', () => {
    expect(
      isDelegationActive(window, new Date('2026-08-15T12:00:00.000Z')),
    ).toBe(true);
    expect(
      isDelegationActive(window, new Date('2026-08-10T00:00:00.000Z')),
    ).toBe(true);
    expect(
      isDelegationActive(window, new Date('2026-08-20T23:59:59.000Z')),
    ).toBe(true);
  });

  it('is inactive before the start, after the end, or when revoked', () => {
    expect(
      isDelegationActive(window, new Date('2026-08-09T23:59:59.000Z')),
    ).toBe(false);
    expect(
      isDelegationActive(window, new Date('2026-08-21T00:00:00.000Z')),
    ).toBe(false);
    expect(
      isDelegationActive(
        { ...window, isActive: false },
        new Date('2026-08-15T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('resolveActingAuthority', () => {
  const now = new Date('2026-08-15T00:00:00.000Z');
  const delegation = {
    delegatorId: 'boss',
    delegateId: 'deputy',
    startsAt: new Date('2026-08-10T00:00:00.000Z'),
    endsAt: new Date('2026-08-20T00:00:00.000Z'),
    isActive: true,
  };

  it('authorizes a direct assignee without a delegation marker', () => {
    expect(resolveActingAuthority(['boss'], 'boss', [delegation], now)).toEqual(
      { authorized: true, delegatedForId: null },
    );
  });

  it('authorizes an in-window delegate and records who they act for', () => {
    expect(resolveActingAuthority(['boss'], 'deputy', [delegation], now)).toEqual(
      { authorized: true, delegatedForId: 'boss' },
    );
  });

  it('refuses a delegate outside the window', () => {
    expect(
      resolveActingAuthority(
        ['boss'],
        'deputy',
        [delegation],
        new Date('2026-08-25T00:00:00.000Z'),
      ),
    ).toEqual({ authorized: false, delegatedForId: null });
  });

  it('refuses strangers even with unrelated delegations present', () => {
    expect(
      resolveActingAuthority(['someone-else'], 'deputy', [delegation], now),
    ).toEqual({ authorized: false, delegatedForId: null });
  });
});
