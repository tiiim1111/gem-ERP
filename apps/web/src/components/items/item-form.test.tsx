import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemBusinessCategory, TrackingMethod } from '@gemerp/shared';
import type { Item } from '@/lib/types';

/* ------------------------------ Test doubles ------------------------------ */

/** A promise whose resolution the test drives, to fix the arrival order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function page<T>(data: T[]) {
  return { data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } };
}

const CATEGORY = { id: 'cat-1', code: 'ITEQ', name: 'IT Equipment', isActive: true };
const OTHER_CATEGORY = { id: 'cat-2', code: 'FURN', name: 'Furniture', isActive: true };
const SUBCATEGORY = {
  id: 'sub-1',
  code: 'LAPTOP',
  name: 'Laptop',
  categoryId: 'cat-1',
  isActive: true,
};
const OTHER_SUBCATEGORY = {
  id: 'sub-2',
  code: 'CHAIR',
  name: 'Chair',
  categoryId: 'cat-2',
  isActive: true,
};
/*
 * These two appear only in the fetched lists — never seeded from the item — so
 * their arrival on the page is the signal that a list landed and the form
 * re-rendered. That re-render is the exact moment the old bug blanked a field,
 * so every assertion below waits for it; without that wait the tests would
 * pass on the seeded options alone and prove nothing.
 */
const LIST_ONLY_SUBCATEGORY = {
  id: 'sub-3',
  code: 'DESKTOP',
  name: 'Desktop',
  categoryId: 'cat-1',
  isActive: true,
};
const LIST_ONLY_UOM = { id: 'uom-2', code: 'BOX', name: 'Box', isActive: true };
const BRAND = { id: 'brand-1', code: 'DELL', name: 'Dell', isActive: true };
const MANUFACTURER = { id: 'mfr-1', code: 'DELLINC', name: 'Dell Inc.', isActive: true };
const UOM = { id: 'uom-1', code: 'PC', name: 'Piece', isActive: true };

/** What GET /items/:id actually sends: relations nested, no flat *Id. */
const ITEM: Item = {
  id: 'item-1',
  sku: 'SRL-ITEQ-00001',
  name: 'Laptop Dell Latitude 5420',
  businessCategory: ItemBusinessCategory.SERIALIZED_ASSET,
  trackingMethod: TrackingMethod.SERIAL,
  category: CATEGORY,
  subcategory: SUBCATEGORY,
  brand: BRAND,
  manufacturer: MANUFACTURER,
  model: 'Latitude 5420',
  baseUom: UOM,
  isLotTracked: false,
  isExpiryTracked: false,
  requiresSerialNumber: true,
  isMaintainable: true,
  isActive: true,
  version: 1,
  uomConversions: [],
};

const lists = {
  categories: deferred<ReturnType<typeof page>>(),
  subcategories: deferred<ReturnType<typeof page>>(),
  brands: deferred<ReturnType<typeof page>>(),
  manufacturers: deferred<ReturnType<typeof page>>(),
  uoms: deferred<ReturnType<typeof page>>(),
};

const listItemSubcategories = vi.fn();

vi.mock('@/lib/endpoints', () => ({
  ATTACHMENT_RESOURCE_TYPES: { item: 'ITEM' },
  getItem: () => Promise.resolve(ITEM),
  listItemCategories: () => lists.categories.promise,
  listItemSubcategories: (categoryId: string) => listItemSubcategories(categoryId),
  listBrands: () => lists.brands.promise,
  listManufacturers: () => lists.manufacturers.promise,
  listUoms: () => lists.uoms.promise,
  createItem: vi.fn(),
  updateItem: vi.fn(),
  activateItem: vi.fn(),
  deactivateItem: vi.fn(),
  createUomConversion: vi.fn(),
  updateUomConversion: vi.fn(),
  deleteUomConversion: vi.fn(),
}));

vi.mock('@/components/auth/session-provider', () => ({
  useSession: () => ({
    can: () => true,
    user: { id: 'u-1', email: 'test@gemcor.ph', isSuperAdmin: true, branchIds: [], roles: [] },
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/components/attachments/attachments-panel', () => ({
  AttachmentsPanel: () => null,
}));

vi.mock('./item-barcodes-card', () => ({ ItemBarcodesCard: () => null }));
vi.mock('./item-warehouse-settings-card', () => ({ ItemWarehouseSettingsCard: () => null }));

/* --------------------------------- Harness -------------------------------- */

// Imported after the mocks so the component picks them up.
const { ItemForm } = await import('./item-form');

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ItemForm itemId="item-1" />
    </QueryClientProvider>,
  );
}

