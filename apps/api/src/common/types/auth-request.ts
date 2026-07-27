import type { Request } from 'express';
import type { SessionUser } from '@gemerp/shared';

/** The authenticated principal attached to every request by SessionAuthGuard. */
export interface AuthUser extends SessionUser {
  /** Whether the user must change their password before normal use. */
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  /** ID of the user_sessions row backing this request. */
  sessionId?: string;
  correlationId?: string;
}

/** Context every audited mutation carries along. */
export interface AuditContext {
  actorUserId?: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
}

export function auditContextFrom(req: AuthenticatedRequest): AuditContext {
  return {
    actorUserId: req.user?.id,
    ip: req.ip,
    userAgent:
      typeof req.headers['user-agent'] === 'string'
        ? req.headers['user-agent'].slice(0, 300)
        : undefined,
    correlationId: req.correlationId,
  };
}
