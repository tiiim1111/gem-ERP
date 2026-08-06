'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Loader2, Search } from 'lucide-react';
import { PERMISSIONS } from '@gemerp/shared';
import { isApiClientError } from '@/lib/api';
import { globalSearch } from '@/lib/endpoints';
import {
  searchResultSubtitle,
  searchResultTitle,
  type GlobalSearchResult,
  type SearchEntityType,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSession } from '@/components/auth/session-provider';

const MIN_QUERY_LENGTH = 2;

interface GroupConfig {
  label: string;
  /** Any-of permissions gating the group; null = any session. */
  permissions: readonly string[] | null;
  href: (row: GlobalSearchResult) => string;
}

const GROUP_CONFIG: Record<SearchEntityType, GroupConfig> = {
  asset: {
    label: 'Assets',
    permissions: [PERMISSIONS.asset.view, PERMISSIONS.asset.viewOwn],
    href: (row) => `/assets/${row.id}`,
  },
  item: {
    label: 'Items',
    permissions: [PERMISSIONS.item.view],
    href: (row) => `/items/${row.id}`,
  },
  employee: {
    label: 'Employees',
    permissions: [PERMISSIONS.employee.view],
    href: (row) => `/employees?detail=${row.id}`,
  },
  supplier: {
    label: 'Suppliers',
    permissions: [PERMISSIONS.supplier.view],
    href: (row) => `/suppliers/${row.id}`,
  },
  purchase_order: {
    label: 'Purchase orders',
    permissions: [PERMISSIONS.procurementPo.view],
    href: (row) => `/procurement/purchase-orders/${row.id}`,
  },
  goods_receipt: {
    label: 'Goods receipts',
    permissions: [PERMISSIONS.procurementReceipt.view, PERMISSIONS.procurementPo.view],
    href: (row) => `/procurement/receipts/${row.id}`,
  },
  work_order: {
    label: 'Work orders',
    permissions: [PERMISSIONS.maintenanceWorkOrder.view],
    href: (row) => `/maintenance/work-orders/${row.id}`,
  },
  stock_transaction: {
    label: 'Stock transactions',
    permissions: [PERMISSIONS.inventory.view],
    href: (row) => `/inventory/transactions/${row.id}`,
  },
  transfer: {
    label: 'Transfers',
    permissions: [PERMISSIONS.transfer.view],
    href: (row) => `/inventory/transfers/${row.id}`,
  },
  lot: {
    label: 'Lots',
    permissions: [PERMISSIONS.inventory.view],
    href: () => '/inventory/lots',
  },
};

interface FlatResult {
  type: SearchEntityType;
  row: GlobalSearchResult;
  href: string;
}

/**
 * Topbar global search (contract §4.7): debounced query across asset tags,
 * serials, SKUs, employees, suppliers, POs, receipts, WOs, and document
 * numbers. The server filters by permission and branch scope; groups are
 * additionally gated client-side so a group never renders for a session that
 * cannot open its pages. Keyboard: Ctrl/Cmd+K focuses, arrows navigate,
 * Enter opens, Escape closes.
 */
export function GlobalSearch() {
  const router = useRouter();
  const { canAny } = useSession();

  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listboxId = React.useId();

  const debounced = useDebouncedValue(query.trim());
  const enabled = debounced.length >= MIN_QUERY_LENGTH;

  const searchQuery = useQuery({
    queryKey: ['search', 'global', debounced],
    queryFn: ({ signal }) => globalSearch(debounced, signal),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  // Groups the session may open, flattened for keyboard navigation.
  const groups = React.useMemo(() => {
    return (searchQuery.data ?? []).filter((group) => {
      const config = GROUP_CONFIG[group.type];
      return config.permissions === null || canAny(config.permissions);
    });
  }, [searchQuery.data, canAny]);

  const flat = React.useMemo<FlatResult[]>(
    () =>
      groups.flatMap((group) =>
        group.results.map((row) => ({
          type: group.type,
          row,
          href: GROUP_CONFIG[group.type].href(row),
        })),
      ),
    [groups],
  );

  React.useEffect(() => {
    setActiveIndex(0);
  }, [debounced, groups.length]);

  // Close on outside interaction.
  React.useEffect(() => {
    if (!open) return;
    const handle = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Ctrl/Cmd+K focuses the search box from anywhere in the app.
  React.useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', handle);
    return () => document.removeEventListener('keydown', handle);
  }, []);

  const navigate = (result: FlatResult) => {
    setOpen(false);
    setQuery('');
    router.push(result.href);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || flat.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % flat.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + flat.length) % flat.length);
    } else if (event.key === 'Enter') {
      const target = flat[activeIndex] ?? flat[0];
      if (target) {
        event.preventDefault();
        navigate(target);
      }
    }
  };

  const showDropdown = open && query.trim().length >= MIN_QUERY_LENGTH;
  const searchUnavailable =
    searchQuery.isError &&
    isApiClientError(searchQuery.error) &&
    (searchQuery.error.status === 404 || searchQuery.error.status === 501);

  // Running offset so each option gets its stable flat index for aria/active.
  let optionOffset = 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-activedescendant={
            showDropdown && flat[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined
          }
          aria-label="Search assets, items, employees, and documents"
          placeholder="Search tags, SKUs, people, documents…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          className={cn(
            'h-9 w-full rounded-md border border-input bg-background pl-8 pr-12 text-sm shadow-sm',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'placeholder:text-muted-foreground',
          )}
        />
        {searchQuery.isFetching && enabled ? (
          <Loader2
            className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden
          />
        ) : (
          <kbd
            className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block"
            aria-hidden
          >
            Ctrl K
          </kbd>
        )}
      </div>

      {showDropdown ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border bg-background shadow-lg"
        >
          {searchQuery.isPending ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Searching…</p>
          ) : searchUnavailable ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              Global search is not available on this server yet.
            </p>
          ) : searchQuery.isError ? (
            <p className="px-3 py-4 text-sm text-destructive">
              Search failed — try again in a moment.
            </p>
          ) : flat.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No matches for “{debounced}”.
            </p>
          ) : (
            groups.map((group) => {
              const start = optionOffset;
              optionOffset += group.results.length;
              return (
                <div key={group.type} className="py-1">
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {GROUP_CONFIG[group.type].label}
                  </p>
                  {group.results.map((row, index) => {
                    const flatIndex = start + index;
                    const active = flatIndex === activeIndex;
                    const subtitle = searchResultSubtitle(group.type, row);
                    return (
                      <button
                        key={row.id}
                        id={`${listboxId}-option-${flatIndex}`}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        onClick={() => navigate({ type: group.type, row, href: GROUP_CONFIG[group.type].href(row) })}
                        className={cn(
                          'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left',
                          'focus-visible:outline-none',
                          active ? 'bg-accent' : 'hover:bg-accent/60',
                        )}
                      >
                        <span className="w-full truncate text-sm font-medium">
                          {searchResultTitle(group.type, row)}
                        </span>
                        {subtitle ? (
                          <span className="w-full truncate text-xs text-muted-foreground">
                            {subtitle}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
