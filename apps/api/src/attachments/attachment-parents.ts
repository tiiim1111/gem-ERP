import { PERMISSIONS } from '@gemerp/shared';

/**
 * Registry of resources that may own attachments (api-outline §4.6, spec §23):
 * assets, items, employees, suppliers, purchase orders, goods receipts,
 * maintenance work orders, transfers, asset assignments, and stock
 * transactions (adjustments/disposals).
 *
 * `resourceType` values match the audit-log resource_type strings so one
 * vocabulary describes a record everywhere.
 *
 * Authorization contract per parent:
 *  - list/download need ANY of `viewPermissions` (+ branch scope of the record),
 *  - upload/archive need ANY of `updatePermissions` (+ branch scope).
 * Super admins bypass permission checks, never branch/audit bookkeeping.
 */
export interface AttachmentParentRow {
  id: string;
  /** Branch ids that scope the record; empty = global resource. */
  branchIds: string[];
  /** Short human-readable identifier (asset tag, PO number, ...). */
  label: string;
}

export interface AttachmentParentConfig {
  resourceType: string;
  /** Prisma model delegate name (prisma[delegate].findUnique). */
  delegate: string;
  viewPermissions: readonly string[];
  updatePermissions: readonly string[];
  /** Columns to fetch for authorization + labeling. */
  select: Record<string, unknown>;
  /** Normalize the fetched row into id/branchIds/label. */
  toParentRow(row: Record<string, unknown>): AttachmentParentRow;
}

const P = PERMISSIONS;

function scalar(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

export const ATTACHMENT_PARENTS: Record<string, AttachmentParentConfig> = {
  asset: {
    resourceType: 'asset',
    delegate: 'asset',
    viewPermissions: [P.asset.view],
    updatePermissions: [P.asset.update],
    select: { id: true, branchId: true, assetTag: true },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [scalar(row, 'branchId')],
      label: scalar(row, 'assetTag'),
    }),
  },
  item: {
    resourceType: 'item',
    delegate: 'item',
    viewPermissions: [P.item.view],
    updatePermissions: [P.item.update],
    select: { id: true, sku: true },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [],
      label: scalar(row, 'sku'),
    }),
  },
  employee: {
    resourceType: 'employee',
    delegate: 'employee',
    viewPermissions: [P.employee.view],
    updatePermissions: [P.employee.update],
    select: { id: true, branchId: true, employeeNumber: true },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [scalar(row, 'branchId')],
      label: scalar(row, 'employeeNumber'),
    }),
  },
  supplier: {
    resourceType: 'supplier',
    delegate: 'supplier',
    viewPermissions: [P.supplier.view],
    updatePermissions: [P.supplier.update],
    select: { id: true, code: true },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [],
      label: scalar(row, 'code'),
    }),
  },
  purchase_order: {
    resourceType: 'purchase_order',
    delegate: 'purchaseOrder',
    viewPermissions: [P.procurementPo.view],
    updatePermissions: [P.procurementPo.update],
    select: { id: true, branchId: true, poNumber: true },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [scalar(row, 'branchId')],
      label: scalar(row, 'poNumber'),
    }),
  },
  goods_receipt: {
    resourceType: 'goods_receipt',
    delegate: 'goodsReceipt',
    viewPermissions: [P.procurementReceipt.view],
    updatePermissions: [P.procurementReceipt.update],
    select: { id: true, branchId: true, receiptNumber: true },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [scalar(row, 'branchId')],
      label: scalar(row, 'receiptNumber'),
    }),
  },
  maintenance_work_order: {
    resourceType: 'maintenance_work_order',
    delegate: 'maintenanceWorkOrder',
    viewPermissions: [P.maintenanceWorkOrder.view],
    updatePermissions: [
      P.maintenanceWorkOrder.update,
      P.maintenanceWorkOrder.manage,
    ],
    select: { id: true, branchId: true, workOrderNumber: true },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [scalar(row, 'branchId')],
      label: scalar(row, 'workOrderNumber'),
    }),
  },
  transfer: {
    resourceType: 'transfer',
    delegate: 'transfer',
    viewPermissions: [P.transfer.view],
    updatePermissions: [P.transfer.create, P.transfer.update],
    select: {
      id: true,
      sourceBranchId: true,
      destinationBranchId: true,
      transferNumber: true,
    },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [scalar(row, 'sourceBranchId'), scalar(row, 'destinationBranchId')],
      label: scalar(row, 'transferNumber'),
    }),
  },
  asset_assignment: {
    resourceType: 'asset_assignment',
    delegate: 'assetAssignment',
    viewPermissions: [P.asset.view],
    updatePermissions: [P.asset.assign, P.asset.return],
    select: {
      id: true,
      asset: { select: { branchId: true, assetTag: true } },
    },
    toParentRow: (row) => {
      const asset = (row.asset ?? {}) as Record<string, unknown>;
      return {
        id: scalar(row, 'id'),
        branchIds: [scalar(asset, 'branchId')],
        label: scalar(asset, 'assetTag'),
      };
    },
  },
  stock_transaction: {
    resourceType: 'stock_transaction',
    delegate: 'stockTransaction',
    viewPermissions: [P.inventory.view],
    updatePermissions: [
      P.inventory.receive,
      P.inventory.issue,
      P.inventory.return,
      P.inventory.transfer,
      P.inventory.adjust,
    ],
    select: { id: true, branchId: true, transactionNumber: true },
    toParentRow: (row) => ({
      id: scalar(row, 'id'),
      branchIds: [scalar(row, 'branchId')],
      label: scalar(row, 'transactionNumber'),
    }),
  },
};

export const ATTACHMENT_RESOURCE_TYPES = Object.keys(ATTACHMENT_PARENTS);
