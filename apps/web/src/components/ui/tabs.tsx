'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Accessible tabs following the WAI-ARIA tabs pattern: roving tabindex,
 * ArrowLeft/ArrowRight/Home/End navigation, automatic activation, and
 * aria-controls/aria-labelledby wiring. Inactive panels are unmounted so tab
 * content only fetches when shown.
 */

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
  /** Registration order of triggers, for arrow-key navigation. */
  registerTrigger: (value: string) => () => void;
  triggerValues: string[];
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error('Tabs components must be used inside <Tabs>');
  return context;
}

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const baseId = React.useId();
  const [triggerValues, setTriggerValues] = React.useState<string[]>([]);

  const registerTrigger = React.useCallback((triggerValue: string) => {
    setTriggerValues((current) =>
      current.includes(triggerValue) ? current : [...current, triggerValue],
    );
    return () => {
      setTriggerValues((current) => current.filter((existing) => existing !== triggerValue));
    };
  }, []);

  const context = React.useMemo<TabsContextValue>(
    () => ({ value, setValue: onValueChange, baseId, registerTrigger, triggerValues }),
    [value, onValueChange, baseId, registerTrigger, triggerValues],
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({
  children,
  className,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="inline-flex min-w-full items-center gap-1 border-b"
      >
        {children}
      </div>
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { value: active, setValue, baseId, registerTrigger, triggerValues } = useTabsContext();
  const ref = React.useRef<HTMLButtonElement>(null);
  const selected = active === value;

  React.useEffect(() => registerTrigger(value), [registerTrigger, value]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const index = triggerValues.indexOf(value);
    if (index === -1) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % triggerValues.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + triggerValues.length) % triggerValues.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = triggerValues.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextValue = triggerValues[nextIndex]!;
    setValue(nextValue);
    // Move focus to the newly-active trigger (automatic activation pattern).
    const tablist = ref.current?.closest('[role="tablist"]');
    tablist
      ?.querySelector<HTMLButtonElement>(`[data-tab-value="${CSS.escape(nextValue)}"]`)
      ?.focus();
  };

  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      data-tab-value={value}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => setValue(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
        selected
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { value: active, baseId } = useTabsContext();
  if (active !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn('pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      {children}
    </div>
  );
}
