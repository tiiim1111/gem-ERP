import { HttpException } from '@nestjs/common';
import { BranchScopeService } from './branch-scope.service';

describe('BranchScopeService', () => {
  const service = new BranchScopeService();

  const superAdmin = { isSuperAdmin: true, branchIds: [] as string[] };
  const scopedUser = { isSuperAdmin: false, branchIds: ['b1', 'b2'] };

  describe('branchIdsFor', () => {
    it('returns null (unrestricted) for super admins', () => {
      expect(service.branchIdsFor(superAdmin)).toBeNull();
    });

    it('returns the explicit branch list for regular users', () => {
      expect(service.branchIdsFor(scopedUser)).toEqual(['b1', 'b2']);
    });
  });

  describe('assertBranchAccess', () => {
    it('passes for a branch the user can access', () => {
      expect(() => service.assertBranchAccess(scopedUser, 'b1')).not.toThrow();
    });

    it('passes for super admins on any branch', () => {
      expect(() =>
        service.assertBranchAccess(superAdmin, 'anything'),
      ).not.toThrow();
    });

    it('throws 403 FORBIDDEN for an inaccessible branch', () => {
      let caught: unknown;
      try {
        service.assertBranchAccess(scopedUser, 'b3');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HttpException);
      const http = caught as HttpException;
      expect(http.getStatus()).toBe(403);
      expect(
        (http.getResponse() as { error: { code: string } }).error.code,
      ).toBe('FORBIDDEN');
    });

    it('denies by default when the user has no branch access at all', () => {
      expect(() =>
        service.assertBranchAccess({ isSuperAdmin: false, branchIds: [] }, 'b1'),
      ).toThrow(HttpException);
    });
  });

  describe('branchFilter', () => {
    it('returns undefined for super admins (no query restriction)', () => {
      expect(service.branchFilter(superAdmin)).toBeUndefined();
    });

    it('returns an "in" filter for regular users', () => {
      expect(service.branchFilter(scopedUser)).toEqual({ in: ['b1', 'b2'] });
    });

    it('returns an empty "in" filter (matches nothing) with no access', () => {
      expect(
        service.branchFilter({ isSuperAdmin: false, branchIds: [] }),
      ).toEqual({ in: [] });
    });
  });

  describe('canAccess', () => {
    it('reflects membership', () => {
      expect(service.canAccess(scopedUser, 'b2')).toBe(true);
      expect(service.canAccess(scopedUser, 'b9')).toBe(false);
      expect(service.canAccess(superAdmin, 'b9')).toBe(true);
    });
  });
});
