import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'gemerp:requiredPermissions';

/**
 * Declares the permission strings a route requires. The caller must hold
 * EVERY listed permission (super admins bypass the check, never the audit
 * trail). Routes without this decorator only require an authenticated
 * session — business endpoints must always declare their permissions.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
