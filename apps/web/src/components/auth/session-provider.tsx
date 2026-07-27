'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hasAnyPermission, hasPermission } from '@gemerp/shared';
import { isApiClientError } from '@/lib/api';
import { fetchMe, logout as logoutRequest } from '@/lib/endpoints';
import type { Me } from '@/lib/types';
import { ErrorState } from '@/components/ui/error-state';
import { LoadingBlock } from '@/components/ui/spinner';

export interface SessionContextValue {
  user: Me;
  /** Permission check with super-admin bypass. Array = ALL must be held. */
  can: (required: string | readonly string[]) => boolean;
  /** True when the user holds ANY of the listed permissions. */
  canAny: (required: readonly string[]) => boolean;
  /** Re-fetch /auth/me (after password change etc.). */
  refresh: () => Promise<unknown>;
  /** POST /auth/logout, clear caches, go to /login. */
  logout: () => void;
  loggingOut: boolean;
}

const SessionContext = React.createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const context = React.useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}

export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * Client-side auth guard for the (dashboard) group. Queries /auth/me; renders
 * a loading state while resolving, redirects to /login on 401, and provides
 * SessionUser + permission helpers to everything below it.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => fetchMe(signal),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const unauthenticated = isApiClientError(meQuery.error) && meQuery.error.status === 401;

  React.useEffect(() => {
    if (!unauthenticated) return;
    const query = searchParams.toString();
    const current = pathname + (query ? `?${query}` : '');
    const next = current !== '/' ? `?next=${encodeURIComponent(current)}` : '';
    // Cache is cleared by the login form on the next successful sign-in;
    // clearing here would refetch /auth/me in a loop while navigating away.
    router.replace(`/login${next}`);
  }, [unauthenticated, pathname, searchParams, router]);

  const logoutMutation = useMutation({
    mutationFn: logoutRequest,
    onSettled: () => {
      // Even if the API call fails (e.g. session already expired) the client
      // state is cleared; the middleware/guard will land the user on /login.
      queryClient.clear();
      router.replace('/login');
    },
  });

  const user = meQuery.data;

  const value = React.useMemo<SessionContextValue | null>(() => {
    if (!user) return null;
    return {
      user,
      can: (required) => user.isSuperAdmin || hasPermission(user.permissions, required),
      canAny: (required) => user.isSuperAdmin || hasAnyPermission(user.permissions, required),
      refresh: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
      logout: () => logoutMutation.mutate(),
      loggingOut: logoutMutation.isPending,
    };
  }, [user, queryClient, logoutMutation]);

  if (meQuery.isPending || unauthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingBlock label="Checking your session…" />
      </div>
    );
  }

  if (meQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md">
          <ErrorState error={meQuery.error} onRetry={() => meQuery.refetch()} />
        </div>
      </div>
    );
  }

  if (!value) return null;

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
