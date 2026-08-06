'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { listUsers } from '@/lib/endpoints';
import { isApiClientError } from '@/lib/api';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { Combobox } from '@/components/ui/combobox';
import type { UserRecord } from '@/lib/types';

/**
 * Server-searched user combobox (delegates, named approvers). Listing users
 * needs user.view — when the caller lacks it, the picker degrades to a
 * friendly message instead of an error wall.
 */
export function UserPicker({
  id,
  value,
  onSelect,
  selectedLabel,
  disabled,
  placeholder = 'Search users by name or email…',
  'aria-invalid': ariaInvalid,
}: {
  id: string;
  value: string | null;
  onSelect: (user: UserRecord | null) => void;
  selectedLabel?: string | null;
  disabled?: boolean;
  placeholder?: string;
  'aria-invalid'?: boolean;
}) {
  const [query, setQuery] = React.useState('');
  const debouncedQuery = useDebouncedValue(query);

  const usersQuery = useQuery({
    queryKey: ['users', 'picker', debouncedQuery],
    queryFn: ({ signal }) =>
      listUsers({ page: 1, pageSize: 20, q: debouncedQuery || undefined, isActive: true }, signal),
    retry: false,
  });

  const forbidden = isApiClientError(usersQuery.error) && usersQuery.error.status === 403;
  const users = usersQuery.data?.data ?? [];
  const options = users.map((user) => ({
    id: user.id,
    label: user.displayName,
    description: user.email,
  }));
  const selected = options.find((option) => option.id === value);

  return (
    <Combobox
      id={id}
      value={value}
      onChange={(userId) => onSelect(userId ? (users.find((user) => user.id === userId) ?? null) : null)}
      selectedLabel={selected?.label ?? selectedLabel ?? (value ? 'Selected user' : '')}
      options={options}
      query={query}
      onQueryChange={setQuery}
      loading={usersQuery.isFetching}
      disabled={disabled}
      placeholder={placeholder}
      emptyMessage={
        forbidden
          ? 'You need user view access to search users — ask an administrator to set this up.'
          : 'No users match your search.'
      }
      aria-invalid={ariaInvalid}
    />
  );
}
