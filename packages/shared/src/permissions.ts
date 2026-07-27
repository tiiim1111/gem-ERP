/**
 * GEM ERP permission catalog.
 *
 * Permission strings use dot notation "resource.action" exactly as defined in
 * the master specification (section 8), e.g. "asset.view", "inventory.receive",
 * "procurement.po.create". This catalog is the single source of truth: the API
 * seeds the permissions table from it, guards check against it, and the web app
 * gates UI from it.
 *
 * Conventions:
 * - Resource segments are singular and snake_case ("storage_location.view").
 * - Procurement and maintenance use a sub-resource segment
 *   ("procurement.po.create", "maintenance.work_order.manage").
 * - "view_cost" grants visibility of monetary values on an otherwise viewable
 *   resource. "view_own" restricts to records the user is the subject of
 *   (employee self-service).
 */
export const PERMISSIONS = {
  asset: {
    view: 'asset.view',
    /** View only assets assigned to the current user (employee self-service). */
    viewOwn: 'asset.view_own',
    /** See acquisition cost / value fields on assets. */
    viewCost: 'asset.view_cost',
    create: 'asset.create',
    update: 'asset.update',
    assign: 'asset.assign',
    return: 'asset.return',
    transfer: 'asset.transfer',
    inspect: 'asset.inspect',
    /** Acknowledge issuance or return of an asset assigned to the user. */
    acknowledge: 'asset.acknowledge',
    /** Report/declare an asset lost or damaged. */
    reportIncident: 'asset.report_incident',
    retire: 'asset.retire',
    dispose: 'asset.dispose',
    archive: 'asset.archive',
    export: 'asset.export',
    print: 'asset.print',
  },
  inventory: {
    view: 'inventory.view',
    /** See unit/total cost fields on stock transactions and valuations. */
    viewCost: 'inventory.view_cost',
    receive: 'inventory.receive',
    issue: 'inventory.issue',
    return: 'inventory.return',
    transfer: 'inventory.transfer',
    adjust: 'inventory.adjust',
    /** Submit a draft stock transaction for approval. */
    submit: 'inventory.submit',
    /** Post an approved/draft stock transaction to the ledger. */
    post: 'inventory.post',
    cancel: 'inventory.cancel',
    reverse: 'inventory.reverse',
    export: 'inventory.export',
  },
  item: {
    view: 'item.view',
    /** See standard/last purchase cost on catalog items. */
    viewCost: 'item.view_cost',
    create: 'item.create',
    update: 'item.update',
    archive: 'item.archive',
    import: 'item.import',
    export: 'item.export',
    /** Print SKU / lot / bin labels. */
    print: 'item.print',
  },
  employee: {
    view: 'employee.view',
    /** View restricted-visibility employee notes. */
    viewNotes: 'employee.view_notes',
    create: 'employee.create',
    update: 'employee.update',
    archive: 'employee.archive',
    import: 'employee.import',
    export: 'employee.export',
  },
  user: {
    view: 'user.view',
    create: 'user.create',
    update: 'user.update',
    activate: 'user.activate',
    deactivate: 'user.deactivate',
    manageRoles: 'user.manage_roles',
    manageBranchAccess: 'user.manage_branch_access',
    resetPassword: 'user.reset_password',
  },
  role: {
    view: 'role.view',
    create: 'role.create',
    update: 'role.update',
    managePermissions: 'role.manage_permissions',
  },
  branch: {
    view: 'branch.view',
    create: 'branch.create',
    update: 'branch.update',
    activate: 'branch.activate',
    deactivate: 'branch.deactivate',
  },
  warehouse: {
    view: 'warehouse.view',
    create: 'warehouse.create',
    update: 'warehouse.update',
  },
  storageLocation: {
    view: 'storage_location.view',
    create: 'storage_location.create',
    update: 'storage_location.update',
  },
  supplier: {
    view: 'supplier.view',
    create: 'supplier.create',
    update: 'supplier.update',
    archive: 'supplier.archive',
    import: 'supplier.import',
    export: 'supplier.export',
  },
  procurementPo: {
    view: 'procurement.po.view',
    /** See prices, discounts, taxes, and totals on purchase orders. */
    viewCost: 'procurement.po.view_cost',
    create: 'procurement.po.create',
    update: 'procurement.po.update',
    submit: 'procurement.po.submit',
    approve: 'procurement.po.approve',
    reject: 'procurement.po.reject',
    cancel: 'procurement.po.cancel',
    close: 'procurement.po.close',
    export: 'procurement.po.export',
    print: 'procurement.po.print',
  },
  procurementReceipt: {
    view: 'procurement.receipt.view',
    create: 'procurement.receipt.create',
    update: 'procurement.receipt.update',
    post: 'procurement.receipt.post',
    cancel: 'procurement.receipt.cancel',
    reverse: 'procurement.receipt.reverse',
    export: 'procurement.receipt.export',
    print: 'procurement.receipt.print',
  },
  transfer: {
    view: 'transfer.view',
    create: 'transfer.create',
    update: 'transfer.update',
    submit: 'transfer.submit',
    approve: 'transfer.approve',
    reject: 'transfer.reject',
    dispatch: 'transfer.dispatch',
    receive: 'transfer.receive',
    cancel: 'transfer.cancel',
    export: 'transfer.export',
    print: 'transfer.print',
  },
  count: {
    view: 'count.view',
    create: 'count.create',
    /** Enter/scan counted quantities on an open count session. */
    record: 'count.record',
    recount: 'count.recount',
    /** Approve count variances (creates adjustment transactions). */
    approve: 'count.approve',
    cancel: 'count.cancel',
    export: 'count.export',
    print: 'count.print',
  },
  maintenancePlan: {
    view: 'maintenance.plan.view',
    create: 'maintenance.plan.create',
    update: 'maintenance.plan.update',
    archive: 'maintenance.plan.archive',
  },
  maintenanceWorkOrder: {
    view: 'maintenance.work_order.view',
    /** See labor, parts, and external-service costs on work orders. */
    viewCost: 'maintenance.work_order.view_cost',
    create: 'maintenance.work_order.create',
    update: 'maintenance.work_order.update',
    assign: 'maintenance.work_order.assign',
    /** Manage the work-order lifecycle (schedule, hold, progress, parts). */
    manage: 'maintenance.work_order.manage',
    complete: 'maintenance.work_order.complete',
    verify: 'maintenance.work_order.verify',
    cancel: 'maintenance.work_order.cancel',
    export: 'maintenance.work_order.export',
    print: 'maintenance.work_order.print',
  },
  approval: {
    /** View approval requests and their history. */
    view: 'approval.view',
    /** Act (approve/reject/return) on approval requests assigned to the user. */
    act: 'approval.act',
    /** Delegate own approval authority for a date range. */
    delegate: 'approval.delegate',
    /** Configure approval workflows, steps, and thresholds. */
    manage: 'approval.manage',
  },
  notification: {
    view: 'notification.view',
    /** Configure notification recipient rules and alert settings. */
    manage: 'notification.manage',
  },
  attachment: {
    view: 'attachment.view',
    upload: 'attachment.upload',
    archive: 'attachment.archive',
  },
  report: {
    view: 'report.view',
    export: 'report.export',
    print: 'report.print',
  },
  audit: {
    view: 'audit.view',
    export: 'audit.export',
  },
  settings: {
    manage: 'settings.manage',
  },
  lookup: {
    view: 'lookup.view',
    manage: 'lookup.manage',
  },
} as const;

