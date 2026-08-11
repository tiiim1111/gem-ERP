import { PERMISSIONS } from '@gemerp/shared';
import {
  effectiveBranchIds,
  getReportDefinition,
  REPORT_KEYS,
  REPORT_REGISTRY,
  validateReportFilters,
} from '@gemerp/reports';
import { canRunReport, includeCostColumns, runnableReports } from './report-access';

/**
 * Registry integrity + permission/branch-scope enforcement (implementation
 * plan Phase 7 verification: auditor sees, employee-role does not, and a
 * SUB-scoped user can never widen visibility into MKT).
 */

const CONTRACT_KEYS = [
  'asset-register',
  'asset-custody',
  'asset-movements',
  'asset-condition',
  'asset-terminal',
  'stock-on-hand',
  'stock-movement',
  'low-stock',
  'consumption',
  'expiring-lots',
  'count-variance',
  'transfer-status',
  'supplier-purchases',
  'po-status',
  'maintenance-summary',
  'audit-activity',
];

const auditor = {
  isSuperAdmin: false,
  // Mirrors the AUDITOR role: every *.view / *.view_cost string.
  permissions: [
    PERMISSIONS.asset.view,
    PERMISSIONS.asset.viewCost,
    PERMISSIONS.inventory.view,
    PERMISSIONS.inventory.viewCost,
    PERMISSIONS.count.view,
    PERMISSIONS.transfer.view,
    PERMISSIONS.procurementPo.view,
    PERMISSIONS.procurementPo.viewCost,
    PERMISSIONS.maintenanceWorkOrder.view,
    PERMISSIONS.maintenanceWorkOrder.viewCost,
    PERMISSIONS.audit.view,
    PERMISSIONS.report.view,
  ],
};

const employee = {
  isSuperAdmin: false,
  // EMPLOYEE role has no report-underlying permissions at all.
  permissions: [PERMISSIONS.asset.viewOwn, PERMISSIONS.notification.view],
};

const superAdmin = { isSuperAdmin: true, permissions: [] };

describe('report registry (api-outline §8 contract table)', () => {
  it('contains exactly the 16 contract reports, in order', () => {
    expect([...REPORT_KEYS]).toEqual(CONTRACT_KEYS);
    expect(REPORT_REGISTRY.size).toBe(16);
  });

  it('every definition declares a permission, columns, and a runner', () => {
    for (const definition of REPORT_REGISTRY.values()) {
      expect(definition.permission).toMatch(/^[a-z_.]+\.[a-z_]+$/);
      expect(definition.columns.length).toBeGreaterThan(0);
      expect(typeof definition.run).toBe('function');
      expect(definition.title.length).toBeGreaterThan(0);
      const columnKeys = definition.columns.map((column) => column.key);
      expect(new Set(columnKeys).size).toBe(columnKeys.length);
    }
  });

  it('cost columns exist only on reports that declare a costPermission', () => {
    for (const definition of REPORT_REGISTRY.values()) {
      const costColumns = definition.columns.filter((column) => column.cost);
      if (definition.costPermission) {
        expect(costColumns.length).toBeGreaterThan(0);
      } else {
        expect(costColumns).toHaveLength(0);
      }
    }
  });

  it('reports supporting a status filter declare their allowed values', () => {
    for (const definition of REPORT_REGISTRY.values()) {
      if (definition.filters.includes('status')) {
        expect(definition.statusOptions?.length).toBeGreaterThan(0);
      } else {
        expect(definition.statusOptions).toBeUndefined();
      }
    }
  });
});

