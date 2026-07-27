import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { AppException } from '../common/errors/app.exception';
import type { AuthenticatedRequest } from '../common/types/auth-request';
import { AppConfigService } from '../config/app-config.service';
import { SessionService } from './session.service';
import { buildAuthUser } from './session-user';

/**
 * Global session guard: resolves the `gemerp_session` cookie to a live
 * session, refreshes the sliding expiry, and attaches the flattened AuthUser
 * (roles, effective permissions, branch IDs) to the request. Missing or
 * expired sessions yield 401 UNAUTHENTICATED. Routes opt out with @Public().
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = (request as { cookies?: Record<string, string> }).cookies;
    const token = cookies?.[this.config.sessionCookieName];
    if (!token || typeof token !== 'string') {
      throw AppException.unauthenticated();
    }

    const resolved = await this.sessions.resolveSession(token);
    if (!resolved) {
      throw AppException.unauthenticated('Session is invalid or has expired.');
    }

    request.user = buildAuthUser(resolved.user);
    request.sessionId = resolved.session.id;
    return true;
  }
}
