'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listAssets,
  listBranches,
  listDepartments,
  listItems,
  listLookupValues,
  listLots,
  listStorageLocations,
  listWarehouses,
  type LookupType,
} from '@/lib/endpoints';
import {
  assetTag,
  formatQuantity,
  itemRefLabel,
  lotAvailable,
  lotExpiry,
  lotNumber,
  type Asset,
  type Item,
  type Lot,
} from '@/lib/types';
import { formatDate } from '@/lib/utils';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useSession } from '@/components/auth/session-provider';
import { Combobox } from '@/components/ui/combobox';
import { Select } from '@/components/ui/select';

/* ------------------------------ Branch select ----------------------------- */

/** Branches the session user can act in (server already scopes the list). */
export function useBranchOptions() {
  const { user } = useSession();
  const branchesQuery = useQuery({
    queryKey: ['branches', 'options'],
    queryFn: ({ signal }) => listBranches({ page: 1, pageSize: 100, isActive: true }, signal),
  });
  const branches = (branchesQuery.data?.data ?? []).filter(
    (branch) => user.isSuperAdmin || user.branchIds.includes(branch.id),
  );
  return { branches, isLoading: branchesQuery.isPending };
}

export function BranchSelect({
  id,
  value,
  onChange,
  disabled,
  required,
  'aria-invalid': ariaInvalid,
}: {
  id: string;
  value: string;
  onChange: (branchId: string) => void;
  disabled?: boolean;
  required?: boolean;
  'aria-invalid'?: boolean;
}) {
  const { branches, isLoading } = useBranchOptions();

  // Auto-scope: with exactly one accessible branch, select it.
  React.useEffect(() => {
    if (!value && branches.length === 1) onChange(branches[0]!.id);
  }, [value, branches, onChange]);

  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || isLoading}
      required={required}
      aria-invalid={ariaInvalid}
    >
      <option value="">Select branch…</option>
      {branches.map((branch) => (
        <option key={branch.id} value={branch.id}>
          {branch.name} ({branch.code})
        </option>
      ))}
    </Select>
  );
}

/* ---------------------------- Warehouse select ---------------------------- */

export function WarehouseSelect({
  id,
  branchId,
  value,
  onChange,
  disabled,
  'aria-invalid': ariaInvalid,
}: {
  id: string;
  branchId: string;
  value: string;
  onChange: (warehouseId: string) => void;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}) {
  const warehousesQuery = useQuery({
    queryKey: ['warehouses', 'options', branchId],
    queryFn: ({ signal }) => listWarehouses(branchId, { page: 1, pageSize: 100 }, signal),
    enabled: !!branchId,
  });
  const warehouses = (warehousesQuery.data?.data ?? []).filter((warehouse) => warehouse.isActive);

  React.useEffect(() => {
    if (branchId && !value && warehouses.length === 1) onChange(warehouses[0]!.id);
  }, [branchId, value, warehouses, onChange]);

  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || !branchId || warehousesQuery.isPending}
      aria-invalid={ariaInvalid}
    >
      <option value="">{branchId ? 'Select warehouse…' : 'Pick a branch first'}</option>
      {warehouses.map((warehouse) => (
        <option key={warehouse.id} value={warehouse.id}>
          {warehouse.name} ({warehouse.code})
        </option>
      ))}
    </Select>
  );
}

/* ------------------------- Storage location select ------------------------ */

export function LocationSelect({
  id,
  warehouseId,
  value,
  onChange,
  disabled,
  allowEmptyLabel = 'No specific location',
}: {
  id: string;
  warehouseId: string;
  value: string;
  onChange: (locationId: string) => void;
  disabled?: boolean;
  allowEmptyLabel?: string;
}) {
  const locationsQuery = useQuery({
    queryKey: ['storage-locations', 'options', warehouseId],
    queryFn: ({ signal }) => listStorageLocations(warehouseId, { page: 1, pageSize: 100 }, signal),
    enabled: !!warehouseId,
  });
  const locations = (locationsQuery.data?.data ?? []).filter((location) => location.isActive);

  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || !warehouseId || locationsQuery.isPending}
    >
      <option value="">{warehouseId ? allowEmptyLabel : 'Pick a warehouse first'}</option>
      {locations.map((location) => (
        <option key={location.id} value={location.id}>
          {location.name} ({location.code})
        </option>
      ))}
    </Select>
  );
}

/* -------------------------------- Item picker ----------------------------- */

export function ItemPicker({
  id,
  value,
  onSelect,
  selectedLabel,
  trackingMethod,
  businessCategory,
  disabled,
  placeholder = 'Search items by SKU or name…',
  'aria-invalid': ariaInvalid,
}: {
  id: string;
  value: string | null;
  /** Passes the full item so callers can read base UOM / conversions / flags. */
  onSelect: (item: Item | null) => void;
  selectedLabel?: string | null;
  trackingMethod?: string;
  businessCategory?: string;
  disabled?: boolean;
  placeholder?: string;
  'aria-invalid'?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query);

  const itemsQuery = useQuery({
    queryKey: ['items', 'picker', debouncedQuery, trackingMethod ?? '', businessCategory ?? ''],
    queryFn: ({ signal }) =>
      listItems(
        {
          page: 1,
          pageSize: 20,
          q: debouncedQuery || undefined,
          trackingMethod: trackingMethod || undefined,
          businessCategory: businessCategory || undefined,
          isActive: true,
        },
        signal,
      ),
  });

  const items = itemsQuery.data?.data ?? [];
  const options = items.map((item) => ({
    id: item.id,
    label: item.name,
    description: `${item.sku}${item.baseUom?.code ? ` · base ${item.baseUom.code}` : ''}`,
  }));
  const selected = options.find((option) => option.id === value);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={(itemId) => {
        onSelect(itemId ? (items.find((item) => item.id === itemId) ?? null) : null);
      }}
      selectedLabel={selected?.label ?? selectedLabel ?? (value ? 'Selected item' : '')}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={itemsQuery.isFetching}
      disabled={disabled}
      placeholder={placeholder}
      emptyMessage="No items match your search."
      aria-invalid={ariaInvalid}
    />
  );
}

