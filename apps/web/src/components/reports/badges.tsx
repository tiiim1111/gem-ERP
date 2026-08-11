import { exportJobStatusKind, exportJobStatusLabel } from '@/lib/status-maps';
import { humanize } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

/* --------------------------- Export job status ----------------------------- */

export function exportJobStatusBadge(status: string) {
  const label = exportJobStatusLabel(status);
  switch (exportJobStatusKind(status)) {
    case 'queued':
      return <Badge variant="muted">{label}</Badge>;
    case 'processing':
      return <Badge>{label}</Badge>;
    case 'ready':
      return <Badge variant="success">{label}</Badge>;
    case 'failed':
      return <Badge variant="destructive">{label}</Badge>;
    default:
      return <Badge variant="outline">{humanize(status)}</Badge>;
  }
}