type PermissionMap = typeof PERMISSIONS;

/** Union of every permission string in the catalog. */
export type Permission = {
  [G in keyof PermissionMap]: PermissionMap[G][keyof PermissionMap[G]];
}[keyof PermissionMap];

/** Every permission string in the catalog, in catalog order, de-duplicated. */
export const ALL_PERMISSIONS: string[] = Array.from(
  new Set(
    Object.values(PERMISSIONS).flatMap((group) =>
      Object.values(group as Record<string, string>),
    ),
  ),
);

/**
 * Check whether a set of granted permissions satisfies a requirement.
 *
 * - `required` as a string: the user must hold that exact permission.
 * - `required` as an array: the user must hold EVERY listed permission.
 *
 * Note: super-admin bypass is a caller concern (check `SessionUser.isSuperAdmin`
 * before consulting granted permissions); this helper performs no wildcarding.
 */
export function hasPermission(
  userPerms: readonly string[],
  required: string | readonly string[],
): boolean {
  if (typeof required === 'string') {
    return userPerms.includes(required);
  }
  if (required.length === 0) {
    return true;
  }
  const granted = new Set(userPerms);
  return required.every((permission) => granted.has(permission));
}

/**
 * Check whether the user holds at least one of the listed permissions.
 */
export function hasAnyPermission(
  userPerms: readonly string[],
  required: readonly string[],
): boolean {
  const granted = new Set(userPerms);
  return required.some((permission) => granted.has(permission));
}
