import type { ExecutionContext } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../common/decorators/require-permissions.decorator';
import type { AuthUser } from '../common/types/auth-request';
import { computeEffectiveAccess } from './effective-permissions';
import { PermissionsGuard } from './permissions.guard';

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    email: 'user@gemcor.dev',
    displayName: 'User',
    isSuperAdmin: false,
    roles: ['WAREHOUSE_CUSTODIAN'],
    permissions: ['inventory.view'],
    branchIds: ['b1'],
    mustChangePassword: false,
    ...overrides,
  };
}

function makeContext(options: {
  user?: AuthUser;
  required?: string[];
  isPublic?: boolean;
}): { context: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) {
        return options.isPublic;
      }
      if (key === REQUIRED_PERMISSIONS_KEY) {
        return options.required;
      }
      return undefined;
    }),
  } as unknown as Reflector;

  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: options.user }),
    }),
  } as unknown as ExecutionContext;

  return { context, reflector };
}

function expectHttpError(
  fn: () => unknown,
  status: number,
  code: string,
): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(HttpException);
  const http = caught as HttpException;
  expect(http.getStatus()).toBe(status);
  expect((http.getResponse() as { error: { code: string } }).error.code).toBe(
    code,
  );
}

describe('PermissionsGuard', () => {
  it('allows @Public routes without any user', () => {
    const { context, reflector } = makeContext({ isPublic: true });
    expect(new PermissionsGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows session-only routes (no @RequirePermissions metadata)', () => {
    const { context, reflector } = makeContext({ user: makeUser() });
    expect(new PermissionsGuard(reflector).canActivate(context)).toBe(true);
  });

  it('allows when the user holds every required permission', () => {
    const { context, reflector } = makeContext({
      user: makeUser({ permissions: ['inventory.view', 'inventory.receive'] }),
      required: ['inventory.view', 'inventory.receive'],
    });
    expect(new PermissionsGuard(reflector).canActivate(context)).toBe(true);
  });

  it('denies (403 FORBIDDEN) when any required permission is missing', () => {
    const { context, reflector } = makeContext({
      user: makeUser({ permissions: ['inventory.view'] }),
      required: ['inventory.view', 'inventory.adjust'],
    });
    expectHttpError(
      () => new PermissionsGuard(reflector).canActivate(context),
      403,
      'FORBIDDEN',
    );
  });

  it('returns 401 UNAUTHENTICATED when no user was attached', () => {
    const { context, reflector } = makeContext({
      required: ['inventory.view'],
    });
    expectHttpError(
      () => new PermissionsGuard(reflector).canActivate(context),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('super admin bypasses permission checks entirely', () => {
    const { context, reflector } = makeContext({
      user: makeUser({ isSuperAdmin: true, permissions: [] }),
      required: ['settings.manage', 'audit.export'],
    });
    expect(new PermissionsGuard(reflector).canActivate(context)).toBe(true);
  });

  it('a DENY override revokes a role-granted permission through the guard', () => {
    const access = computeEffectiveAccess(
      [
        {
          code: 'WAREHOUSE_CUSTODIAN',
          isActive: true,
          permissions: ['inventory.view', 'inventory.adjust'],
        },
      ],
      [{ permission: 'inventory.adjust', effect: 'DENY', expiresAt: null }],
    );
    const { context, reflector } = makeContext({
      user: makeUser({ permissions: access.permissions }),
      required: ['inventory.adjust'],
    });
    expectHttpError(
      () => new PermissionsGuard(reflector).canActivate(context),
      403,
      'FORBIDDEN',
    );
  });

  it('an ALLOW override grants access the roles alone would deny', () => {
    const access = computeEffectiveAccess(
      [{ code: 'EMPLOYEE', isActive: true, permissions: ['asset.view_own'] }],
      [{ permission: 'audit.view', effect: 'ALLOW', expiresAt: null }],
    );
    const { context, reflector } = makeContext({
      user: makeUser({ permissions: access.permissions }),
      required: ['audit.view'],
    });
    expect(new PermissionsGuard(reflector).canActivate(context)).toBe(true);
  });
});