/* ----------------------------- Department select -------------------------- */

export function DepartmentSelect({
  id,
  value,
  onChange,
  disabled,
  'aria-invalid': ariaInvalid,
}: {
  id: string;
  value: string;
  onChange: (departmentId: string) => void;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}) {
  const departmentsQuery = useQuery({
    queryKey: ['departments', 'options'],
    queryFn: ({ signal }) => listDepartments({ page: 1, pageSize: 100, isActive: true }, signal),
  });

  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || departmentsQuery.isPending}
      aria-invalid={ariaInvalid}
    >
      <option value="">Select department…</option>
      {(departmentsQuery.data?.data ?? []).map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      ))}
    </Select>
  );
}

/* ------------------------------ Lookup select ----------------------------- */

/** Business-managed lookup values (adjustment reasons, conditions, …). */
export function LookupSelect({
  id,
  type,
  value,
  onChange,
  valueField = 'id',
  placeholder = 'Select…',
  disabled,
  'aria-invalid': ariaInvalid,
}: {
  id: string;
  type: LookupType;
  value: string;
  onChange: (value: string) => void;
  /** Which lookup field to use as the option value (`id` or `code`). */
  valueField?: 'id' | 'code';
  placeholder?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}) {
  const lookupQuery = useQuery({
    queryKey: ['lookups', type, 'options'],
    queryFn: ({ signal }) => listLookupValues(type, { page: 1, pageSize: 100, isActive: true }, signal),
  });

  return (
    <Select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || lookupQuery.isPending}
      aria-invalid={ariaInvalid}
    >
      <option value="">{placeholder}</option>
      {(lookupQuery.data?.data ?? []).map((entry) => (
        <option key={entry.id} value={valueField === 'code' ? entry.code : entry.id}>
          {entry.name}
        </option>
      ))}
    </Select>
  );
}

/* -------------------------------- Lot select ------------------------------ */

/** Existing lots for an item at a warehouse, FEFO-ordered (earliest expiry first). */
export function useLotOptions(itemId: string | null, warehouseId: string) {
  const lotsQuery = useQuery({
    queryKey: ['lots', 'options', itemId, warehouseId],
    queryFn: ({ signal }) =>
      listLots(
        {
          page: 1,
          pageSize: 100,
          itemId: itemId ?? undefined,
          warehouseId: warehouseId || undefined,
          sort: 'expiryDate:asc',
        },
        signal,
      ),
    enabled: !!itemId,
  });
  return { lots: lotsQuery.data?.data ?? [], isLoading: lotsQuery.isFetching };
}

/* -------------------------------- Asset picker ---------------------------- */

export function AssetPicker({
  id,
  value,
  onSelect,
  selectedLabel,
  status,
  branchId,
  disabled,
  placeholder = 'Search assets by tag or serial…',
  'aria-invalid': ariaInvalid,
}: {
  id: string;
  value: string | null;
  onSelect: (asset: Asset | null) => void;
  selectedLabel?: string | null;
  /** Restrict to a lifecycle status (e.g. AVAILABLE for transfer lines). */
  status?: string;
  branchId?: string;
  disabled?: boolean;
  placeholder?: string;
  'aria-invalid'?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query);

  const assetsQuery = useQuery({
    queryKey: ['assets', 'picker', debouncedQuery, status ?? '', branchId ?? ''],
    queryFn: ({ signal }) =>
      listAssets(
        {
          page: 1,
          pageSize: 20,
          q: debouncedQuery || undefined,
          status: status || undefined,
          branchId: branchId || undefined,
        },
        signal,
      ),
  });

  const assets = assetsQuery.data?.data ?? [];
  const options = assets.map((asset) => ({
    id: asset.id,
    label: assetTag(asset),
    description: itemRefLabel(asset.item ?? null),
  }));
  const selected = options.find((option) => option.id === value);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={(assetId) => {
        onSelect(assetId ? (assets.find((asset) => asset.id === assetId) ?? null) : null);
      }}
      selectedLabel={selected?.label ?? selectedLabel ?? (value ? 'Selected asset' : '')}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={assetsQuery.isFetching}
      disabled={disabled}
      placeholder={placeholder}
      emptyMessage="No assets match your search."
      aria-invalid={ariaInvalid}
    />
  );
}

export function lotOptionLabel(lot: Lot): string {
  const expiry = lotExpiry(lot);
  const available = lotAvailable(lot) ?? lotOnHandForLabel(lot);
  const parts = [lotNumber(lot)];
  if (expiry) parts.push(`exp ${formatDate(expiry)}`);
  if (available !== null) parts.push(`${formatQuantity(available)} avail`);
  return parts.join(' · ');
}

function lotOnHandForLabel(lot: Lot) {
  return lot.onHand ?? lot.quantityOnHand ?? null;
}
