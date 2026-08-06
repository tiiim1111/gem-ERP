'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, ClipboardCheck, Trash2 } from 'lucide-react';
import { getErrorMessage } from '@/lib/api';
import {
  createCountSession,
  listItemCategories,
  type CountSessionCreateBody,
} from '@/lib/endpoints';
import { itemRefLabel, type Item } from '@/lib/types';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  BranchSelect,
  ItemPicker,
  LocationSelect,
  WarehouseSelect,
} from '@/components/inventory/pickers';

interface ScopedItem {
  id: string;
  label: string;
}

/**
 * New count session (contract §7.1): scope narrows branch → warehouse →
 * location, optionally by category and/or selected items; blind hides expected
 * quantities from counters; full vs cycle sets the coverage intent.
 */
export function CountCreate() {
  const router = useRouter();
  const { toast } = useToast();

  const [type, setType] = React.useState<'full' | 'cycle'>('full');
  const [blind, setBlind] = React.useState(false);
  const [branchId, setBranchId] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState('');
  const [locationId, setLocationId] = React.useState('');
  const [categoryId, setCategoryId] = React.useState('');
  const [items, setItems] = React.useState<ScopedItem[]>([]);
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['item-categories', 'options'],
    queryFn: ({ signal }) => listItemCategories({ page: 1, pageSize: 100, isActive: true }, signal),
  });

  const createMutation = useMutation({
    mutationFn: (body: CountSessionCreateBody) => createCountSession(body),
    onSuccess: (session) => {
      toast({ title: 'Count session created', variant: 'success' });
      router.push(`/inventory/counts/${session.id}`);
    },
    onError: (err) => setError(getErrorMessage(err)),
  });

  const addItem = (item: Item | null) => {
    if (!item) return;
    setItems((current) =>
      current.some((entry) => entry.id === item.id)
        ? current
        : [...current, { id: item.id, label: itemRefLabel(item) }],
    );
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!branchId) return setError('Branch is required.');
    setError(null);
    createMutation.mutate({
      scope: {
        branchId,
        warehouseId: warehouseId || undefined,
        locationId: locationId || undefined,
        categoryId: categoryId || undefined,
        itemIds: items.length > 0 ? items.map((entry) => entry.id) : undefined,
      },
      blind,
      type,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <>
      <PageHeader
        title="New count session"
        description="Starting the count freezes a snapshot of expected balances for the chosen scope."
        actions={
          <Link href="/inventory/counts" className={buttonVariants({ variant: 'outline' })}>
            <ArrowLeft aria-hidden /> Back to counts
          </Link>
        }
      />

      <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Count type</CardTitle>
            <CardDescription>
              Full counts cover the whole scope; cycle counts target a rotating slice of it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Count type">
              {(
                [
                  { value: 'full', label: 'Full count', hint: 'Everything in scope' },
                  { value: 'cycle', label: 'Cycle count', hint: 'A targeted slice' },
                ] as const
              ).map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  role="radio"
                  aria-checked={type === entry.value}
                  onClick={() => setType(entry.value)}
                  className={
                    'flex h-16 flex-col items-center justify-center gap-0.5 rounded-lg border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
                    (type === entry.value ? 'border-primary bg-primary/5 text-primary' : 'hover:border-primary/40')
                  }
                >
                  {entry.label}
                  <span className="text-[11px] font-normal text-muted-foreground">{entry.hint}</span>
                </button>
              ))}
            </div>
            <label className="flex items-start gap-2.5 rounded-md border p-3">
              <Checkbox checked={blind} onChange={(event) => setBlind(event.target.checked)} />
              <span>
                <span className="block text-sm font-medium">Blind count</span>
                <span className="block text-xs text-muted-foreground">
                  Counters do not see the expected quantities — variances only surface at review.
                </span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scope</CardTitle>
            <CardDescription>
              Branch is required. Narrow further by warehouse, location, category, or specific items.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField label="Branch" htmlFor="count-branch" required>
              <BranchSelect
                id="count-branch"
                value={branchId}
                onChange={(value) => {
                  setBranchId(value);
                  setWarehouseId('');
                  setLocationId('');
                }}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Warehouse" htmlFor="count-warehouse" hint="Optional — all warehouses when empty.">
                <WarehouseSelect
                  id="count-warehouse"
                  branchId={branchId}
                  value={warehouseId}
                  onChange={(value) => {
                    setWarehouseId(value);
                    setLocationId('');
                  }}
                />
              </FormField>
              <FormField label="Location" htmlFor="count-location" hint="Optional bin/room within the warehouse.">
                <LocationSelect
                  id="count-location"
                  warehouseId={warehouseId}
                  value={locationId}
                  onChange={setLocationId}
                  allowEmptyLabel="All locations"
                />
              </FormField>
            </div>
            <FormField label="Item category" htmlFor="count-category" hint="Optional — count only items in this category.">
              <Select
                id="count-category"
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                disabled={categoriesQuery.isPending}
              >
                <option value="">All categories</option>
                {(categoriesQuery.data?.data ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Specific items"
              htmlFor="count-item-picker"
              hint="Optional — restrict the count to selected items only."
            >
              <ItemPicker id="count-item-picker" value={null} onSelect={addItem} placeholder="Add an item to the scope…" />
            </FormField>
            {items.length > 0 ? (
              <ul className="divide-y rounded-md border">
                {items.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 truncate text-sm">{entry.label}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${entry.label}`}
                      onClick={() => setItems((current) => current.filter((item) => item.id !== entry.id))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <FormField label="Notes" htmlFor="count-notes">
              <Textarea
                id="count-notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Instructions for the counters…"
              />
            </FormField>
          </CardContent>
        </Card>

        <FormError message={error} />

        <div className="flex justify-end gap-2">
          <Link href="/inventory/counts" className={buttonVariants({ variant: 'outline' })}>
            Cancel
          </Link>
          <Button type="submit" loading={createMutation.isPending}>
            <ClipboardCheck aria-hidden /> Create count session
          </Button>
        </div>
      </form>
    </>
  );
}
