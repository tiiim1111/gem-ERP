import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { AuthService, LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from './auth.service';
import { hashPassword } from './password';
import { SessionService } from './session.service';

const PASSWORD = 'Correct#Horse1';

interface UserFixtureOverrides {
  failedLoginCount?: number;
  lockedUntil?: Date | null;
  isActive?: boolean;
  passwordHash?: string;
}

describe('AuthService (lockout counting, session hashing)', () => {
  let passwordHash: string;
  let prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
  };
  let sessions: {
    createSession: jest.Mock;
    revokeAllForUser: jest.Mock;
    revokeSession: jest.Mock;
    findOwnSession: jest.Mock;
  };
  let audit: { log: jest.Mock };
  let service: AuthService;

  const ctx = { ip: '127.0.0.1', userAgent: 'jest', correlationId: 'test-req' };

  beforeAll(async () => {
    passwordHash = await hashPassword(PASSWORD);
  });

  function userFixture(overrides: UserFixtureOverrides = {}) {
    return {
      id: 'user-1',
      email: 'user@gemcor.dev',
      displayName: 'Test User',
      passwordHash: overrides.passwordHash ?? passwordHash,
      isActive: overrides.isActive ?? true,
      archivedAt: null,
      failedLoginCount: overrides.failedLoginCount ?? 0,
      lockedUntil: overrides.lockedUntil ?? null,
      mustChangePassword: false,
      userRoles: [
        {
          role: {
            code: 'WAREHOUSE_CUSTODIAN',
            isActive: true,
            rolePermissions: [{ permission: { code: 'inventory.view' } }],
          },
        },
      ],
      permissionOverrides: [],
      branchAccess: [{ branchId: 'branch-1' }],
    };
  }

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    sessions = {
      createSession: jest.fn().mockResolvedValue({
        token: 'raw-token',
        session: { id: 'session-1' },
      }),
      revokeAllForUser: jest.fn().mockResolvedValue(1),
      revokeSession: jest.fn().mockResolvedValue(undefined),
      findOwnSession: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new AuthService(
      prisma as never,
      sessions as unknown as SessionService,
      audit as never,
    );
  });

  async function expectHttpError(
    promise: Promise<unknown>,
    status: number,
    code: string,
  ): Promise<void> {
    let caught: unknown;
    try {
      await promise;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpException);
    const http = caught as HttpException;
    expect(http.getStatus()).toBe(status);
    expect(
      (http.getResponse() as { error: { code: string } }).error.code,
    ).toBe(code);
  }

  it('logs in with correct credentials, resets counters, creates a session', async () => {
    prisma.user.findUnique.mockResolvedValue(
      userFixture({ failedLoginCount: 3 }),
    );

    const result = await service.login('user@gemcor.dev', PASSWORD, ctx);

    expect(result.token).toBe('raw-token');
    expect(result.user.permissions).toContain('inventory.view');
    expect(result.user.branchIds).toEqual(['branch-1']);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({ failedLoginCount: 0, lockedUntil: null }),
      }),
    );
    expect(sessions.createSession).toHaveBeenCalledWith(
      'user-1',
      ctx.ip,
      ctx.userAgent,
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login', actor: 'user-1' }),
    );
  });

  it('rejects an unknown email with 401 INVALID_CREDENTIALS', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expectHttpError(
      service.login('ghost@gemcor.dev', PASSWORD, ctx),
      401,
      'INVALID_CREDENTIALS',
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login_failed' }),
    );
  });

  it('increments the failure counter on a wrong password', async () => {
    prisma.user.findUnique.mockResolvedValue(
      userFixture({ failedLoginCount: 1 }),
    );
    await expectHttpError(
      service.login('user@gemcor.dev', 'WrongPassword!', ctx),
      401,
      'INVALID_CREDENTIALS',
    );
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginCount: 2 },
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login_failed',
        actor: 'user-1',
      }),
    );
  });

  it(`locks the account on failure #${MAX_FAILED_LOGINS} for ${LOCKOUT_MINUTES} minutes`, async () => {
    prisma.user.findUnique.mockResolvedValue(
      userFixture({ failedLoginCount: MAX_FAILED_LOGINS - 1 }),
    );
    const before = Date.now();
    await expectHttpError(
      service.login('user@gemcor.dev', 'WrongPassword!', ctx),
      423,
      'ACCOUNT_LOCKED',
    );

    const updateArgs = prisma.user.update.mock.calls[0][0];
    expect(updateArgs.data.failedLoginCount).toBe(0);
    const lockedUntil: Date = updateArgs.data.lockedUntil;
    const expectedMs = before + LOCKOUT_MINUTES * 60 * 1000;
    expect(lockedUntil.getTime()).toBeGreaterThanOrEqual(expectedMs - 5000);
    expect(lockedUntil.getTime()).toBeLessThanOrEqual(expectedMs + 5000);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.account_locked' }),
    );
  });

  it('rejects logins while locked, even with the correct password', async () => {
    prisma.user.findUnique.mockResolvedValue(
      userFixture({ lockedUntil: new Date(Date.now() + 5 * 60 * 1000) }),
    );
    await expectHttpError(
      service.login('user@gemcor.dev', PASSWORD, ctx),
      423,
      'ACCOUNT_LOCKED',
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(sessions.createSession).not.toHaveBeenCalled();
  });

  it('rejects inactive users with 401 (no account-state leak)', async () => {
    prisma.user.findUnique.mockResolvedValue(userFixture({ isActive: false }));
    await expectHttpError(
      service.login('user@gemcor.dev', PASSWORD, ctx),
      401,
      'INVALID_CREDENTIALS',
    );
  });

  describe('changePassword', () => {
    it('rehashes, clears mustChangePassword, and revokes other sessions', async () => {
      prisma.user.findUnique.mockResolvedValue(userFixture());
      await service.changePassword(
        'user-1',
        'session-1',
        PASSWORD,
        'NewPassword#42',
        ctx,
      );

      const updateArgs = prisma.user.update.mock.calls[0][0];
      expect(updateArgs.where).toEqual({ id: 'user-1' });
      expect(updateArgs.data.mustChangePassword).toBe(false);
      expect(typeof updateArgs.data.passwordHash).toBe('string');
      expect(updateArgs.data.passwordHash).not.toBe(passwordHash);
      expect(updateArgs.data.passwordHash).not.toContain('NewPassword#42');

      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        'session-1',
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.password_changed' }),
      );
    });

    it('rejects a wrong current password', async () => {
      prisma.user.findUnique.mockResolvedValue(userFixture());
      await expectHttpError(
        service.changePassword('user-1', 's1', 'Nope!', 'NewPassword#42', ctx),
        401,
        'INVALID_CREDENTIALS',
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});

describe('SessionService token hashing', () => {
  it('stores only the SHA-256 hash of the opaque token', async () => {
    const prisma = {
      userSession: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'session-1', ...data }),
        ),
      },
    };
    const config = { sessionTtlMs: 12 * 60 * 60 * 1000 };
    const service = new SessionService(prisma as never, config as never);

    const before = Date.now();
    const { token, session } = await service.createSession(
      'user-1',
      '10.0.0.1',
      'jest-agent',
    );

    const storedData = prisma.userSession.create.mock.calls[0][0].data;
    const expectedHash = createHash('sha256').update(token).digest('hex');

    // The raw token never touches the database.
    expect(storedData.tokenHash).toBe(expectedHash);
    expect(storedData.tokenHash).not.toBe(token);
    expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits base64url
    expect(storedData.userId).toBe('user-1');

    // Sliding TTL applied.
    const expiresAt: Date = storedData.expiresAt;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + config.sessionTtlMs - 5000,
    );
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + config.sessionTtlMs + 5000,
    );
    expect(session.id).toBe('session-1');
  });

  it('generates unique tokens per session', async () => {
    const prisma = {
      userSession: {
        create: jest.fn().mockResolvedValue({ id: 's' }),
      },
    };
    const service = new SessionService(
      prisma as never,
      { sessionTtlMs: 1000 } as never,
    );
    const first = await service.createSession('u');
    const second = await service.createSession('u');
    expect(first.token).not.toBe(second.token);
  });
});
