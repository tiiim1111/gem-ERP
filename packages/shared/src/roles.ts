/**
 * GEM ERP initial system roles (master specification section 8).
 *
 * These seven roles are seeded by @gemerp/database and are flagged `isSystem`,
 * meaning they cannot be deleted and their codes are stable identifiers that
 * application code may rely on.
 */
import { ALL_PERMISSIONS, PERMISSIONS } from './permissions';

export interface RoleDefinition {
  code: string;
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}

const P = PERMISSIONS;

/**
 * Branch Admin: everything a Super Admin can do EXCEPT org-wide/system
 * configuration. Branch scoping itself (which branches the admin manages) is
 * enforced by branch access, not by the permission list.
 */
const BRANCH_ADMIN_EXCLUDED: string[] = [
  // Role catalog and permission assignment are system-level.
  P.role.create,
  P.role.update,
  P.role.managePermissions,
  // Org structure (creating branches, toggling them) is system-level.
  P.branch.create,
  P.branch.activate,
  P.branch.deactivate,
  // System configuration. (approval.manage is deliberately NOT excluded:
  // Phase 6 approval workflows carry a branch scope, and configuring the
  // approval routes of their own branches is branch-admin work.)
  P.settings.manage,
  P.lookup.manage,
  P.notification.manage,
  // Audit log export is reserved for Super Admin / Auditor grants.
  P.audit.export,
];

const BRANCH_ADMIN_PERMISSIONS: string[] = ALL_PERMISSIONS.filter(
  (permission) => !BRANCH_ADMIN_EXCLUDED.includes(permission),
);

const WAREHOUSE_CUSTODIAN_PERMISSIONS: string[] = [
  P.branch.view,
  P.warehouse.view,
  P.storageLocation.view,
  P.item.view,
  P.item.print,
  P.supplier.view,
  P.employee.view,
  P.asset.view,
  P.inventory.view,
  P.inventory.receive,
  P.inventory.issue,
  P.inventory.return,
  P.inventory.transfer,
  P.inventory.adjust,
  P.inventory.submit,
  P.inventory.post,
  P.inventory.cancel,
  P.inventory.export,
  P.procurementPo.view,
  P.procurementReceipt.view,
  P.procurementReceipt.create,
  P.procurementReceipt.update,
  P.procurementReceipt.post,
  P.procurementReceipt.print,
  P.transfer.view,
  P.transfer.create,
  P.transfer.update,
  P.transfer.submit,
  P.transfer.dispatch,
  P.transfer.receive,
  P.transfer.print,
  P.count.view,
  P.count.create,
  P.count.record,
  P.count.recount,
  P.count.export,
  P.count.print,
  P.attachment.view,
  P.attachment.upload,
  P.approval.view,
  P.notification.view,
  P.lookup.view,
  P.report.view,
  P.report.print,
];

const ASSET_CUSTODIAN_PERMISSIONS: string[] = [
  P.branch.view,
  P.warehouse.view,
  P.storageLocation.view,
  P.item.view,
  P.employee.view,
  P.asset.view,
  P.asset.create,
  P.asset.update,
  P.asset.assign,
  P.asset.return,
  P.asset.transfer,
  P.asset.inspect,
  P.asset.retire,
  P.asset.reportIncident,
  P.asset.print,
  P.asset.export,
  P.transfer.view,
  P.transfer.create,
  P.transfer.update,
  P.transfer.submit,
  P.transfer.dispatch,
  P.transfer.receive,
  P.transfer.print,
  P.maintenancePlan.view,
  P.maintenanceWorkOrder.view,
  P.maintenanceWorkOrder.create,
  P.attachment.view,
  P.attachment.upload,
  P.approval.view,
  P.notification.view,
  P.lookup.view,
  P.report.view,
  P.report.print,
];

