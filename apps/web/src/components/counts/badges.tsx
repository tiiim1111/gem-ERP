import { countLineFlagLabel, countSessionStatusLabel } from '@/lib/status-maps';
import { humanize } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/* --------------------------- Count session status -------------------------- */

export function countSessionStatusBadge(status: string) {
  const label = countSessionStatusLabel(status);
  switch (status) {
    case 'DRAFT':
      return <Badge variant="muted">{label}</Badge>;
    case 'IN_PROGRESS':
      return <Badge>{label}</Badge>;
    case 'REVIEW':
      return <Badge variant="warning">{label}</Badge>;
    case 'COMPLETED':
      return <Badge variant="success">{label}</Badge>;
    case 'CANCELED':
      return <Badge variant="muted">{label}</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}

/* ------------------------------ Count type --------------------------------- */

export function countTypeBadge(type: string | undefined) {
  if (!type) return null;
  const normalized = type.toUpperCase();
  return (
    <Badge variant="outline">{normalized === 'FULL' ? 'Full count' : normalized === 'CYCLE' ? 'Cycle count' : humanize(type)}</Badge>
  );
}

/* ------------------------------- Line flags -------------------------------- */

/** Flag badge — missing/unexpected/duplicate/misplaced render as alerts. */
export function countLineFlagBadge(flag: string | null | undefined) {
  if (!flag) return null;
  const label = countLineFlagLabel(flag);
  switch (flag) {
    case 'MATCHED':
      return <Badge variant="success">{label}</Badge>;
    case 'VARIANCE':
      return <Badge variant="warning">{label}</Badge>;
    case 'MISSING':
    case 'DUPLICATE':
      return <Badge variant="destructive">{label}</Badge>;
    case 'UNEXPECTED':
    case 'MISPLACED':
      return <Badge variant="warning">{label}</Badge>;
    default:
      return <Badge variant="outline">{humanize(flag)}</Badge>;
  }
}
