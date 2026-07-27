'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * Lightweight accessible dropdown menu. Content is portaled to <body> with
 * fixed positioning so it is never clipped by scroll containers (data tables).
 * Supports outside-click/Escape dismissal and ArrowUp/ArrowDown/Home/End
 * roving focus with menu semantics.
 */

interface DropdownContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  menuId: string;
}

const DropdownContext = React.createContext<DropdownContextValue | null>(null);

function useDropdownContext(): DropdownContextValue {
  const context = React.useContext(DropdownContext);
  if (!context) throw new Error('DropdownMenu components must be used inside <DropdownMenu>');
  return context;
}

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const menuId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    // Close on any scroll so the fixed-positioned menu never drifts.
    const handleScroll = (event: Event) => {
      if (contentRef.current && event.target instanceof Node && contentRef.current.contains(event.target)) {
        return; // scrolling inside the menu itself is fine
      }
      setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [open]);

  return (
    <DropdownContext.Provider value={{ open, setOpen, triggerRef, contentRef, menuId }}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownContext.Provider>
  );
}

export interface DropdownMenuTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export function DropdownMenuTrigger({ children, className, ...props }: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerRef, menuId } = useDropdownContext();
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(!open)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' && !open) {
          event.preventDefault();
          setOpen(true);
        }
      }}
      className={className}
      {...props}
    >
      {children}
    </button>
  );
}

export interface DropdownMenuContentProps {
  children: React.ReactNode;
  className?: string;
  align?: 'start' | 'end';
}

export function DropdownMenuContent({ children, className, align = 'end' }: DropdownMenuContentProps) {
  const { open, setOpen, triggerRef, contentRef, menuId } = useDropdownContext();
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null);

  // Position against the trigger once open (fixed => viewport coordinates).
  React.useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next: React.CSSProperties = { position: 'fixed', top: rect.bottom + 4 };
    if (align === 'end') {
      next.right = Math.max(8, window.innerWidth - rect.right);
    } else {
      next.left = Math.max(8, rect.left);
    }
    setStyle(next);
  }, [open, align, triggerRef]);

  React.useEffect(() => {
    if (!open || !style) return;
    const first = contentRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [open, style, contentRef]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!contentRef.current) return;
    if (event.key === 'Tab') {
      // Menus are not tab stops; close and return focus to the trigger.
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    const items = Array.from(
      contentRef.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'),
    );
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(currentIndex + 1) % items.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={contentRef}
      id={menuId}
      role="menu"
      style={style ?? { position: 'fixed', visibility: 'hidden' }}
      onKeyDown={handleKeyDown}
      className={cn(
        'z-50 max-h-[60vh] min-w-[11rem] overflow-y-auto rounded-md border bg-background p-1 shadow-md animate-zoom-in',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}

export interface DropdownMenuItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  destructive?: boolean;
}

export function DropdownMenuItem({
  className,
  destructive = false,
  onClick,
  ...props
}: DropdownMenuItemProps) {
  const { setOpen } = useDropdownContext();
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={(event) => {
        setOpen(false);
        onClick?.(event);
      }}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors',
        'hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        destructive && 'text-destructive hover:bg-destructive/10 hover:text-destructive [&_svg]:text-destructive',
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn('-mx-1 my-1 h-px bg-border', className)} />;
}

export function DropdownMenuLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}>
      {children}
    </div>
  );
}
