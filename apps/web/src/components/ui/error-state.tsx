'use client';

import { CircleAlert, RotateCcw } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './button';

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/** Inline error panel with the API's human-friendly message and a retry action. */
export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-6 py-10 text-center',
        className,
      )}
    >
      <CircleAlert className="h-6 w-6 text-destructive" aria-hidden />
      <p className="text-sm font-medium text-destructive">
        {getErrorMessage(error, 'Failed to load data.')}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RotateCcw aria-hidden /> Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Compact form-level error message (login failures, server rejections). */
export function FormError({ message, className }: { message?: string | null; className?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive',
        className,
      )}
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
