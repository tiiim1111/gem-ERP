import { ROLE_CODES } from '@gemerp/shared';

/** Minimal shapes needed to compute effective access (schema-aligned). */
export interface RoleGrant {
  code: string;
  isActive: boolean;
  permissions: string[];
}

export interface PermissionOverrideGrant {
  permission: string;
  effect: 'ALLOW' | 'DENY';
  expiresAt: Date | null;
}

export interface EffectiveAccess {
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
}

/**
 * Flatten a user's role grants and per-user overrides into the effective
 * permission set.
 *
 * Precedence rules:
 * - Inactive roles grant nothing.
 * - ALLOW overrides add permissions on top of role grants.
 * - DENY overrides remove permissions even when a role grants them
 *   (overrides always beat role membership).
 * - Expired overrides (expiresAt in the past) are ignored entirely.
 * - Super admin status comes from holding the active SUPER_ADMIN role; the
 *   permission list is still computed (super admins bypass permission checks
 *   in the guard, never audit logging).
 */
export function computeEffectiveAccess(
  roles: RoleGrant[],
  overrides: PermissionOverrideGrant[],
  now: Date = new Date(),
): EffectiveAccess {
  const activeRoles = roles.filter((role) => role.isActive);
  const permissions = new Set<string>();
  for (const role of activeRoles) {
    for (const permission of role.permissions) {
      permissions.add(permission);
    }
  }

  const validOverrides = overrides.filter(
    (override) => !override.expiresAt || override.expiresAt.getTime() > now.getTime(),
  );
  for (const override of validOverrides) {
    if (override.effect === 'ALLOW') {
      permissions.add(override.permission);
    }
  }
  for (const override of validOverrides) {
    if (override.effect === 'DENY') {
      permissions.delete(override.permission);
    }
  }

  const roleCodes = activeRoles.map((role) => role.code);
  return {
    roles: roleCodes,
    permissions: [...permissions],
    isSuperAdmin: roleCodes.includes(ROLE_CODES.superAdmin),
  };
}
