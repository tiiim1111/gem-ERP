'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/endpoints';
import { notificationIsRead, notificationMessage, type AppNotification } from '@/lib/types';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { resourceHref } from '@/components/approvals/document-links';
import { notificationTypeMeta } from '@/components/notifications/notification-meta';

const RECENT_PAGE_SIZE = 8;

/**
 * Topbar notification bell (contract §7.3): unread badge polled lightly and on
 * focus, dropdown of recent notifications with mark-read-on-click deep links,
 * and a read-all action. Notifications are always self-scoped.
 */
export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: ({ signal }) => getUnreadNotificationCount(signal),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const recentQuery = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: ({ signal }) =>
      listNotifications({ page: 1, pageSize: RECENT_PAGE_SIZE, sort: 'createdAt:desc' }, signal),
    enabled: open,
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
    onSettled: invalidate,
  });

  // Close on outside interaction / Escape.
  React.useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const unread = unreadQuery.data ?? 0;

  const openNotification = (notification: AppNotification) => {
    setOpen(false);
    if (!notificationIsRead(notification)) markReadMutation.mutate(notification.id);
    // The server-computed link is authoritative; resource mapping is the fallback.
    const href =
      notification.link ?? resourceHref(notification.resourceType, notification.resourceId);
    if (href) router.push(href);
  };

  const notifications = recentQuery.data?.data ?? [];

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
        className="relative"
      >
        <Bell aria-hidden />
        {unread > 0 ? (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-white"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          className="absolute right-0 top-full z-40 mt-1 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-md border bg-background shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => readAllMutation.mutate()}
              loading={readAllMutation.isPending}
              disabled={unread === 0}
            >
              <CheckCheck aria-hidden /> Mark all read
            </Button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {recentQuery.isPending ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentQuery.isError ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Could not load notifications.
              </p>
            ) : notifications.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                You&apos;re all caught up.
              </p>
            ) : (
              <ul className="divide-y">
                {notifications.map((notification) => {
                  const meta = notificationTypeMeta(notification.type);
                  const read = notificationIsRead(notification);
                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(notification)}
                        className={cn(
                          'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                          !read && 'bg-primary/5',
                        )}
                      >
                        <meta.icon
                          className={cn('mt-0.5 h-4 w-4 shrink-0', read ? 'text-muted-foreground' : 'text-primary')}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className={cn('block truncate text-sm', !read && 'font-semibold')}>
                            {notification.title ?? meta.label}
                          </span>
                          {notificationMessage(notification) ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {notificationMessage(notification)}
                            </span>
                          ) : null}
                          <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                            {formatRelativeTime(notification.createdAt)}
                          </span>
                        </span>
                        {!read ? (
                          <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t p-2">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-1.5 text-center text-sm font-medium text-primary transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
