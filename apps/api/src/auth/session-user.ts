import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/types/auth-request';
import { computeEffectiveAccess } from '../rbac/effective-permissions';

/**
 * Prisma include graph loading everything needed to flatten a user's
 * effective access: roles with their permissions, per-user overrides, and
 * branch access.
 */
export const USER_ACCESS_INCLUDE = {
  userRoles: {
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  },
  permissionOverrides: { include: { permission: true } },
  branchAccess: { select: { branchId: true } },
} satisfies Prisma.UserInclude;

export type UserWithAccess = Prisma.UserGetPayload<{
  include: typeof USER_ACCESS_INCLUDE;
}>;

/** Map the loaded user graph into the AuthUser attached to requests. */
export function buildAuthUser(user: UserWithAccess): AuthUser {
  const access = computeEffectiveAccess(
    user.userRoles.map((userRole) => ({
      code: userRole.role.code,
      isActive: userRole.role.isActive,
      permissions: userRole.role.rolePermissions.map(
        (rolePermission) => rolePermission.permission.code,
      ),
    })),
    user.permissionOverrides.map((override) => ({
      permission: override.permission.code,
      effect: override.effect,
      expiresAt: override.expiresAt,
    })),
  );

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isSuperAdmin: access.isSuperAdmin,
    roles: access.roles,
    permissions: access.permissions,
    branchIds: user.branchAccess.map((entry) => entry.branchId),
    mustChangePassword: user.mustChangePassword,
  };
}
