'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Checkbox } from './checkbox';

export interface CheckboxListItem {
  id: string;
  label: string;
  description?: string;
}

export interface CheckboxListProps {
  items: CheckboxListItem[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  disabled?: boolean;
  emptyLabel?: string;
  className?: string;
  'aria-label'?: string;
}

/** Scrollable multi-select checkbox list (role/branch assignment editors). */
export function CheckboxList({
  items,
  selectedIds,
  onChange,
  disabled = false,
  emptyLabel = 'No options available.',
  className,
  'aria-label': ariaLabel,
}: CheckboxListProps) {
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = (id: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    onChange([...next]);
  };

  if (items.length === 0) {
    return <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('max-h-64 space-y-0.5 overflow-y-auto rounded-md border p-1.5', className)}
    >
      {items.map((item) => (
        <label
          key={item.id}
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-accent',
            disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
          )}
        >
          <Checkbox
            className="mt-0.5"
            checked={selected.has(item.id)}
            disabled={disabled}
            onChange={(event) => toggle(item.id, event.target.checked)}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium leading-tight">{item.label}</span>
            {item.description ? (
              <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
            ) : null}
          </span>
        </label>
      ))}
    </div>
  );
}
