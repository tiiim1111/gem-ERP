'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Hand-rolled accessible modal dialog: portal, overlay, focus trap, Escape and
 * overlay-click dismissal, focus restoration, and body scroll locking.
 */

interface DialogContextValue {
  onOpenChange: (open: boolean) => void;
  labelId: string;
  descriptionId: string;
}

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialogContext(): DialogContextValue {
  const context = React.useContext(DialogContext);
  if (!context) throw new Error('Dialog components must be used inside <Dialog>');
  return context;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const labelId = React.useId();
  const descriptionId = React.useId();
  const panelRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocused = React.useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  // Keep a stable reference so the focus-trap effect below only re-runs when
  // `open` flips — inline onOpenChange closures from parents must not retrigger
  // it (that would steal focus back to the first field on every re-render).
  const onOpenChangeRef = React.useRef(onOpenChange);
  React.useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  // Focus management + scroll lock while open.
  React.useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    if (panel) {
      const autofocus = panel.querySelector<HTMLElement>('[data-autofocus]');
      const first = autofocus ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
      first.focus();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = focusable[0]!;
      const lastEl = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === firstEl || !panelRef.current.contains(active)) {
          event.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl || !panelRef.current.contains(active)) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <DialogContext.Provider value={{ onOpenChange, labelId, descriptionId }}>
      <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
        <div
          className="fixed inset-0 bg-black/50 animate-fade-in"
          aria-hidden="true"
          onClick={() => onOpenChange(false)}
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className="relative z-10 flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-lg border bg-background shadow-lg outline-none animate-zoom-in sm:rounded-lg"
        >
          {children}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body,
  );
}

export function DialogHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  const { onOpenChange } = useDialogContext();
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b px-5 py-4', className)}>
      <div className="space-y-1">{children}</div>
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Close dialog"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function DialogTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  const { labelId } = useDialogContext();
  return (
    <h2 id={labelId} className={cn('text-base font-semibold leading-none', className)}>
      {children}
    </h2>
  );
}

export function DialogDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { descriptionId } = useDialogContext();
  return (
    <p id={descriptionId} className={cn('text-sm text-muted-foreground', className)}>
      {children}
    </p>
  );
}

export function DialogBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex-1 overflow-y-auto px-5 py-4', className)}>{children}</div>;
}

export function DialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex flex-col-reverse gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end',
        className,
      )}
    >
      {children}
    </div>
  );
}
