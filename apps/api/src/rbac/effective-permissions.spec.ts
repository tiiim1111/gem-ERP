import { computeEffectiveAccess } from './effective-permissions';

describe('computeEffectiveAccess', () => {
  const role = (code: string, permissions: string[], isActive = true) => ({
    code,
    isActive,
    permissions,
  });

  it('unions permissions across active roles', () => {
    const access = computeEffectiveAccess(
      [
        role('A', ['asset.view', 'asset.create']),
        role('B', ['asset.view', 'inventory.view']),
      ],
      [],
    );
    expect(access.permissions.sort()).toEqual([
      'asset.create',
      'asset.view',
      'inventory.view',
    ]);
    expect(access.roles.sort()).toEqual(['A', 'B']);
    expect(access.isSuperAdmin).toBe(false);
  });

  it('ignores inactive roles entirely', () => {
    const access = computeEffectiveAccess(
      [role('A', ['asset.view'], false), role('B', ['inventory.view'])],
      [],
    );
    expect(access.permissions).toEqual(['inventory.view']);
    expect(access.roles).toEqual(['B']);
  });

  it('ALLOW override grants a permission no role provides', () => {
    const access = computeEffectiveAccess(
      [role('A', ['asset.view'])],
      [{ permission: 'audit.view', effect: 'ALLOW', expiresAt: null }],
    );
    expect(access.permissions).toContain('audit.view');
  });

  it('DENY override revokes a role-granted permission (override precedence)', () => {
    const access = computeEffectiveAccess(
      [role('A', ['asset.view', 'asset.create'])],
      [{ permission: 'asset.create', effect: 'DENY', expiresAt: null }],
    );
    expect(access.permissions).toContain('asset.view');
    expect(access.permissions).not.toContain('asset.create');
  });

  it('expired overrides are ignored in both directions', () => {
    const past = new Date(Date.now() - 60_000);
    const access = computeEffectiveAccess(
      [role('A', ['asset.view'])],
      [
        { permission: 'asset.view', effect: 'DENY', expiresAt: past },
        { permission: 'audit.view', effect: 'ALLOW', expiresAt: past },
      ],
    );
    expect(access.permissions).toContain('asset.view');
    expect(access.permissions).not.toContain('audit.view');
  });

  it('non-expired overrides are honored', () => {
    const future = new Date(Date.now() + 60_000);
    const access = computeEffectiveAccess(
      [role('A', ['asset.view'])],
      [{ permission: 'asset.view', effect: 'DENY', expiresAt: future }],
    );
    expect(access.permissions).not.toContain('asset.view');
  });

  it('detects super admin from the active SUPER_ADMIN role', () => {
    expect(
      computeEffectiveAccess([role('SUPER_ADMIN', [])], []).isSuperAdmin,
    ).toBe(true);
    expect(
      computeEffectiveAccess([role('SUPER_ADMIN', [], false)], []).isSuperAdmin,
    ).toBe(false);
  });
});
