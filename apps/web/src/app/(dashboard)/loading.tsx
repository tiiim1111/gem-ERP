import { PageSkeleton } from '@/components/ui/skeleton';

/**
 * Rendered by the App Router inside the shell while a dashboard route's
 * server work is in flight, so navigation lands on structure instead of a
 * frozen previous page.
 */
export default function DashboardLoading() {
  return <PageSkeleton />;
}