describe('permission enforcement (report.view + underlying permission)', () => {
  it('the auditor can run every report; the employee can run none', () => {
    expect(runnableReports(auditor).map((d) => d.key)).toEqual(CONTRACT_KEYS);
    expect(runnableReports(employee)).toHaveLength(0);
  });

  it('super admin bypasses permission checks', () => {
    expect(runnableReports(superAdmin).map((d) => d.key)).toEqual(CONTRACT_KEYS);
  });

  it('a single underlying permission unlocks only its reports', () => {
    const inventoryOnly = {
      isSuperAdmin: false,
      permissions: [PERMISSIONS.report.view, PERMISSIONS.inventory.view],
    };
    expect(runnableReports(inventoryOnly).map((d) => d.key)).toEqual([
      'stock-on-hand',
      'stock-movement',
      'low-stock',
      'consumption',
      'expiring-lots',
    ]);
  });

  it('cost columns require the matching *.view_cost permission', () => {
    const register = getReportDefinition('asset-register');
    if (!register) {
      throw new Error('asset-register missing');
    }
    const viewerNoCost = {
      isSuperAdmin: false,
      permissions: [PERMISSIONS.asset.view],
    };
    expect(includeCostColumns(viewerNoCost, register)).toBe(false);
    expect(includeCostColumns(auditor, register)).toBe(true);
    expect(includeCostColumns(superAdmin, register)).toBe(true);
    // Reports with no cost columns never include cost, even for super admin.
    const custody = getReportDefinition('asset-custody');
    if (!custody) {
      throw new Error('asset-custody missing');
    }
    expect(includeCostColumns(superAdmin, custody)).toBe(false);
    expect(canRunReport(viewerNoCost, register)).toBe(true);
    expect(canRunReport(employee, register)).toBe(false);
  });
});

describe('branch scoping (a SUB user never widens into MKT)', () => {
  const sub = 'branch-sub';
  const mkt = 'branch-mkt';

  it('scoped user without explicit filter keeps their own branches', () => {
    expect(
      effectiveBranchIds({
        branchIds: [sub],
        filters: {},
        includeCost: false,
        skip: 0,
        take: 25,
      }),
    ).toEqual([sub]);
  });

  it('an explicit in-scope branchId narrows the restriction', () => {
    expect(
      effectiveBranchIds({
        branchIds: [sub, mkt],
        filters: { branchId: mkt },
        includeCost: false,
        skip: 0,
        take: 25,
      }),
    ).toEqual([mkt]);
  });

  it('an out-of-scope branchId collapses to NO branches — never a wider set', () => {
    expect(
      effectiveBranchIds({
        branchIds: [sub],
        filters: { branchId: mkt },
        includeCost: false,
        skip: 0,
        take: 25,
      }),
    ).toEqual([]);
  });

  it('super admin (null scope) is unrestricted, narrowed by explicit filter', () => {
    expect(
      effectiveBranchIds({
        branchIds: null,
        filters: {},
        includeCost: false,
        skip: 0,
        take: 25,
      }),
    ).toBeNull();
    expect(
      effectiveBranchIds({
        branchIds: null,
        filters: { branchId: mkt },
        includeCost: false,
        skip: 0,
        take: 25,
      }),
    ).toEqual([mkt]);
  });
});

describe('filter validation (§1.4 — unsupported filters are rejected, never ignored)', () => {
  const register = getReportDefinition('asset-register');
  const audit = getReportDefinition('audit-activity');
  if (!register || !audit) {
    throw new Error('definitions missing');
  }

  it('accepts supported filters with valid values', () => {
    expect(
      validateReportFilters(register, {
        branchId: '3f0e8a4e-6f4e-4d0d-9a3f-2b1c5d6e7f80',
        status: 'AVAILABLE',
        from: '2026-01-01',
        to: '2026-06-30',
      }),
    ).toEqual([]);
  });

  it('rejects filters the report does not support', () => {
    const errors = validateReportFilters(audit, {
      supplierId: '3f0e8a4e-6f4e-4d0d-9a3f-2b1c5d6e7f80',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('supplierId');
    expect(errors[0].message).toContain('does not support');
  });

  it('rejects malformed UUIDs, dates, and unknown status values', () => {
    expect(
      validateReportFilters(register, { branchId: 'not-a-uuid' }),
    ).toHaveLength(1);
    expect(validateReportFilters(register, { from: 'yesterday' })).toHaveLength(1);
    expect(
      validateReportFilters(register, { status: 'NOT_A_STATUS' }),
    ).toHaveLength(1);
  });
});
