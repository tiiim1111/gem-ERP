import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { UserSession } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  USER_ACCESS_INCLUDE,
  UserWithAccess,
} from './session-user';

/** Refresh the sliding expiry at most this often (avoids a write per request). */
const REFRESH_MIN_INTERVAL_MS = 60_000;

export interface ResolvedSession {
  session: UserSession;
  user: UserWithAccess;
}

export interface SessionView {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/**
 * Server-side cookie sessions. Only the SHA-256 hash of the opaque 256-bit
 * token is ever stored or compared — the raw token exists solely in the
 * HTTP-only cookie. 12-hour sliding expiry (configurable).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async createSession(
    userId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ token: string; session: UserSession }> {
    const token = randomBytes(32).toString('base64url');
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash: this.hashToken(token),
        ipAddress: ip ?? null,
        userAgent: userAgent ?? null,
        expiresAt: new Date(Date.now() + this.config.sessionTtlMs),
      },
    });
    return { token, session };
  }

  /**
   * Validate a raw cookie token: session must exist, be unrevoked and
   * unexpired, and belong to an active, unarchived user. Refreshes the
   * sliding expiry (throttled) on success.
   */
  async resolveSession(token: string): Promise<ResolvedSession | null> {
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { user: { include: USER_ACCESS_INCLUDE } },
    });
    if (!session || session.revokedAt) {
      return null;
    }
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) {
      return null;
    }
    const user = session.user;
    if (!user.isActive || user.archivedAt) {
      return null;
    }

    if (now - session.lastSeenAt.getTime() > REFRESH_MIN_INTERVAL_MS) {
      const refreshedAt = new Date(now);
      await Promise.all([
        this.prisma.userSession.update({
          where: { id: session.id },
          data: {
            lastSeenAt: refreshedAt,
            expiresAt: new Date(now + this.config.sessionTtlMs),
          },
        }),
        this.prisma.user.update({
          where: { id: user.id },
          data: { lastActivityAt: refreshedAt },
        }),
      ]);
    }

    return { session, user };
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoke every active session of a user, optionally sparing one. */
  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async listForUser(
    userId: string,
    currentSessionId: string,
  ): Promise<SessionView[]> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      ip: session.ipAddress,
      userAgent: session.userAgent,
      current: session.id === currentSessionId,
    }));
  }

  /** Find one of the user's own sessions (for targeted revocation). */
  async findOwnSession(
    userId: string,
    sessionId: string,
  ): Promise<UserSession | null> {
    return this.prisma.userSession.findFirst({
      where: { id: sessionId, userId },
    });
  }
}
