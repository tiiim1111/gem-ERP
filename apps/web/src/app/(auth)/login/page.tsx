import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { LoadingBlock } from '@/components/ui/spinner';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <div className="animate-rise-in space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
        <p className="text-sm text-muted-foreground">
          Use your GEM-ENI account credentials to continue.
        </p>
      </div>

      <Suspense fallback={<LoadingBlock />}>
        <LoginForm />
      </Suspense>

      <p className="text-xs text-muted-foreground">
        Forgot your password? Ask an administrator to reset it for you.
      </p>
    </div>
  );
}
