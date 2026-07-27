import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasPermission } from '@gemerp/shared';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { REQUIRED_PERMISSIONS_KEY } from '../common/decorators/require-permissions.decorator';
import { AppException } from '../common/errors/app.exception';
import type { AuthenticatedRequest } from '../common/types/auth-request';

/**
 * Global permission guard (runs after SessionAuthGuard).
 *
 * - @Public() routes are skipped.
 * - Routes without @RequirePermissions only require the authenticated session
 *   the previous guard established.
 * - The caller must hold EVERY declared permission.
 * - Super admins bypass permission checks — but never audit logging.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw AppException.unauthenticated();
    }
    if (user.isSuperAdmin) {
      return true;
    }
    if (!hasPermission(user.permissions, required)) {
      throw AppException.forbidden();
    }
    return true;
  }
}
