import { approvalRequestStatusLabel } from '@/lib/status-maps';
import { humanize } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/* ------------------------- Approval request status ------------------------- */

export function approvalStatusBadge(status: string) {
  const label = approvalRequestStatusLabel(status);
  switch (status) {
    case 'PENDING':
      return <Badge variant="warning">{label}</Badge>;
    case 'APPROVED':
      return <Badge variant="success">{label}</Badge>;
    case 'REJECTED':
      return <Badge variant="destructive">{label}</Badge>;
    case 'RETURNED':
      return <Badge variant="outline">{label}</Badge>;
    case 'CANCELED':
      return <Badge variant="muted">{label}</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}

/* ------------------------- Workflow active state --------------------------- */

export function workflowActiveBadge(active: boolean | undefined) {
  return active === false ? (
    <Badge variant="muted">Inactive</Badge>
  ) : (
    <Badge variant="success">Active</Badge>
  );
}
