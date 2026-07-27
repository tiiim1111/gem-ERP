'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogIn } from 'lucide-react';
import { getErrorMessage, isApiClientError } from '@/lib/api';
import { login } from '@/lib/endpoints';
import { Button } from '@/components/ui/button';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginValues = z.infer<typeof loginSchema>;

/** Only allow same-origin relative paths as post-login destinations. */
function safeNextPath(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/';
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [serverError, setServerError] = React.useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      await login(values);
      // Drop any cached data from a previous session before entering.
      queryClient.clear();
      router.replace(safeNextPath(searchParams.get('next')));
    } catch (error) {
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field === 'email' || field === 'password') {
            form.setError(field, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error, 'Login failed. Please try again.'));
    }
  });

  const { errors, isSubmitting } = form.formState;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={serverError} />
      <FormField label="Email" htmlFor="login-email" error={errors.email?.message} required>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          placeholder="you@gemcor.dev"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'login-email-error' : undefined}
          {...form.register('email')}
        />
      </FormField>
      <FormField label="Password" htmlFor="login-password" error={errors.password?.message} required>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'login-password-error' : undefined}
          {...form.register('password')}
        />
      </FormField>
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {!isSubmitting && <LogIn aria-hidden />}
        Sign in
      </Button>
    </form>
  );
}
