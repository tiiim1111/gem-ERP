'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, CheckCheck } from 'lucide-react';
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/endpoints';
import { notificationIsRead, notificationMessage, type AppNotification } from '@/lib/types';
import { cn, formatDateTime, formatRelativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PaginationControls } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { resourceHref } from '@/components/approvals/document-links';
import {
  NOTIFICATION_TYPE_OPTIONS,
  notificationTypeMeta,
} from '@/components/notifications/notification-meta';

/** Server-computed link wins; resource mapping is the fallback. */
function notificationHref(notification: AppNotification): string | null {
  return notification.link ?? resourceHref(notification.resourceType, notification.resourceId);
}

/** Full notification history (contract §7.3) with read/type filters. */
export function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [readFilter, setReadFilter] = React.useState('');
  const [type, setType] = React.useState('');

  React.useEffect(() => {
    setPage(1);
  }, [readFilter, type, pageSize]);

  const params = {
    page,
    pageSize,
    read: readFilter === '' ? undefined : readFilter === 'true',
    type: type || undefined,
    sort: 'createdAt:desc',
  };

  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'list', params],
    queryFn: ({ signal }) => listNotifications(params, signal),
    placeholderData: keepPreviousData,
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['notifications'] });
  }, [queryClient]);

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSettled: invalidate,
  });

  const readAllMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => toast({ title: 'All notifications marked read', variant: 'success' }),
    onSettled: invalidate,
  });

  const openNotification = (notification: AppNotification) => {
    if (!notificationIsRead(notification)) markReadMutation.mutate(notification.id);
    const href = notificationHref(notification);
    if (href) router.push(href);
  };

  const data = notificationsQuery.data;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Alerts addressed to you — approvals, stock, maintenance, expiries, and system jobs."
        actions={
          <Button
            variant="outline"
            onClick={() => readAllMutation.mutate()}
            loading={readAllMutation.isPending}
          >
            <CheckCheck aria-hidden /> Mark all read
          </Button>
        }
      />

      <Card>
        <div className="grid grid-cols-1 gap-2 border-b p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Select
            aria-label="Filter by read state"
            value={readFilter}
            onChange={(event) => setReadFilter(event.target.value)}
          >
            <option value="">Read + unread</option>
            <option value="false">Unread only</option>
            <option value="true">Read only</option>
          </Select>
          <Select aria-label="Filter by type" value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All types</option>
            {NOTIFICATION_TYPE_OPTIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </Select>
        </div>

        {notificationsQuery.isPending ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : notificationsQuery.isError ? (
          <div className="p-4">
            <ErrorState error={notificationsQuery.error} onRetry={() => notificationsQuery.refetch()} />
          </div>
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={BellOff}
            title="No notifications"
            description={
              readFilter || type ? 'Nothing matches the current filters.' : "You're all caught up."
            }
          />
        ) : data ? (
          <>
            <ul className="divide-y">
              {data.data.map((notification) => {
                const meta = notificationTypeMeta(notification.type);
                const read = notificationIsRead(notification);
                const href = notificationHref(notification);
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => openNotification(notification)}
                      disabled={!href && read}
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors sm:px-5',
                        (href || !read) && 'hover:bg-muted/50',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                        !read && 'bg-primary/5',
                      )}
                    >
                      <meta.icon
                        className={cn('mt-0.5 h-5 w-5 shrink-0', read ? 'text-muted-foreground' : 'text-primary')}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-sm', !read && 'font-semibold')}>
                          {notification.title ?? meta.label}
                        </span>
                        {notificationMessage(notification) ? (
                          <span className="block text-sm text-muted-foreground">
                            {notificationMessage(notification)}
                          </span>
                        ) : null}
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {meta.label}
                          {href ? ' · opens the linked record' : ''}
                        </span>
                      </span>
                      <time
                        className="shrink-0 text-xs tabular-nums text-muted-foreground"
                        title={formatDateTime(notification.createdAt)}
                      >
                        {formatRelativeTime(notification.createdAt)}
                      </time>
                    </button>
                  </li>
                );
              })}
            </ul>
            <PaginationControls meta={data.meta} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </>
        ) : null}
      </Card>
    </>
  );
}
