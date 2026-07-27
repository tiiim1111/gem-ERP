import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppException } from '../errors/app.exception';
import type { AuthenticatedRequest, AuthUser } from '../types/auth-request';

/**
 * Injects the authenticated user (AuthUser) into a handler parameter.
 * Throws 401 if the guard did not attach a user (defense in depth).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw AppException.unauthenticated();
    }
    return request.user;
  },
);
