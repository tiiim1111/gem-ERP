import { HttpException } from '@nestjs/common';
import { ApprovalApproverType } from '@prisma/client';
import { ApprovalEngineService } from './approval-engine.service';
import { ApproverResolutionService } from './approver-resolution.service';

/**
 * Unit tests with a fully mocked Prisma client — no database. Covers THE
 * core GemCor requirement: per-step approver resolution at request time for
 * all four approver types (ROLE / POSITION / DEPT_HEAD / USER), plus
 * delegation-window acting authority, the self-approval block (direct AND
 * laundered through a delegation), multi-step advancement, and finalization
 * executing the document's own transition.
 */

type MockFn = jest.Mock;

function prismaMock() {
  return {
    approvalWorkflow: { findMany: jest.fn().mockResolvedValue([]) },
    approvalRequest: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    approvalRequestStep: {
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    approvalAction: { create: jest.fn() },
    approvalDelegation: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    employee: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback(prismaRef.current),
      ),
  };
}
const prismaRef: { current: ReturnType<typeof prismaMock> } = {
  current: undefined as unknown as ReturnType<typeof prismaMock>,
};

const requester = {
  id: 'requester-1',
  email: 'req@x',
  displayName: 'Requester',
  isSuperAdmin: false,
  roles: [],
  permissions: [],
  branchIds: ['branch-1'],
  mustChangePassword: false,
};
const approver = { ...requester, id: 'approver-1', email: 'appr@x' };
const deputy = { ...requester, id: 'deputy-1', email: 'deputy@x' };

function workflowRow(steps: unknown[]) {
  return {
    id: 'wf-1',
    code: 'WF-1',
    name: 'Test workflow',
    branchId: null,
    documentSubtypes: [],
    minAmount: null,
    maxAmount: null,
    minQuantity: null,
    maxQuantity: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    steps,
  };
}

function step(sequence: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `st-${sequence}`,
    sequence,
    name: null,
    approverType: ApprovalApproverType.USER,
    approverRoleId: null,
    approverPositionId: null,
    approverUserId: null,
    ...overrides,
  };
}

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-1',
    status: 'PENDING',
    resourceType: 'PURCHASE_ORDER',
    resourceId: 'po-1',
    resourceNumber: 'PO-2026-00042',
    branchId: 'branch-1',
    requestedById: 'requester-1',
    currentStepId: 'st-1',
    steps: [
      {
        id: 'rs-1',
        stepId: 'st-1',
        sequence: 1,
        status: 'PENDING',
        assigneeUserIds: ['approver-1'],
      },
    ],
    ...overrides,
  };
}

