import { WorkOrderStatus } from '@gemerp/shared';
import { workOrderStatusLabel } from '@/lib/status-maps';
import type { LookupValue } from '@/lib/types';
import { humanize } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/* --------------------------- Work-order status ----------------------------- */

export function woStatusBadge(status: string) {
  const label = workOrderStatusLabel(status);
  switch (status) {
    case WorkOrderStatus.DRAFT:
      return <Badge variant="muted">{label}</Badge>;
    case WorkOrderStatus.OPEN:
      return <Badge variant="secondary">{label}</Badge>;
    case WorkOrderStatus.ASSIGNED:
    case WorkOrderStatus.SCHEDULED:
      return <Badge variant="outline">{label}</Badge>;
    case WorkOrderStatus.IN_PROGRESS:
      return <Badge>{label}</Badge>;
    case WorkOrderStatus.ON_HOLD:
    case WorkOrderStatus.AWAITING_PARTS:
    case WorkOrderStatus.AWAITING_VENDOR:
      return <Badge variant="warning">{label}</Badge>;
    case WorkOrderStatus.COMPLETED:
      return <Badge variant="success">{label}</Badge>;
    case WorkOrderStatus.VERIFIED:
      return <Badge variant="success">{label}</Badge>;
    case WorkOrderStatus.CANCELED:
      return <Badge variant="muted">{label}</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}

/* ------------------------------ WO priority -------------------------------- */

/** Priority badge — colored by common lookup codes, name-labelled. */
export function woPriorityBadge(priority: LookupValue | null | undefined) {
  if (!priority) return <span className="text-sm text-muted-foreground">—</span>;
  const label = priority.name ?? priority.code ?? '—';
  const code = (priority.code ?? '').toUpperCase();
  if (code.includes('CRIT') || code.includes('EMERG') || code.includes('URGENT')) {
    return <Badge variant="destructive">{label}</Badge>;
  }
  if (code.includes('HIGH')) return <Badge variant="warning">{label}</Badge>;
  if (code.includes('LOW')) return <Badge variant="muted">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

/* ----------------------------- Plan activity ------------------------------- */

export function planActiveBadge(active: boolean) {
  return active ? <Badge variant="success">Active</Badge> : <Badge variant="muted">Inactive</Badge>;
}
