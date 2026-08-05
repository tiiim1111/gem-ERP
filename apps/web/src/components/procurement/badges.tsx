import { PurchaseOrderStatus } from '@gemerp/shared';
import { humanize } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/* --------------------------- Purchase order status ------------------------- */

export function poStatusBadge(status: string) {
  switch (status) {
    case PurchaseOrderStatus.DRAFT:
      return <Badge variant="muted">Draft</Badge>;
    case PurchaseOrderStatus.PENDING_APPROVAL:
      return <Badge variant="warning">Pending approval</Badge>;
    case PurchaseOrderStatus.APPROVED:
      return <Badge variant="secondary">Approved</Badge>;
    case PurchaseOrderStatus.PARTIALLY_RECEIVED:
      return <Badge>Partially received</Badge>;
    case PurchaseOrderStatus.FULLY_RECEIVED:
      return <Badge variant="success">Fully received</Badge>;
    case PurchaseOrderStatus.CANCELED:
      return <Badge variant="muted">Canceled</Badge>;
    case PurchaseOrderStatus.CLOSED:
      return <Badge variant="outline">Closed</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">Rejected</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}

/* ---------------------------- Goods receipt status ------------------------- */

export function receiptStatusBadge(status: string) {
  switch (status) {
    case 'DRAFT':
      return <Badge variant="muted">Draft</Badge>;
    case 'POSTED':
      return <Badge variant="success">Posted</Badge>;
    case 'CANCELED':
      return <Badge variant="muted">Canceled</Badge>;
    case 'REVERSED':
      return <Badge variant="destructive">Reversed</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}
