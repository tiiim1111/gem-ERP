import { Suspense } from 'react';
import { SessionProvider } from '@/components/auth/session-provider';
import { AppShell } from '@/components/layout/app-shell';
import { AppSplash } from '@/components/layout/app-splash';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppSplash label="Starting GEM-ENI…" />}>
      <SessionProvider>
        <AppShell>{children}</AppShell>
      </SessionProvider>
    </Suspense>
  );
}