/*
 * Queried by id rather than label: these assertions are about the value the
 * DOM element actually holds, which is exactly what the bug destroyed.
 */
function field(id: string): HTMLSelectElement | HTMLInputElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`no field #${id} in the document`);
  return element as HTMLSelectElement | HTMLInputElement;
}

/** Resolves every lookup list, as the requests finishing would. */
function resolveLists() {
  lists.categories.resolve(page([CATEGORY, OTHER_CATEGORY]));
  lists.brands.resolve(page([BRAND]));
  lists.manufacturers.resolve(page([MANUFACTURER]));
  lists.uoms.resolve(page([UOM, LIST_ONLY_UOM]));
  lists.subcategories.resolve(page([SUBCATEGORY, LIST_ONLY_SUBCATEGORY]));
}

/** The option values a select currently offers. */
function optionValues(id: string): string[] {
  const element = document.getElementById(id);
  return Array.from(element?.querySelectorAll('option') ?? []).map((option) => option.value);
}

/** Waits until the fetched options — not the seeded ones — are on the page. */
async function waitForListsToLand() {
  await waitFor(() => {
    expect(optionValues('item-category')).toContain(OTHER_CATEGORY.id);
    expect(optionValues('item-subcategory')).toContain(LIST_ONLY_SUBCATEGORY.id);
    expect(optionValues('item-baseuom')).toContain(LIST_ONLY_UOM.id);
  });
}

beforeEach(() => {
  for (const key of Object.keys(lists) as Array<keyof typeof lists>) {
    lists[key] = deferred();
  }
  listItemSubcategories.mockImplementation(() => lists.subcategories.promise);
});

afterEach(() => {
  vi.clearAllMocks();
});

/* ---------------------------------- Tests --------------------------------- */

describe('ItemForm hydration', () => {
  /*
   * The regression this file was written for. The subcategory list cannot
   * start loading until the category is known, and the category is only known
   * once the item lands — so that list is always the last to arrive. These are
   * uncontrolled <select>s: a value written when no matching <option> exists
   * is dropped by the browser and never re-applied, which showed up as an
   * empty Subcategory on every item, even one just saved.
   */
  it('keeps the saved subcategory when its list arrives after the item', async () => {
    renderForm();

    // The item resolves first; every lookup list is still in flight.
    await waitFor(() => expect(field('item-name')).toHaveValue(ITEM.name));
    expect(field('item-subcategory')).toHaveValue('sub-1');

    // Only now do the lists land — the order the bug depended on.
    resolveLists();
    await waitForListsToLand();

    expect(field('item-subcategory')).toHaveValue('sub-1');
    expect(field('item-subcategory')).not.toBeDisabled();
  });

  it('keeps every other saved relation through the same race', async () => {
    renderForm();
    await waitFor(() => expect(field('item-name')).toHaveValue(ITEM.name));

    resolveLists();
    await waitForListsToLand();

    expect(field('item-category')).toHaveValue('cat-1');
    expect(field('item-brand')).toHaveValue('brand-1');
    expect(field('item-manufacturer')).toHaveValue('mfr-1');
    expect(field('item-baseuom')).toHaveValue('uom-1');
  });

  /* The lists winning the race must keep working — the common cached path. */
  it('hydrates when the lookup lists arrive before the item', async () => {
    resolveLists();
    renderForm();

    await waitFor(() => expect(field('item-name')).toHaveValue(ITEM.name));
    await waitForListsToLand();

    expect(field('item-subcategory')).toHaveValue('sub-1');
    expect(field('item-category')).toHaveValue('cat-1');
    expect(field('item-baseuom')).toHaveValue('uom-1');
  });

  /*
   * The saved subcategory is seeded into the list, so it must not survive a
   * move to a category it does not belong to.
   */
  it('clears the subcategory when a different category is picked', async () => {
    renderForm();
    await waitFor(() => expect(field('item-name')).toHaveValue(ITEM.name));
    resolveLists();
    await waitForListsToLand();
    expect(field('item-subcategory')).toHaveValue('sub-1');

    // The second category's list is a fresh request with a fresh promise.
    const second = deferred<ReturnType<typeof page>>();
    listItemSubcategories.mockImplementation((categoryId: string) =>
      categoryId === 'cat-2' ? second.promise : lists.subcategories.promise,
    );

    await userEvent.selectOptions(field('item-category'), 'cat-2');
    second.resolve(page([OTHER_SUBCATEGORY]));

    await waitFor(() => expect(optionValues('item-subcategory')).toContain(OTHER_SUBCATEGORY.id));
    expect(field('item-subcategory')).toHaveValue('');
    expect(optionValues('item-subcategory')).not.toContain(SUBCATEGORY.id);
  });
});
