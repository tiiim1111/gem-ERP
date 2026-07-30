import { AssetStatus, StockTransactionStatus, TransferStatus } from '@gemerp/shared';
import { cn, humanize } from '@/lib/utils';
import { daysUntil, decimalValue, formatQuantity, type DecimalString } from '@/lib/types';
import { Badge } from '@/components/ui/badge';

/* ------------------------- Stock transaction status ----------------------- */

export function stockTransactionStatusBadge(status: string) {
  switch (status) {
    case StockTransactionStatus.DRAFT:
      return <Badge variant="muted">Draft</Badge>;
    case StockTransactionStatus.PENDING_APPROVAL:
      return <Badge variant="warning">Pending approval</Badge>;
    case StockTransactionStatus.APPROVED:
      return <Badge variant="secondary">Approved</Badge>;
    case StockTransactionStatus.POSTED:
      return <Badge variant="success">Posted</Badge>;
    case StockTransactionStatus.REJECTED:
      return <Badge variant="destructive">Rejected</Badge>;
    case StockTransactionStatus.CANCELED:
      return <Badge variant="muted">Canceled</Badge>;
    case StockTransactionStatus.REVERSED:
      return <Badge variant="destructive">Reversed</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}

/* ------------------------------ Transfer status --------------------------- */

export function transferStatusBadge(status: string) {
  switch (status) {
    case TransferStatus.DRAFT:
      return <Badge variant="muted">Draft</Badge>;
    case TransferStatus.PENDING_APPROVAL:
      return <Badge variant="warning">Pending approval</Badge>;
    case TransferStatus.APPROVED:
      return <Badge variant="secondary">Approved</Badge>;
    case TransferStatus.IN_TRANSIT:
      return <Badge>In transit</Badge>;
    case TransferStatus.RECEIVED:
      return <Badge variant="success">Received</Badge>;
    case TransferStatus.REJECTED:
      return <Badge variant="destructive">Rejected</Badge>;
    case TransferStatus.CANCELED:
      return <Badge variant="muted">Canceled</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}

/* ------------------------------- Asset status ----------------------------- */

export function assetStatusBadge(status: string) {
  switch (status) {
    case AssetStatus.DRAFT:
      return <Badge variant="muted">Draft</Badge>;
    case AssetStatus.AVAILABLE:
      return <Badge variant="success">Available</Badge>;
    case AssetStatus.RESERVED:
      return <Badge variant="secondary">Reserved</Badge>;
    case AssetStatus.ASSIGNED:
      return <Badge>Assigned</Badge>;
    case AssetStatus.IN_TRANSFER:
      return <Badge variant="secondary">In transfer</Badge>;
    case AssetStatus.UNDER_INSPECTION:
      return <Badge variant="warning">Under inspection</Badge>;
    case AssetStatus.UNDER_MAINTENANCE:
      return <Badge variant="warning">Under maintenance</Badge>;
    case AssetStatus.DAMAGED:
      return <Badge variant="destructive">Damaged</Badge>;
    case AssetStatus.LOST:
      return <Badge variant="destructive">Lost</Badge>;
    case AssetStatus.RETIRED:
      return <Badge variant="muted">Retired</Badge>;
    case AssetStatus.DISPOSED:
      return <Badge variant="muted">Disposed</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}

/* -------------------------------- Expiry ---------------------------------- */

/** Expired / expiring ≤30d / ok badge for lot expiry dates. */
export function expiryBadge(expiryDate: string | null | undefined) {
  const days = daysUntil(expiryDate);
  if (days === null) return <span className="text-sm text-muted-foreground">—</span>;
  if (days < 0) return <Badge variant="destructive">Expired</Badge>;
  if (days <= 30) return <Badge variant="warning">Expires in {days}d</Badge>;
  return <Badge variant="outline">{days}d left</Badge>;
}

/* ---------------------------- Signed quantities ---------------------------- */

/** Signed base quantity, color-coded (+ green in, − red out). */
export function SignedQuantity({ value }: { value: DecimalString | null | undefined }) {
  const numeric = decimalValue(value);
  return (
    <span
      className={cn(
        'font-mono text-xs tabular-nums',
        numeric > 0 && 'text-success',
        numeric < 0 && 'text-destructive',
      )}
    >
      {numeric > 0 ? `+${formatQuantity(value)}` : formatQuantity(value)}
    </span>
  );
}