function expectAppError(error: unknown, status: number, code: string): void {
  expect(error).toBeInstanceOf(HttpException);
  const http = error as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

async function catchError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

describe('ApprovalEngineService', () => {
  let prisma: ReturnType<typeof prismaMock>;
  let documents: { loadContext: MockFn; applyOutcome: MockFn };
  let notifications: { notify: MockFn; notifyMany: MockFn };
  let audit: { log: MockFn };
  let engine: ApprovalEngineService;

  beforeEach(() => {
    prisma = prismaMock();
    prismaRef.current = prisma;
    documents = {
      loadContext: jest.fn(),
      applyOutcome: jest.fn().mockResolvedValue(undefined),
    };
    notifications = {
      notify: jest.fn().mockResolvedValue('created'),
      notifyMany: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    engine = new ApprovalEngineService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      new ApproverResolutionService(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      documents as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      notifications as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audit as any,
    );
  });

  describe('routeSubmit — approver resolution at request time (all four types)', () => {
    it('resolves ROLE, POSITION, DEPT_HEAD, and USER steps and stores the assignees', async () => {
      prisma.approvalWorkflow.findMany.mockResolvedValue([
        workflowRow([
          step(1, {
            approverType: ApprovalApproverType.ROLE,
            approverRoleId: 'role-1',
          }),
          step(2, {
            approverType: ApprovalApproverType.POSITION,
            approverPositionId: 'pos-1',
          }),
          step(3, { approverType: ApprovalApproverType.DEPT_HEAD }),
          step(4, {
            approverType: ApprovalApproverType.USER,
            approverUserId: 'named-user',
          }),
        ]),
      ]);
      // ROLE: branch-scoped holders, then the super-admin sweep.
      prisma.user.findMany
        .mockResolvedValueOnce([{ id: 'role-approver' }])
        .mockResolvedValueOnce([]);
      // POSITION: active employees holding it, linked to active users.
      prisma.employee.findMany.mockResolvedValue([
        { userId: 'position-approver' },
      ]);
      // DEPT_HEAD: resolved from the REQUESTER's employee → department head.
      prisma.employee.findUnique.mockResolvedValue({
        department: {
          headEmployee: {
            userId: 'dept-head-user',
            status: 'ACTIVE',
            archivedAt: null,
            user: { isActive: true, archivedAt: null },
          },
        },
      });
      // USER: the named person, still active.
      prisma.user.findFirst.mockResolvedValue({ id: 'named-user' });
      prisma.approvalRequest.create.mockResolvedValue({ id: 'req-1' });

      const claim = jest.fn().mockResolvedValue(undefined);
      const routed = await engine.routeSubmit(
        {
          resourceType: 'PURCHASE_ORDER',
          resourceId: 'po-1',
          resourceNumber: 'PO-2026-00042',
          branchId: 'branch-1',
          requester,
        },
        claim,
        {},
      );

      expect(routed).toEqual({
        workflowId: 'wf-1',
        workflowCode: 'WF-1',
        requestId: 'req-1',
      });
      expect(claim).toHaveBeenCalledTimes(1);
      // DEPT_HEAD resolution starts from the requester's own employee link.
      expect(prisma.employee.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'requester-1' } }),
      );
      const assignees = prisma.approvalRequestStep.create.mock.calls.map(
        (call) => call[0].data.assigneeUserIds,
      );
      expect(assignees).toEqual([
        ['role-approver'],
        ['position-approver'],
        ['dept-head-user'],
        ['named-user'],
      ]);
      // First-step approvers are notified.
      expect(notifications.notifyMany).toHaveBeenCalledWith(
        ['role-approver'],
        expect.objectContaining({ type: 'APPROVAL_PENDING' }),
      );
    });

    it('blocks submission when a step resolves to no active approver', async () => {
      prisma.approvalWorkflow.findMany.mockResolvedValue([
        workflowRow([step(1, { approverType: ApprovalApproverType.DEPT_HEAD })]),
      ]);
      prisma.employee.findUnique.mockResolvedValue(null); // requester has no employee record
      const error = await catchError(
        engine.routeSubmit(
          {
            resourceType: 'PURCHASE_ORDER',
            resourceId: 'po-1',
            resourceNumber: 'PO-2026-00042',
            branchId: 'branch-1',
            requester,
          },
          jest.fn(),
          {},
        ),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
      expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
    });

    it('returns null (no claim) when no workflow matches', async () => {
      prisma.approvalWorkflow.findMany.mockResolvedValue([]);
      const claim = jest.fn();
      const routed = await engine.routeSubmit(
        {
          resourceType: 'PURCHASE_ORDER',
          resourceId: 'po-1',
          resourceNumber: 'PO-2026-00042',
          branchId: 'branch-1',
          requester,
        },
        claim,
        {},
      );
      expect(routed).toBeNull();
      expect(claim).not.toHaveBeenCalled();
    });
  });

  describe('act — self-approval', () => {
    it('refuses the requester acting on their own request (409)', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(
        pendingRequest({
          steps: [
            {
              id: 'rs-1',
              stepId: 'st-1',
              sequence: 1,
              status: 'PENDING',
              assigneeUserIds: ['requester-1'],
            },
          ],
        }),
      );
      const error = await catchError(
        engine.act(requester, 'req-1', 'APPROVE', undefined, {}),
      );
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
      expect(documents.applyOutcome).not.toHaveBeenCalled();
    });

    it('refuses self-approval laundered through a delegation', async () => {
      // The requester delegated to the deputy... and the deputy IS the
      // requester of this document? No — here the requester tries to act as
      // the DELEGATE of the assigned approver while being the requester.
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest());
      prisma.approvalDelegation.findMany.mockResolvedValue([
        {
          delegatorId: 'approver-1',
          delegateId: 'requester-1',
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          endsAt: new Date('2027-01-01T00:00:00.000Z'),
          isActive: true,
        },
      ]);
      const error = await catchError(
        engine.act(requester, 'req-1', 'APPROVE', undefined, {}),
      );
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
    });

    it('refuses a delegate acting for a delegator who IS the requester', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(
        pendingRequest({
          steps: [
            {
              id: 'rs-1',
              stepId: 'st-1',
              sequence: 1,
              status: 'PENDING',
              assigneeUserIds: ['requester-1'],
            },
          ],
        }),
      );
      prisma.approvalDelegation.findMany.mockResolvedValue([
        {
          delegatorId: 'requester-1',
          delegateId: 'deputy-1',
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          endsAt: new Date('2027-01-01T00:00:00.000Z'),
          isActive: true,
        },
      ]);
      const error = await catchError(
        engine.act(deputy, 'req-1', 'APPROVE', undefined, {}),
      );
      expectAppError(error, 409, 'SELF_APPROVAL_FORBIDDEN');
    });
  });

  describe('act — authority and delegation windows', () => {
    it('403s a caller who is neither assignee nor in-window delegate', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest());
      prisma.approvalDelegation.findMany.mockResolvedValue([]);
      const error = await catchError(
        engine.act(deputy, 'req-1', 'APPROVE', undefined, {}),
      );
      expectAppError(error, 403, 'FORBIDDEN');
    });

    it('lets an in-window delegate approve and records who they acted for', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest());
      prisma.approvalDelegation.findMany.mockResolvedValue([
        {
          delegatorId: 'approver-1',
          delegateId: 'deputy-1',
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          endsAt: new Date('2027-01-01T00:00:00.000Z'),
          isActive: true,
        },
      ]);
      await engine.act(deputy, 'req-1', 'APPROVE', 'ok', {});
      expect(prisma.approvalAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            actorId: 'deputy-1',
            delegatedForId: 'approver-1',
            action: 'APPROVE',
          }),
        }),
      );
      // Single step → finalizes → the document's own transition executes.
      expect(documents.applyOutcome).toHaveBeenCalledWith(
        prisma,
        'PURCHASE_ORDER',
        'po-1',
        'APPROVE',
        'deputy-1',
        'ok',
      );
    });
  });

  describe('act — step advancement and finalization', () => {
    it('advances to the next step (no document transition) and notifies its approvers', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(
        pendingRequest({
          steps: [
            {
              id: 'rs-1',
              stepId: 'st-1',
              sequence: 1,
              status: 'PENDING',
              assigneeUserIds: ['approver-1'],
            },
            {
              id: 'rs-2',
              stepId: 'st-2',
              sequence: 2,
              status: 'PENDING',
              assigneeUserIds: ['second-approver'],
            },
          ],
        }),
      );
      await engine.act(approver, 'req-1', 'APPROVE', undefined, {});
      expect(documents.applyOutcome).not.toHaveBeenCalled();
      const claim = prisma.approvalRequest.updateMany.mock.calls[0][0];
      expect(claim.data.status).toBe('PENDING');
      expect(claim.data.currentStepId).toBe('st-2');
      expect(notifications.notifyMany).toHaveBeenCalledWith(
        ['second-approver'],
        expect.objectContaining({ type: 'APPROVAL_PENDING' }),
      );
    });

    it('reject requires a comment (400) and never touches the document', async () => {
      const error = await catchError(
        engine.act(approver, 'req-1', 'REJECT', '  ', {}),
      );
      expectAppError(error, 400, 'VALIDATION_ERROR');
      expect(documents.applyOutcome).not.toHaveBeenCalled();
    });

    it('reject finalizes the request, runs the document reject path, and notifies the requester', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest());
      await engine.act(approver, 'req-1', 'REJECT', 'wrong supplier', {});
      const claim = prisma.approvalRequest.updateMany.mock.calls[0][0];
      expect(claim.data.status).toBe('REJECTED');
      expect(documents.applyOutcome).toHaveBeenCalledWith(
        prisma,
        'PURCHASE_ORDER',
        'po-1',
        'REJECT',
        'approver-1',
        'wrong supplier',
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'requester-1',
          type: 'APPROVAL_REJECTED',
        }),
      );
    });

    it('return sends the document back to draft and notifies the requester', async () => {
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest());
      await engine.act(approver, 'req-1', 'RETURN', 'fix quantities', {});
      expect(documents.applyOutcome).toHaveBeenCalledWith(
        prisma,
        'PURCHASE_ORDER',
        'po-1',
        'RETURN',
        'approver-1',
        'fix quantities',
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'requester-1',
          type: 'APPROVAL_RETURNED',
        }),
      );
    });
  });

  describe('actOnResource — the legacy-endpoint bridge', () => {
    it('returns false when the document has no pending request', async () => {
      prisma.approvalRequest.findFirst.mockResolvedValue(null);
      const handled = await engine.actOnResource(
        approver,
        'PURCHASE_ORDER',
        'po-1',
        'APPROVE',
        undefined,
        {},
      );
      expect(handled).toBe(false);
    });

    it('routes through act() when a pending request exists', async () => {
      prisma.approvalRequest.findFirst.mockResolvedValue({ id: 'req-1' });
      prisma.approvalRequest.findUnique.mockResolvedValue(pendingRequest());
      const handled = await engine.actOnResource(
        approver,
        'PURCHASE_ORDER',
        'po-1',
        'APPROVE',
        undefined,
        {},
      );
      expect(handled).toBe(true);
      expect(documents.applyOutcome).toHaveBeenCalled();
    });
  });
});
