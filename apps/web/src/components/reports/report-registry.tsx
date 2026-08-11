import type * as React from 'react';
import {
  AssetStatus,
  PERMISSIONS,
  PurchaseOrderStatus,
  TransferStatus,
  WorkOrderStatus,
} from '@gemerp/shared';
import {
  formatDowntime,
  formatMoney,
  formatQuantity,
  rowNumber,
  rowBoolean,
  rowString,
  type ReportRow,
} from '@/lib/types';
import {
  countSessionStatusLabel,
  stockTransactionTypeLabel,
  workOrderStatusLabel,
} from '@/lib/status-maps';
import { formatDate, formatDateTime, humanize } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  assetStatusBadge,
  transferStatusBadge,
  SignedQuantity,
} from '@/components/inventory/badges';
import { countLineFlagBadge, countSessionStatusBadge } from '@/components/counts/badges';
import { woStatusBadge } from '@/components/maintenance/badges';
import { poStatusBadge } from '@/components/procurement/badges';

/* ------------------------------- Definitions ------------------------------- */

/** Contract §1.4 filter conventions — the only query keys a report may take. */
export type ReportFilterKey =
  | 'branchId'
  | 'warehouseId'
  | 'categoryId'
  | 'itemId'
  | 'employeeId'
  | 'departmentId'
  | 'supplierId'
  | 'status'
  | 'from'
  | 'to';

export interface ReportColumn {
  key: string;
  header: string;
  align?: 'right';
  /** Tailwind breakpoint below which the column hides (house table style). */
  hideBelow?: 'md' | 'lg' | 'xl';
  /**
   * Cost/value column — rendered only when at least one row in the current
   * page carries the value (the server omits cost fields without the
   * relevant `*.view_cost` permission).
   */
  costGated?: boolean;
  /** Value probe for cost-gated visibility. */
  present?: (row: ReportRow) => boolean;
  render: (row: ReportRow) => React.ReactNode;
}

export const REPORT_AREAS = [
  'Assets',
  'Inventory',
  'Procurement',
  'Maintenance',
  'Admin',
] as const;
export type ReportArea = (typeof REPORT_AREAS)[number];

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  area: ReportArea;
  /** Underlying view permission(s) besides reports.view — ANY unlocks. */
  permissions: readonly string[];
  /** Filter controls this report supports (mirror of the API registry). */
  filters: readonly ReportFilterKey[];
  /** Options for the status select, when `status` is a supported filter. */
  statusOptions?: Array<{ value: string; label: string }>;
  /** Screen column subset — exports always carry the full server column set. */
  columns: ReportColumn[];
}

/* ---------------------------- Column shorthands ---------------------------- */

const dash = <span className="text-muted-foreground">—</span>;

function text(key: string, header: string, hideBelow?: 'md' | 'lg' | 'xl'): ReportColumn {
  return { key, header, hideBelow, render: (row) => rowString(row, key) ?? dash };
}

function mono(key: string, header: string, hideBelow?: 'md' | 'lg' | 'xl'): ReportColumn {
  return {
    key,
    header,
    hideBelow,
    render: (row) => {
      const value = rowString(row, key);
      return value ? <span className="font-mono text-xs font-medium">{value}</span> : dash;
    },
  };
}

function qty(key: string, header: string, hideBelow?: 'md' | 'lg' | 'xl'): ReportColumn {
  return {
    key,
    header,
    align: 'right',
    hideBelow,
    render: (row) => {
      const value = rowNumber(row, key);
      return value === null ? dash : formatQuantity(value);
    },
  };
}

function money(key: string, header: string, hideBelow?: 'md' | 'lg' | 'xl'): ReportColumn {
  return {
    key,
    header,
    align: 'right',
    hideBelow,
    costGated: true,
    present: (row) => rowNumber(row, key) !== null,
    render: (row) => {
      const value = rowNumber(row, key);
      return value === null ? dash : formatMoney(value);
    },
  };
}

function date(key: string, header: string, hideBelow?: 'md' | 'lg' | 'xl'): ReportColumn {
  return {
    key,
    header,
    hideBelow,
    render: (row) => {
      const value = rowString(row, key);
      return value ? formatDate(value) : dash;
    },
  };
}

function dateTime(key: string, header: string, hideBelow?: 'md' | 'lg' | 'xl'): ReportColumn {
  return {
    key,
    header,
    hideBelow,
    render: (row) => {
      const value = rowString(row, key);
      return value ? formatDateTime(value) : dash;
    },
  };
}

