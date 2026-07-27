import { Suspense } from 'react';
import { SessionProvider } from '@/components/auth/session-provider';
import { AppShell } from '@/components/layout/app-shell';
import { LoadingBlock } from '@/components/ui/spinner';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <LoadingBlock label="Loading…" />
        </div>
      }
    >
      <SessionProvider>
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </Suspense>
  );
}
