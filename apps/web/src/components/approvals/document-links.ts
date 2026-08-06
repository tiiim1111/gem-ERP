/**
 * Deep links from a polymorphic resourceType/resourceId pair (audit
 * resource_type vocabulary) to the app page that shows the record. Shared by
 * the approval inbox and the notification center.
 */

/** "purchaseOrder" / "PURCHASE_ORDERS" / "purchase-order" -> "purchase_order". */
function canonicalResourceType(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
    .replace(/s$/, '');
}

/** App route for a resource reference, or null when there is no page for it. */
export function resourceHref(
  resourceType: string | null | undefined,
  resourceId: string | null | undefined,
): string | null {
  if (!resourceType || !resourceId) return null;
  switch (canonicalResourceType(resourceType)) {
    case 'asset':
      return `/assets/${resourceId}`;
    case 'item':
      return `/items/${resourceId}`;
    case 'employee':
      return `/employees?detail=${resourceId}`;
    case 'supplier':
      return `/suppliers/${resourceId}`;
    case 'purchase_order':
    case 'po':
      return `/procurement/purchase-orders/${resourceId}`;
    case 'goods_receipt':
    case 'receipt':
      return `/procurement/receipts/${resourceId}`;
    case 'work_order':
    case 'maintenance_work_order':
      return `/maintenance/work-orders/${resourceId}`;
    case 'stock_transaction':
    case 'transaction':
      return `/inventory/transactions/${resourceId}`;
    case 'transfer':
      return `/inventory/transfers/${resourceId}`;
    case 'count_session':
    case 'inventory_count_session':
    case 'inventory_count':
      return `/inventory/counts/${resourceId}`;
    case 'lot':
      return '/inventory/lots';
    case 'maintenance_plan':
      return `/maintenance/plans/${resourceId}`;
    case 'approval_request':
    case 'approval':
      return `/approvals?request=${resourceId}`;
    default:
      return null;
  }
}