function badge(
  key: string,
  header: string,
  badgeFor: (status: string) => React.ReactNode,
  hideBelow?: 'md' | 'lg' | 'xl',
): ReportColumn {
  return {
    key,
    header,
    hideBelow,
    render: (row) => {
      const value = rowString(row, key);
      return value ? badgeFor(value) : dash;
    },
  };
}

/** Signed quantity delta (green/red like the ledger). */
function delta(key: string, header: string, hideBelow?: 'md' | 'lg' | 'xl'): ReportColumn {
  return {
    key,
    header,
    align: 'right',
    hideBelow,
    render: (row) => <SignedQuantity value={rowNumber(row, key)} />,
  };
}

/** Yes/— boolean flag column (warning-tinted when set). */
function flag(key: string, header: string, hideBelow?: 'md' | 'lg' | 'xl'): ReportColumn {
  return {
    key,
    header,
    hideBelow,
    render: (row) => {
      const value = rowBoolean(row, key);
      if (value === null) return dash;
      return value ? <Badge variant="warning">Yes</Badge> : dash;
    },
  };
}

/** Join several flat columns into one cell ("employee · warehouse · branch"). */
function joined(
  cellKey: string,
  header: string,
  keys: string[],
  hideBelow?: 'md' | 'lg' | 'xl',
): ReportColumn {
  return {
    key: cellKey,
    header,
    hideBelow,
    render: (row) => {
      const parts = keys
        .map((key) => rowString(row, key))
        .filter((part): part is string => !!part);
      return parts.length > 0 ? parts.join(' · ') : dash;
    },
  };
}

function statusOptionsFrom(values: Record<string, string>): Array<{ value: string; label: string }> {
  return Object.values(values).map((value) => ({ value, label: humanize(value) }));
}

/** Custody assignment status (server statusOptions for asset-custody). */
const CUSTODY_STATUS_OPTIONS = [
  'PENDING_ACKNOWLEDGMENT',
  'ACTIVE',
  'RETURNED',
  'LOST',
  'CANCELED',
].map((value) => ({ value, label: humanize(value) }));

