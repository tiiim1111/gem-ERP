import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'gemerp:isPublic';

/**
 * Marks a route (or controller) as publicly accessible: the global
 * SessionAuthGuard and PermissionsGuard skip it. Used only by login and the
 * health endpoints.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
