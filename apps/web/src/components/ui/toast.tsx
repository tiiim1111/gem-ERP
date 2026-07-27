'use client';

import * as React from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Sonner-style stacked notifications with auto-dismiss. */

export type ToastVariant = 'default' | 'success' | 'destructive';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Auto-dismiss delay; defaults to 5s (8s for destructive). */
  durationMs?: number;
}

interface ToastRecord extends ToastOptions {
  id: number;
}

interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

let nextToastId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastRecord[]>([]);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = React.useCallback(
    (options: ToastOptions) => {
      const id = nextToastId++;
      const duration = options.durationMs ?? (options.variant === 'destructive' ? 8000 : 5000);
      setToasts((current) => [...current.slice(-4), { ...options, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  React.useEffect(() => {
    const activeTimers = timers.current;
    return () => {
      activeTimers.forEach((timer) => clearTimeout(timer));
      activeTimers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((item) => (
          <ToastItem key={item.id} toast={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ToastRecord; onDismiss: () => void }) {
  const variant = toast.variant ?? 'default';
  const Icon = variant === 'success' ? CheckCircle2 : variant === 'destructive' ? CircleAlert : Info;
  return (
    <div
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-lg border bg-background p-3 shadow-lg animate-toast-in',
        variant === 'success' && 'border-success/40',
        variant === 'destructive' && 'border-destructive/40',
      )}
    >
      <Icon
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0',
          variant === 'success' && 'text-success',
          variant === 'destructive' && 'text-destructive',
          variant === 'default' && 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="flex-1 space-y-0.5">
        <p className="text-sm font-medium leading-tight">{toast.title}</p>
        {toast.description ? (
          <p className="text-sm leading-snug text-muted-foreground">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