function custodyStatusBadge(status: string) {
  const label = humanize(status);
  switch (status) {
    case 'PENDING_ACKNOWLEDGMENT':
      return <Badge variant="warning">{label}</Badge>;
    case 'ACTIVE':
      return <Badge variant="success">{label}</Badge>;
    case 'LOST':
      return <Badge variant="destructive">{label}</Badge>;
    case 'RETURNED':
    case 'CANCELED':
      return <Badge variant="muted">{label}</Badge>;
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}

/* ------------------------------ The registry ------------------------------- */

/**
 * Client-side mirror of the @gemerp/reports registry, keyed identically to
 * the API report keys. Keys, titles, filters, and status options MUST match
 * packages/reports/src — unsupported filters are a server-side
 * VALIDATION_ERROR, never silently ignored. Rows arrive flat
 * (`Record<column key, string | number | boolean | null>`); the columns here
 * are the screen subset with house renderers — exports carry every column.
 */
export const REPORT_REGISTRY: Record<string, ReportDefinition> = {
  'asset-register': {
    key: 'asset-register',
    title: 'Asset register',
    description:
      'Every serialized asset with tag, item, location, custody, warranty, and lifecycle status.',
    area: 'Assets',
    permissions: [PERMISSIONS.asset.view],
    filters: [
      'branchId',
      'warehouseId',
      'categoryId',
      'itemId',
      'employeeId',
      'departmentId',
      'supplierId',
      'status',
      'from',
      'to',
    ],
    statusOptions: statusOptionsFrom(AssetStatus),
    columns: [
      mono('assetTag', 'Asset tag'),
      text('itemName', 'Item'),
      text('serialNumber', 'Serial no.', 'lg'),
      text('category', 'Category', 'xl'),
      text('branch', 'Branch', 'lg'),
      badge('status', 'Status', assetStatusBadge),
      text('condition', 'Condition', 'xl'),
      text('custodian', 'Custodian', 'md'),
      date('acquisitionDate', 'Acquired', 'xl'),
      date('warrantyEndDate', 'Warranty end', 'xl'),
      money('acquisitionCost', 'Acquisition cost'),
    ],
  },
  'asset-custody': {
    key: 'asset-custody',
    title: 'Asset custody & assignments',
    description:
      'Assignment history: who holds (or held) each asset, acknowledgment and return timestamps, and issue/return conditions.',
    area: 'Assets',
    permissions: [PERMISSIONS.asset.view],
    filters: ['branchId', 'itemId', 'employeeId', 'departmentId', 'status', 'from', 'to'],
    statusOptions: CUSTODY_STATUS_OPTIONS,
    columns: [
      mono('assetTag', 'Asset tag'),
      text('itemName', 'Item', 'md'),
      text('employee', 'Employee'),
      text('department', 'Department', 'lg'),
      text('branch', 'Branch', 'xl'),
      badge('status', 'Status', custodyStatusBadge),
      dateTime('assignedAt', 'Assigned', 'md'),
      {
        key: 'acknowledgedAt',
        header: 'Acknowledged',
        hideBelow: 'lg',
        render: (row) => {
          const at = rowString(row, 'acknowledgedAt');
          if (at) return formatDate(at);
          return <Badge variant="warning">Pending</Badge>;
        },
      },
      date('expectedReturnAt', 'Expected return', 'xl'),
      date('returnedAt', 'Returned', 'lg'),
    ],
  },
  'asset-movements': {
    key: 'asset-movements',
    title: 'Asset movements & lifecycle',
    description: 'Location and custody movement history per asset, including inter-branch transfers.',
    area: 'Assets',
    permissions: [PERMISSIONS.asset.view],
    filters: ['branchId', 'itemId', 'employeeId', 'from', 'to'],
    columns: [
      dateTime('movedAt', 'Moved at'),
      mono('assetTag', 'Asset tag'),
      text('itemName', 'Item', 'md'),
      joined('from', 'From', ['fromEmployee', 'fromWarehouse', 'fromBranch'], 'lg'),
      joined('to', 'To', ['toEmployee', 'toWarehouse', 'toBranch'], 'lg'),
      mono('transferNumber', 'Transfer no.', 'xl'),
      text('notes', 'Notes', 'xl'),
    ],
  },
  'asset-condition': {
    key: 'asset-condition',
    title: 'Asset condition',
    description: 'Current condition, inspection recency, and maintenance flags per asset.',
    area: 'Assets',
    permissions: [PERMISSIONS.asset.view],
    filters: ['branchId', 'warehouseId', 'categoryId', 'itemId', 'status', 'from', 'to'],
    statusOptions: statusOptionsFrom(AssetStatus),
    columns: [
      mono('assetTag', 'Asset tag'),
      text('itemName', 'Item'),
      text('branch', 'Branch', 'lg'),
      badge('status', 'Status', assetStatusBadge, 'md'),
      text('condition', 'Condition'),
      text('criticality', 'Criticality', 'xl'),
      flag('maintenanceRequired', 'Maintenance required', 'xl'),
      dateTime('lastInspectionAt', 'Last inspection', 'lg'),
      date('nextMaintenanceAt', 'Next maintenance', 'xl'),
    ],
  },
  'asset-terminal': {
    key: 'asset-terminal',
    title: 'Retired / disposed / damaged / lost assets',
    description: 'Assets in terminal or incident states with disposal details and acquisition value.',
    area: 'Assets',
    permissions: [PERMISSIONS.asset.view],
    filters: ['branchId', 'categoryId', 'itemId', 'status', 'from', 'to'],
    statusOptions: [
      AssetStatus.RETIRED,
      AssetStatus.DISPOSED,
      AssetStatus.DAMAGED,
      AssetStatus.LOST,
    ].map((value) => ({ value, label: humanize(value) })),
    columns: [
      mono('assetTag', 'Asset tag'),
      text('itemName', 'Item'),
      text('branch', 'Branch', 'lg'),
      badge('status', 'Status', assetStatusBadge),
      text('condition', 'Condition', 'xl'),
      dateTime('retiredAt', 'Retired', 'md'),
      dateTime('disposedAt', 'Disposed', 'lg'),
      text('disposalMethod', 'Disposal method', 'xl'),
      money('acquisitionCost', 'Acquisition cost'),
    ],
  },
  'stock-on-hand': {
    key: 'stock-on-hand',
    title: 'Stock on hand',
    description:
      'On-hand, reserved, in-transit, and available quantities by branch, warehouse, location, item, and lot.',
    area: 'Inventory',
    permissions: [PERMISSIONS.inventory.view],
    filters: ['branchId', 'warehouseId', 'categoryId', 'itemId'],
    columns: [
      text('itemSku', 'SKU', 'lg'),
      text('itemName', 'Item'),
      text('branch', 'Branch', 'xl'),
      text('warehouse', 'Warehouse'),
      text('location', 'Location', 'xl'),
      text('lotNumber', 'Lot', 'lg'),
      text('uom', 'UOM', 'md'),
      qty('onHandQty', 'On hand'),
      qty('reservedQty', 'Reserved', 'lg'),
      qty('inTransitQty', 'In transit', 'xl'),
      qty('availableQty', 'Available', 'md'),
      money('unitCost', 'Unit cost'),
      money('totalValue', 'Total value'),
    ],
  },
  'stock-movement': {
    key: 'stock-movement',
    title: 'Stock movement ledger',
    description:
      'Immutable stock ledger entries: every posted quantity delta with its transaction, item, warehouse, location, and lot.',
    area: 'Inventory',
    permissions: [PERMISSIONS.inventory.view],
    filters: ['branchId', 'warehouseId', 'categoryId', 'itemId', 'from', 'to'],
    columns: [
      dateTime('postedAt', 'Posted at'),
      mono('transactionNumber', 'Transaction'),
      {
        key: 'type',
        header: 'Type',
        hideBelow: 'md',
        render: (row) => {
          const value = rowString(row, 'type');
          return value ? <Badge variant="outline">{stockTransactionTypeLabel(value)}</Badge> : dash;
        },
      },
      text('itemName', 'Item'),
      text('warehouse', 'Warehouse', 'lg'),
      text('lotNumber', 'Lot', 'xl'),
      delta('quantityDelta', 'Qty delta'),
      money('unitCost', 'Unit cost'),
      money('totalCost', 'Total cost'),
    ],
  },
  'low-stock': {
    key: 'low-stock',
    title: 'Low stock & reorder recommendations',
    description:
      'Items at or below their per-warehouse reorder level, with recommended order quantities.',
    area: 'Inventory',
    permissions: [PERMISSIONS.inventory.view],
    filters: ['branchId', 'warehouseId', 'categoryId', 'itemId'],
    columns: [
      text('itemSku', 'SKU', 'lg'),
      text('itemName', 'Item'),
      text('branch', 'Branch', 'xl'),
      text('warehouse', 'Warehouse'),
      text('uom', 'UOM', 'xl'),
      qty('onHandQty', 'On hand', 'lg'),
      qty('availableQty', 'Available'),
      qty('reorderLevel', 'Reorder level', 'md'),
      qty('shortfall', 'Shortfall', 'lg'),
      qty('reorderQuantity', 'Reorder qty', 'xl'),
      qty('recommendedOrderQty', 'Recommended order'),
    ],
  },
  consumption: {
    key: 'consumption',
    title: 'Issuance & consumption',
    description: 'Posted issue lines by employee, department, project, work order, and period.',
    area: 'Inventory',
    permissions: [PERMISSIONS.inventory.view],
    filters: [
      'branchId',
      'warehouseId',
      'categoryId',
      'itemId',
      'employeeId',
      'departmentId',
      'from',
      'to',
    ],
    columns: [
      dateTime('postedAt', 'Posted at'),
      mono('transactionNumber', 'Transaction', 'lg'),
      {
        key: 'type',
        header: 'Type',
        hideBelow: 'md',
        render: (row) => {
          const value = rowString(row, 'type');
          return value ? <Badge variant="outline">{stockTransactionTypeLabel(value)}</Badge> : dash;
        },
      },
      text('itemName', 'Item'),
      qty('quantity', 'Qty (base)'),
      text('uom', 'UOM', 'lg'),
      text('employee', 'Employee', 'md'),
      text('department', 'Department', 'lg'),
      mono('workOrderNumber', 'Work order', 'xl'),
      money('unitCost', 'Unit cost'),
      money('totalCost', 'Total cost'),
    ],
  },
  'expiring-lots': {
    key: 'expiring-lots',
    title: 'Expiring lots',
    description:
      'Lots with stock on hand expiring in the window (default: next 30 days; override with from/to).',
    area: 'Inventory',
    permissions: [PERMISSIONS.inventory.view],
    filters: ['branchId', 'warehouseId', 'categoryId', 'itemId', 'from', 'to'],
    columns: [
      mono('lotNumber', 'Lot'),
      text('itemSku', 'SKU', 'lg'),
      text('itemName', 'Item'),
      date('expiryDate', 'Expiry'),
      {
        key: 'daysToExpiry',
        header: 'Days to expiry',
        align: 'right',
        render: (row) => {
          const days = rowNumber(row, 'daysToExpiry');
          if (days === null) return dash;
          const value = Number(days);
          if (value < 0) return <Badge variant="destructive">Expired</Badge>;
          if (value <= 30) return <Badge variant="warning">{value}d</Badge>;
          return <span className="tabular-nums">{value}d</span>;
        },
      },
      qty('onHandQty', 'On hand'),
      text('uom', 'UOM', 'lg'),
      text('warehouses', 'Warehouses', 'md'),
    ],
  },
  'count-variance': {
    key: 'count-variance',
    title: 'Physical count variance',
    description:
      'Count lines whose counted quantity differs from the snapshot (or flagged missing/unexpected/misplaced), per session.',
    area: 'Inventory',
    permissions: [PERMISSIONS.count.view],
    filters: ['branchId', 'warehouseId', 'itemId', 'status', 'from', 'to'],
    statusOptions: ['IN_PROGRESS', 'REVIEW', 'COMPLETED'].map((value) => ({
      value,
      label: countSessionStatusLabel(value),
    })),
    columns: [
      mono('countNumber', 'Count no.'),
      badge('sessionStatus', 'Session', countSessionStatusBadge, 'md'),
      text('warehouse', 'Warehouse', 'lg'),
      {
        key: 'line',
        header: 'Item / asset',
        render: (row) => rowString(row, 'assetTag') ?? rowString(row, 'itemName') ?? dash,
      },
      text('lotNumber', 'Lot', 'xl'),
      qty('expectedQty', 'Expected'),
      qty('countedQty', 'Counted'),
      qty('recountQty', 'Recount', 'xl'),
      delta('varianceQty', 'Variance'),
      {
        key: 'flag',
        header: 'Flag',
        hideBelow: 'md',
        render: (row) => countLineFlagBadge(rowString(row, 'flag')) ?? dash,
      },
      dateTime('countedAt', 'Counted at', 'xl'),
    ],
  },
  'transfer-status': {
    key: 'transfer-status',
    title: 'Transfer status & in-transit inventory',
    description:
      'Transfer documents with per-line dispatched/received/damaged/short totals; visible with source or destination branch access.',
    area: 'Inventory',
    permissions: [PERMISSIONS.transfer.view],
    filters: ['branchId', 'status', 'from', 'to'],
    statusOptions: statusOptionsFrom(TransferStatus),
    columns: [
      mono('transferNumber', 'Transfer no.'),
      {
        key: 'type',
        header: 'Type',
        hideBelow: 'md',
        render: (row) => {
          const value = rowString(row, 'type');
          return value ? <Badge variant="outline">{humanize(value)}</Badge> : dash;
        },
      },
      badge('status', 'Status', transferStatusBadge),
      joined('source', 'From', ['sourceWarehouse', 'sourceBranch']),
      joined('destination', 'To', ['destinationWarehouse', 'destinationBranch']),
      date('transferDate', 'Transfer date', 'lg'),
      dateTime('dispatchedAt', 'Dispatched', 'xl'),
      dateTime('completedAt', 'Completed', 'xl'),
      qty('lineCount', 'Lines', 'lg'),
      qty('quantityTotal', 'Qty total', 'lg'),
      qty('receivedTotal', 'Received qty', 'xl'),
    ],
  },
  'supplier-purchases': {
    key: 'supplier-purchases',
    title: 'Supplier purchase history',
    description:
      'Purchase orders per supplier with ordered vs received quantity totals and document values.',
    area: 'Procurement',
    permissions: [PERMISSIONS.procurementPo.view],
    filters: ['branchId', 'warehouseId', 'supplierId', 'status', 'from', 'to'],
    statusOptions: statusOptionsFrom(PurchaseOrderStatus),
    columns: [
      mono('poNumber', 'PO no.'),
      text('supplier', 'Supplier'),
      text('branch', 'Branch', 'xl'),
      text('warehouse', 'Warehouse', 'xl'),
      date('orderDate', 'Order date', 'md'),
      date('expectedDeliveryDate', 'Expected', 'lg'),
      badge('status', 'Status', poStatusBadge, 'md'),
      qty('lineCount', 'Lines', 'lg'),
      qty('orderedQty', 'Ordered qty', 'lg'),
      qty('receivedQty', 'Received qty'),
      qty('receiptCount', 'Receipts', 'xl'),
      money('subtotal', 'Subtotal'),
      money('grandTotal', 'Grand total'),
    ],
  },
  'po-status': {
    key: 'po-status',
    title: 'PO status & outstanding quantities',
    description: 'Purchase-order lines with ordered, received, canceled, and outstanding quantities.',
    area: 'Procurement',
    permissions: [PERMISSIONS.procurementPo.view],
    filters: [
      'branchId',
      'warehouseId',
      'supplierId',
      'itemId',
      'categoryId',
      'status',
      'from',
      'to',
    ],
    statusOptions: statusOptionsFrom(PurchaseOrderStatus),
    columns: [
      mono('poNumber', 'PO no.'),
      badge('poStatus', 'PO status', poStatusBadge),
      text('supplier', 'Supplier', 'lg'),
      text('branch', 'Branch', 'xl'),
      date('orderDate', 'Order date', 'lg'),
      date('expectedDeliveryDate', 'Expected', 'xl'),
      text('itemSku', 'SKU', 'xl'),
      text('itemName', 'Item'),
      qty('orderedQty', 'Ordered'),
      qty('receivedQty', 'Received', 'md'),
      qty('canceledQty', 'Canceled', 'xl'),
      qty('outstandingQty', 'Outstanding'),
      money('unitPrice', 'Unit price'),
      money('lineTotal', 'Line total'),
    ],
  },
  'maintenance-summary': {
    key: 'maintenance-summary',
    title: 'Maintenance summary',
    description:
      'Work orders with schedule adherence (due/overdue), downtime, and cost breakdown.',
    area: 'Maintenance',
    permissions: [PERMISSIONS.maintenanceWorkOrder.view],
    filters: ['branchId', 'itemId', 'employeeId', 'status', 'from', 'to'],
    statusOptions: Object.values(WorkOrderStatus).map((value) => ({
      value,
      label: workOrderStatusLabel(value),
    })),
    columns: [
      mono('workOrderNumber', 'WO no.'),
      mono('assetTag', 'Asset tag'),
      text('itemName', 'Item', 'lg'),
      text('branch', 'Branch', 'xl'),
      text('type', 'Type', 'lg'),
      text('priority', 'Priority', 'xl'),
      badge('status', 'Status', woStatusBadge),
      flag('overdue', 'Overdue', 'md'),
      text('assignedTo', 'Assigned to', 'lg'),
      dateTime('scheduledStartAt', 'Scheduled start', 'xl'),
      {
        key: 'downtimeMinutes',
        header: 'Downtime',
        align: 'right',
        hideBelow: 'xl',
        render: (row) => {
          const minutes = rowNumber(row, 'downtimeMinutes');
          return minutes === null ? dash : formatDowntime(Number(minutes));
        },
      },
      money('totalCost', 'Total cost'),
    ],
  },
  'audit-activity': {
    key: 'audit-activity',
    title: 'Audit activity',
    description: 'Append-only audit trail entries: actor, action, resource, branch, and reason.',
    area: 'Admin',
    permissions: [PERMISSIONS.audit.view],
    filters: ['branchId', 'from', 'to'],
    columns: [
      dateTime('occurredAt', 'Occurred at'),
      text('actor', 'Actor'),
      {
        key: 'action',
        header: 'Action',
        render: (row) => {
          const value = rowString(row, 'action');
          return value ? <Badge variant="outline">{humanize(value)}</Badge> : dash;
        },
      },
      {
        key: 'resourceType',
        header: 'Resource',
        hideBelow: 'md',
        render: (row) => {
          const type = rowString(row, 'resourceType');
          return type ? humanize(type) : dash;
        },
      },
      text('branch', 'Branch', 'lg'),
      text('reason', 'Reason', 'xl'),
      mono('ipAddress', 'IP', 'xl'),
    ],
  },
};

/** Registry entries in catalog order, grouped by area. */
export function reportsByArea(): Array<{ area: ReportArea; reports: ReportDefinition[] }> {
  return REPORT_AREAS.map((area) => ({
    area,
    reports: Object.values(REPORT_REGISTRY).filter((report) => report.area === area),
  })).filter((group) => group.reports.length > 0);
}
