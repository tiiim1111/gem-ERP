'use client';

import * as React from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ComboboxOption {
  id: string;
  label: string;
  description?: string;
}

export interface ComboboxProps {
  id: string;
  /** Selected option id (null = nothing selected). */
  value: string | null;
  onChange: (id: string | null) => void;
  /** Label to render for the current selection when the list is closed. */
  selectedLabel?: string | null;
  /** Options for the CURRENT query (server-filtered by the parent). */
  options: ComboboxOption[];
  /** Free-text query, controlled by the parent (debounce upstream). */
  query: string;
  onQueryChange: (query: string) => void;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  'aria-invalid'?: boolean;
}

/**
 * Accessible single-select combobox with server-side search: role=combobox
 * input + role=listbox popup, aria-activedescendant highlight, ArrowUp/Down,
 * Enter to select, Escape to close, clear button. The parent owns the option
 * list and query so any paginated endpoint can back it.
 */
export function Combobox({
  id,
  value,
  onChange,
  selectedLabel,
  options,
  query,
  onQueryChange,
  loading = false,
  disabled = false,
  placeholder = 'Search…',
  emptyMessage = 'No matches found.',
  'aria-invalid': ariaInvalid,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listboxId = `${id}-listbox`;

  // Clamp highlight when the option set changes.
  React.useEffect(() => {
    setHighlighted((current) => Math.min(current, Math.max(options.length - 1, 0)));
  }, [options.length]);

  // Outside click closes and resets the query to the selection.
  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      onQueryChange('');
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, onQueryChange]);

  const select = (option: ComboboxOption) => {
    onChange(option.id);
    onQueryChange('');
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    onQueryChange('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setHighlighted((current) => Math.min(current + 1, options.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      if (open && options[highlighted]) {
        event.preventDefault();
        select(options[highlighted]!);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.stopPropagation();
        setOpen(false);
        onQueryChange('');
      }
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  const displayValue = open ? query : (selectedLabel ?? '');

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            open && options[highlighted] ? `${id}-option-${options[highlighted]!.id}` : undefined
          }
          aria-invalid={ariaInvalid}
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          value={displayValue}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            if (!open) setOpen(true);
            onQueryChange(event.target.value);
            setHighlighted(0);
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-background py-1 pl-3 text-sm shadow-sm transition-colors',
            value ? 'pr-14' : 'pr-8',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive',
          )}
        />
        <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 pr-2">
          {value && !disabled ? (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear selection"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <ChevronDown className="pointer-events-none h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </div>
      </div>

      {open ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={placeholder}
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-background py-1 shadow-lg"
        >
          {loading && options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground" role="presentation">
              Loading…
            </li>
          ) : options.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground" role="presentation">
              {emptyMessage}
            </li>
          ) : (
            options.map((option, index) => (
              <li
                key={option.id}
                id={`${id}-option-${option.id}`}
                role="option"
                aria-selected={option.id === value}
                onMouseEnter={() => setHighlighted(index)}
                onMouseDown={(event) => {
                  // mousedown (not click) so selection wins over input blur.
                  event.preventDefault();
                  select(option);
                }}
                className={cn(
                  'flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm',
                  index === highlighted && 'bg-accent text-accent-foreground',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  {option.description ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {option.id === value ? <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
