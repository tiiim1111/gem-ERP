import { Injectable } from '@nestjs/common';
import type { SessionUser } from '@gemerp/shared';
import { AppException } from '../common/errors/app.exception';

/**
 * Central branch-scoping helper. Authorization is always
 * permission check AND branch-scope check; deny by default.
 *
 * Super admins bypass branch filtering (never audit logging).
 */
@Injectable()
export class BranchScopeService {
  /**
   * Branch IDs the user may access, or `null` meaning "unrestricted"
   * (super admin). An empty array means access to no branches at all.
   */
  branchIdsFor(user: Pick<SessionUser, 'isSuperAdmin' | 'branchIds'>):
    | string[]
    | null {
    return user.isSuperAdmin ? null : user.branchIds;
  }

  canAccess(
    user: Pick<SessionUser, 'isSuperAdmin' | 'branchIds'>,
    branchId: string,
  ): boolean {
    return user.isSuperAdmin || user.branchIds.includes(branchId);
  }

  /**
   * Throws 403 FORBIDDEN when the user lacks access to the branch.
   * Use for explicit `branchId` query/path params (scope violations on a
   * requested branch are a 403; out-of-scope direct record fetches are 404 —
   * the caller decides which situation applies).
   */
  assertBranchAccess(
    user: Pick<SessionUser, 'isSuperAdmin' | 'branchIds'>,
    branchId: string,
  ): void {
    if (!this.canAccess(user, branchId)) {
      throw AppException.forbidden(
        'You do not have access to this branch.',
      );
    }
  }

  /**
   * Prisma `where` fragment restricting a query by a branch-id column.
   * Returns `undefined` for super admins (no restriction).
   */
  branchFilter(
    user: Pick<SessionUser, 'isSuperAdmin' | 'branchIds'>,
  ): { in: string[] } | undefined {
    const ids = this.branchIdsFor(user);
    return ids === null ? undefined : { in: ids };
  }
}
