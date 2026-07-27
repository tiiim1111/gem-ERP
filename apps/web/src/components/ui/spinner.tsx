import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn('h-5 w-5 animate-spin text-muted-foreground', className)}
      role="status"
      aria-label="Loading"
    />
  );
}

/** Centered full-area loading indicator with an accessible label. */
export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
      <Spinner className="h-6 w-6" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
