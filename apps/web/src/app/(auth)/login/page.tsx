import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth/login-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingBlock } from '@/components/ui/spinner';

export const metadata: Metadata = {
  title: 'Sign in',
};

export default function LoginPage() {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <img src="/gem-logo.png" alt="GEM-ENI logo" className="h-16 w-auto" />
        <div>
          <h1 className="text-lg font-semibold">GEM-ENI</h1>
          <p className="text-sm text-muted-foreground">ERP &amp; Inventory Management · GemCor</p>
        </div>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your GEM-ENI account credentials.</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<LoadingBlock />}>
            <LoginForm />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