const MAINTENANCE_PERSONNEL_PERMISSIONS: string[] = [
  P.branch.view,
  P.warehouse.view,
  P.storageLocation.view,
  P.item.view,
  P.asset.view,
  P.maintenancePlan.view,
  P.maintenanceWorkOrder.view,
  P.maintenanceWorkOrder.create,
  P.maintenanceWorkOrder.update,
  P.maintenanceWorkOrder.manage,
  P.maintenanceWorkOrder.complete,
  P.maintenanceWorkOrder.print,
  P.inventory.view,
  P.inventory.issue,
  P.attachment.view,
  P.attachment.upload,
  P.approval.view,
  P.notification.view,
  P.lookup.view,
  P.report.view,
];

/**
 * Auditor / Viewer: strictly read-only — every "*.view" and "*.view_cost"
 * permission in the catalog. Export permissions (report.export, audit.export,
 * resource exports) are intentionally NOT included by default; grant them per
 * deployment policy, as the specification requires export to be separately
 * configurable.
 */
const AUDITOR_PERMISSIONS: string[] = ALL_PERMISSIONS.filter(
  (permission) =>
    permission.endsWith('.view') || permission.endsWith('.view_cost'),
);

const EMPLOYEE_PERMISSIONS: string[] = [
  P.asset.viewOwn,
  P.asset.acknowledge,
  P.asset.reportIncident,
  P.attachment.view,
  P.attachment.upload,
  P.approval.view,
  P.notification.view,
];

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    code: 'SUPER_ADMIN',
    name: 'Super Admin',
    description:
      'Full system and all-branch access, including system configuration. Cannot bypass audit logging.',
    isSystem: true,
    permissions: [...ALL_PERMISSIONS],
  },
  {
    code: 'BRANCH_ADMIN',
    name: 'Branch Admin',
    description:
      'Manages authorized branches only: branch users, warehouses, operations, approvals, and reports. No system-wide configuration.',
    isSystem: true,
    permissions: BRANCH_ADMIN_PERMISSIONS,
  },
  {
    code: 'WAREHOUSE_CUSTODIAN',
    name: 'Warehouse Custodian',
    description:
      'Receives, issues, returns, transfers, counts, and adjusts inventory in authorized warehouses, subject to approval rules.',
    isSystem: true,
    permissions: WAREHOUSE_CUSTODIAN_PERMISSIONS,
  },
  {
    code: 'ASSET_CUSTODIAN',
    name: 'Asset Custodian',
    description:
      'Registers, assigns, transfers, returns, inspects, and retires serialized assets, subject to approval rules.',
    isSystem: true,
    permissions: ASSET_CUSTODIAN_PERMISSIONS,
  },
  {
    code: 'MAINTENANCE_PERSONNEL',
    name: 'Maintenance Personnel',
    description:
      'Views maintainable assets and manages assigned maintenance work orders; may consume approved spare parts through linked stock issues.',
    isSystem: true,
    permissions: MAINTENANCE_PERSONNEL_PERMISSIONS,
  },
  {
    code: 'AUDITOR',
    name: 'Auditor / Viewer',
    description:
      'Read-only access to authorized branches, reports, ledgers, and audit logs. Export permissions are configured separately.',
    isSystem: true,
    permissions: AUDITOR_PERMISSIONS,
  },
  {
    code: 'EMPLOYEE',
    name: 'Employee / Requester',
    description:
      'Views own assigned assets, creates permitted requests, reports damage or loss, and acknowledges issuance or return.',
    isSystem: true,
    permissions: EMPLOYEE_PERMISSIONS,
  },
];

/** Stable system role codes, for use in guards, seeds, and tests. */
export const ROLE_CODES = {
  superAdmin: 'SUPER_ADMIN',
  branchAdmin: 'BRANCH_ADMIN',
  warehouseCustodian: 'WAREHOUSE_CUSTODIAN',
  assetCustodian: 'ASSET_CUSTODIAN',
  maintenancePersonnel: 'MAINTENANCE_PERSONNEL',
  auditor: 'AUDITOR',
  employee: 'EMPLOYEE',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];
