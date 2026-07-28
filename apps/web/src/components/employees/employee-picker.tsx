'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { listEmployees, listUsers } from '@/lib/endpoints';
import { employeeName } from '@/lib/types';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Combobox } from '@/components/ui/combobox';

export interface EmployeePickerProps {
  id: string;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Label of the current selection (from the parent record) for display. */
  selectedLabel?: string | null;
  /** Employee id to exclude from options (e.g. the record itself). */
  excludeId?: string;
  disabled?: boolean;
  placeholder?: string;
  'aria-invalid'?: boolean;
}

/** Server-searched employee selector (supervisor, department head, …). */
export function EmployeePicker({
  id,
  value,
  onChange,
  selectedLabel,
  excludeId,
  disabled,
  placeholder = 'Search employees…',
  'aria-invalid': ariaInvalid,
}: EmployeePickerProps) {
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query);

  const employeesQuery = useQuery({
    queryKey: ['employees', 'picker', debouncedQuery],
    queryFn: ({ signal }) =>
      listEmployees({ page: 1, pageSize: 20, q: debouncedQuery || undefined }, signal),
  });

  const options = (employeesQuery.data?.data ?? [])
    .filter((employee) => employee.id !== excludeId)
    .map((employee) => ({
      id: employee.id,
      label: employeeName(employee),
      description: employee.employeeNumber,
    }));

  const selected = options.find((option) => option.id === value);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      selectedLabel={selected?.label ?? selectedLabel ?? (value ? 'Selected employee' : '')}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={employeesQuery.isFetching}
      disabled={disabled}
      placeholder={placeholder}
      emptyMessage="No employees match your search."
      aria-invalid={ariaInvalid}
    />
  );
}

export interface UserPickerProps {
  id: string;
  value: string | null;
  onChange: (id: string | null) => void;
  selectedLabel?: string | null;
  disabled?: boolean;
  'aria-invalid'?: boolean;
}

/** Server-searched user selector for linking an employee to a login account. */
export function UserPicker({
  id,
  value,
  onChange,
  selectedLabel,
  disabled,
  'aria-invalid': ariaInvalid,
}: UserPickerProps) {
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query);

  const usersQuery = useQuery({
    queryKey: ['users', 'picker', debouncedQuery],
    queryFn: ({ signal }) =>
      listUsers({ page: 1, pageSize: 20, q: debouncedQuery || undefined }, signal),
  });

  const options = (usersQuery.data?.data ?? []).map((user) => ({
    id: user.id,
    label: user.displayName,
    description: user.email,
  }));
  const selected = options.find((option) => option.id === value);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={onChange}
      selectedLabel={selected?.label ?? selectedLabel ?? (value ? 'Selected user' : '')}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={usersQuery.isFetching}
      disabled={disabled}
      placeholder="Search users…"
      emptyMessage="No users match your search."
      aria-invalid={ariaInvalid}
    />
  );
}
