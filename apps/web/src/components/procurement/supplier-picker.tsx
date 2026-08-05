'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { listSuppliers } from '@/lib/endpoints';
import { supplierName, type Supplier } from '@/lib/types';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Combobox } from '@/components/ui/combobox';

/** Server-searched supplier combobox (active suppliers only by default). */
export function SupplierPicker({
  id,
  value,
  onSelect,
  selectedLabel,
  activeOnly = true,
  disabled,
  placeholder = 'Search suppliers by code or name…',
  'aria-invalid': ariaInvalid,
}: {
  id: string;
  value: string | null;
  /** Passes the full supplier row so callers can read code/terms. */
  onSelect: (supplier: Supplier | null) => void;
  selectedLabel?: string | null;
  activeOnly?: boolean;
  disabled?: boolean;
  placeholder?: string;
  'aria-invalid'?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query);

  const suppliersQuery = useQuery({
    queryKey: ['suppliers', 'picker', debouncedQuery, activeOnly],
    queryFn: ({ signal }) =>
      listSuppliers(
        {
          page: 1,
          pageSize: 20,
          q: debouncedQuery || undefined,
          isActive: activeOnly ? true : undefined,
        },
        signal,
      ),
  });

  const suppliers = suppliersQuery.data?.data ?? [];
  const options = suppliers.map((supplier) => ({
    id: supplier.id,
    label: supplierName(supplier),
    description: supplier.code,
  }));
  const selected = options.find((option) => option.id === value);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={(supplierId) => {
        onSelect(supplierId ? (suppliers.find((entry) => entry.id === supplierId) ?? null) : null);
      }}
      selectedLabel={selected?.label ?? selectedLabel ?? (value ? 'Selected supplier' : '')}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={suppliersQuery.isFetching}
      disabled={disabled}
      placeholder={placeholder}
      emptyMessage="No suppliers match your search."
      aria-invalid={ariaInvalid}
    />
  );
}
