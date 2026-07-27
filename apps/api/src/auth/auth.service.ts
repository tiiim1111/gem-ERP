import { Injectable } from '@nestjs/common';
import { AppException } from '../common/errors/app.exception';
import type { AuditContext, AuthUser } from '../common/types/auth-request';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { burnTimingNoise, hashPassword, verifyPassword } from './password';
import { SessionService } from './session.service';
import { buildAuthUser, USER_ACCESS_INCLUDE } from './session-user';

/** 5 consecutive failures lock the account for 15 minutes. */
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface LoginResult {
  token: string;
  sessionId: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(
    email: string,
    password: string,
    ctx: AuditContext,
  ): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: USER_ACCESS_INCLUDE,
    });

    if (!user) {
      await burnTimingNoise(password);
      await this.audit.log({
        action: 'auth.login_failed',
        resourceType: 'user',
        metadata: { email: normalizedEmail, reason: 'unknown_email' },
        ...ctx,
      });
      throw AppException.invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      await this.audit.log({
        actor: user.id,
        action: 'auth.login_blocked_locked',
        resourceType: 'user',
        resourceId: user.id,
        ...ctx,
      });
      throw AppException.accountLocked(
        `Account is locked. Try again after ${this.minutesLeft(user.lockedUntil)} minute(s).`,
      );
    }

    if (!user.isActive || user.archivedAt) {
      await burnTimingNoise(password);
      await this.audit.log({
        actor: user.id,
        action: 'auth.login_failed',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { reason: 'inactive_account' },
        ...ctx,
      });
      throw AppException.invalidCredentials();
    }

    const passwordOk = await verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      const failedCount = user.failedLoginCount + 1;
      if (failedCount >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(
          now.getTime() + LOCKOUT_MINUTES * 60 * 1000,
        );
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil },
        });
        await this.audit.log({
          actor: user.id,
          action: 'auth.account_locked',
          resourceType: 'user',
          resourceId: user.id,
          metadata: {
            consecutiveFailures: failedCount,
            lockedUntil: lockedUntil.toISOString(),
          },
          ...ctx,
        });
        throw AppException.accountLocked(
          `Too many failed logins. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        );
      }

      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: failedCount },
      });
      await this.audit.log({
        actor: user.id,
        action: 'auth.login_failed',
        resourceType: 'user',
        resourceId: user.id,
        metadata: { reason: 'wrong_password', consecutiveFailures: failedCount },
        ...ctx,
      });
      throw AppException.invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        lastActivityAt: now,
      },
    });

    const { token, session } = await this.sessions.createSession(
      user.id,
      ctx.ip,
      ctx.userAgent,
    );

    await this.audit.log({
      actor: user.id,
      action: 'auth.login',
      resourceType: 'session',
      resourceId: session.id,
      ...ctx,
    });

    return { token, sessionId: session.id, user: buildAuthUser(user) };
  }

  async logout(userId: string, sessionId: string, ctx: AuditContext): Promise<void> {
    await this.sessions.revokeSession(sessionId);
    await this.audit.log({
      actor: userId,
      action: 'auth.logout',
      resourceType: 'session',
      resourceId: sessionId,
      ...ctx,
    });
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
    ctx: AuditContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw AppException.unauthenticated();
    }
    const currentOk = await verifyPassword(user.passwordHash, currentPassword);
    if (!currentOk) {
      throw AppException.invalidCredentials('Current password is incorrect.');
    }
    if (currentPassword === newPassword) {
      throw AppException.validation([
        {
          field: 'newPassword',
          message: 'New password must differ from the current password.',
        },
      ]);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(newPassword),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
      },
    });

    // Security event: every other session of this user is revoked.
    await this.sessions.revokeAllForUser(userId, currentSessionId);

    await this.audit.log({
      actor: userId,
      action: 'auth.password_changed',
      resourceType: 'user',
      resourceId: userId,
      ...ctx,
    });
  }

  async revokeOwnSession(
    userId: string,
    sessionId: string,
    ctx: AuditContext,
  ): Promise<void> {
    const session = await this.sessions.findOwnSession(userId, sessionId);
    if (!session) {
      throw AppException.notFound('Session not found.');
    }
    await this.sessions.revokeSession(session.id);
    await this.audit.log({
      actor: userId,
      action: 'auth.session_revoked',
      resourceType: 'session',
      resourceId: session.id,
      ...ctx,
    });
  }

  private minutesLeft(until: Date): number {
    return Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  }
}
