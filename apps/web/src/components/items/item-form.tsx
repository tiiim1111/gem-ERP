'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, Plus, Power, PowerOff, Trash2 } from 'lucide-react';
import { ItemBusinessCategory, PERMISSIONS, TrackingMethod } from '@gemerp/shared';
import { getErrorMessage, isApiClientError, isVersionConflict } from '@/lib/api';
import {
  createItem,
  createUomConversion,
  deleteUomConversion,
  getItem,
  listBrands,
  listItemCategories,
  listItemSubcategories,
  listManufacturers,
  listUoms,
  updateItem,
  updateUomConversion,
  activateItem,
  deactivateItem,
  type ItemWriteBody,
} from '@/lib/endpoints';
import { formatFactor, type Item } from '@/lib/types';
import { useSession } from '@/components/auth/session-provider';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { ItemBarcodesCard } from './item-barcodes-card';
import { ItemWarehouseSettingsCard } from './item-warehouse-settings-card';

/* ----------------------------- Business rules ---------------------------- */

/** Allowed tracking methods per business category (spec §4). */
const ALLOWED_TRACKING: Record<ItemBusinessCategory, TrackingMethod[]> = {
  [ItemBusinessCategory.SERIALIZED_ASSET]: [TrackingMethod.SERIAL],
  [ItemBusinessCategory.CONSUMABLE]: [TrackingMethod.QUANTITY, TrackingMethod.LOT],
  [ItemBusinessCategory.BULK_NON_CONSUMABLE]: [TrackingMethod.QUANTITY, TrackingMethod.SERIAL],
};

/** Default tracking method per business category (spec §4). */
const DEFAULT_TRACKING: Record<ItemBusinessCategory, TrackingMethod> = {
  [ItemBusinessCategory.SERIALIZED_ASSET]: TrackingMethod.SERIAL,
  [ItemBusinessCategory.CONSUMABLE]: TrackingMethod.QUANTITY,
  [ItemBusinessCategory.BULK_NON_CONSUMABLE]: TrackingMethod.QUANTITY,
};

const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const FACTOR_PATTERN = /^\d+(\.\d{1,4})?$/;

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,63}$/;

const itemSchema = z.object({
  sku: z
    .string()
    .max(64)
    .refine(
      (value) => value === '' || SKU_PATTERN.test(value),
      'Uppercase letters, digits, "-" or "_" only — or leave blank to auto-generate',
    ),
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(2000),
  businessCategory: z.enum([
    ItemBusinessCategory.SERIALIZED_ASSET,
    ItemBusinessCategory.CONSUMABLE,
    ItemBusinessCategory.BULK_NON_CONSUMABLE,
  ]),
  trackingMethod: z.enum([TrackingMethod.SERIAL, TrackingMethod.QUANTITY, TrackingMethod.LOT]),
  categoryId: z.string(),
  subcategoryId: z.string(),
  brandId: z.string(),
  manufacturerId: z.string(),
  model: z.string().max(120),
  baseUomId: z.string().min(1, 'Base unit is required'),
  purchaseUomId: z.string(),
  issueUomId: z.string(),
  // Tolerate pasted "1,500.00" / stray spaces; cap matches the API (12 digits).
  standardCost: z.preprocess(
    (value) => String(value ?? '').replace(/[,\s]/g, ''),
    z.string().refine((value) => value === '' || MONEY_PATTERN.test(value), 'Amount like 1250.00'),
  ),
  lastPurchaseCost: z.preprocess(
    (value) => String(value ?? '').replace(/[,\s]/g, ''),
    z.string().refine((value) => value === '' || MONEY_PATTERN.test(value), 'Amount like 1250.00'),
  ),
  isLotTracked: z.boolean(),
  isExpiryTracked: z.boolean(),
  requiresSerialNumber: z.boolean(),
  isMaintainable: z.boolean(),
  conversions: z.array(
    z.object({
      /** Present when the row already exists server-side (edit mode). */
      id: z.string().optional(),
      fromUomId: z.string().min(1, 'Required'),
      toUomId: z.string().min(1, 'Required'),
      factor: z
        .string()
        .min(1, 'Required')
        .regex(FACTOR_PATTERN, 'Positive number')
        .refine((value) => Number(value) > 0, 'Must be > 0'),
    }),
  ),
}).superRefine((values, ctx) => {
  // Auto-generated SKUs are derived from the category code.
  if (!values.sku && !values.categoryId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sku'],
      message: 'Enter a SKU, or pick a Category so one can be auto-generated',
    });
  }
});

type ItemFormValues = z.infer<typeof itemSchema>;

function itemToFormValues(item: Item | null): ItemFormValues {
  return {
    sku: item?.sku ?? '',
    name: item?.name ?? '',
    description: item?.description ?? '',
    businessCategory: item?.businessCategory ?? ItemBusinessCategory.CONSUMABLE,
    trackingMethod: item?.trackingMethod ?? TrackingMethod.QUANTITY,
    categoryId: item?.categoryId ?? '',
    subcategoryId: item?.subcategoryId ?? '',
    brandId: item?.brandId ?? '',
    manufacturerId: item?.manufacturerId ?? '',
    model: item?.model ?? '',
    baseUomId: item?.baseUomId ?? '',
    purchaseUomId: item?.purchaseUomId ?? '',
    issueUomId: item?.issueUomId ?? '',
    standardCost: item?.standardCost ?? '',
    lastPurchaseCost: item?.lastPurchaseCost ?? '',
    isLotTracked: item?.isLotTracked ?? false,
    isExpiryTracked: item?.isExpiryTracked ?? false,
    requiresSerialNumber: item?.requiresSerialNumber ?? false,
    isMaintainable: item?.isMaintainable ?? false,
    conversions: (item?.uomConversions ?? []).map((conversion) => ({
      id: conversion.id,
      fromUomId: conversion.fromUomId,
      toUomId: conversion.toUomId,
      factor: formatFactor(conversion.factor),
    })),
  };
}

/* -------------------------------- The form -------------------------------- */

export function ItemForm({ itemId }: { itemId?: string }) {
  const isEdit = !!itemId;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { can } = useSession();
  const canUpdate = can(PERMISSIONS.item.update);
  const canViewCost = can(PERMISSIONS.item.viewCost);
  const readOnly = isEdit && !canUpdate;

  const [serverError, setServerError] = React.useState<string | null>(null);
  const [toggleOpen, setToggleOpen] = React.useState(false);

  const itemQuery = useQuery({
    queryKey: ['items', 'detail', itemId],
    queryFn: ({ signal }) => getItem(itemId!, signal),
    enabled: isEdit,
  });
  const item = itemQuery.data ?? null;

  const uomsQuery = useQuery({
    queryKey: ['uoms', 'options'],
    queryFn: ({ signal }) => listUoms({ page: 1, pageSize: 100 }, signal),
  });
  const categoriesQuery = useQuery({
    queryKey: ['item-categories', 'options'],
    queryFn: ({ signal }) => listItemCategories({ page: 1, pageSize: 100 }, signal),
  });
  const brandsQuery = useQuery({
    queryKey: ['brands', 'options'],
    queryFn: ({ signal }) => listBrands({ page: 1, pageSize: 100 }, signal),
  });
  const manufacturersQuery = useQuery({
    queryKey: ['manufacturers', 'options'],
    queryFn: ({ signal }) => listManufacturers({ page: 1, pageSize: 100 }, signal),
  });

  const form = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: itemToFormValues(null),
  });
  const conversionsArray = useFieldArray({ control: form.control, name: 'conversions' });

  // Seed the form once the item arrives (and after refetch on version conflict).
  React.useEffect(() => {
    if (item) form.reset(itemToFormValues(item));
  }, [item, form]);

  const businessCategory = form.watch('businessCategory');
  const trackingMethod = form.watch('trackingMethod');
  const categoryId = form.watch('categoryId');
  const isLotTracked = form.watch('isLotTracked');

  const subcategoriesQuery = useQuery({
    queryKey: ['item-subcategories', categoryId],
    queryFn: ({ signal }) => listItemSubcategories(categoryId, { page: 1, pageSize: 100 }, signal),
    enabled: !!categoryId,
  });

  // Business category → allowed/default tracking method.
  const allowedTracking = ALLOWED_TRACKING[businessCategory];
  const handleBusinessCategoryChange = (next: ItemBusinessCategory) => {
    form.setValue('businessCategory', next, { shouldDirty: true });
    if (!ALLOWED_TRACKING[next].includes(form.getValues('trackingMethod'))) {
      applyTrackingMethod(DEFAULT_TRACKING[next]);
    } else {
      applyTrackingMethod(form.getValues('trackingMethod'));
    }
  };

  // Tracking method → forced flag values.
  const applyTrackingMethod = (method: TrackingMethod) => {
    form.setValue('trackingMethod', method, { shouldDirty: true });
    if (method === TrackingMethod.SERIAL) {
      form.setValue('requiresSerialNumber', true);
      form.setValue('isLotTracked', false);
      form.setValue('isExpiryTracked', false);
    } else if (method === TrackingMethod.LOT) {
      form.setValue('requiresSerialNumber', false);
      form.setValue('isLotTracked', true);
    } else {
      form.setValue('requiresSerialNumber', false);
      form.setValue('isLotTracked', false);
      form.setValue('isExpiryTracked', false);
      form.setValue('isMaintainable', false);
    }
    if (method !== TrackingMethod.SERIAL) {
      form.setValue('isMaintainable', false);
    }
  };

  // Category change: clear a subcategory that no longer belongs.
  React.useEffect(() => {
    const currentSub = form.getValues('subcategoryId');
    if (!currentSub) return;
    if (!categoryId) {
      form.setValue('subcategoryId', '');
      return;
    }
    const subs = subcategoriesQuery.data?.data;
    if (subs && !subs.some((sub) => sub.id === currentSub)) {
      form.setValue('subcategoryId', '');
    }
  }, [categoryId, subcategoriesQuery.data, form]);

  const saveMutation = useMutation({
    mutationFn: async (values: ItemFormValues) => {
      const body: ItemWriteBody = {
        // SKU is immutable once created — the API rejects it on update.
        ...(isEdit ? {} : { sku: values.sku || undefined }),
        name: values.name,
        description: values.description || null,
        businessCategory: values.businessCategory,
        trackingMethod: values.trackingMethod,
        categoryId: values.categoryId || null,
        subcategoryId: values.subcategoryId || null,
        brandId: values.brandId || null,
        manufacturerId: values.manufacturerId || null,
        model: values.model || null,
        baseUomId: values.baseUomId,
        purchaseUomId: values.purchaseUomId || null,
        issueUomId: values.issueUomId || null,
        isLotTracked: values.isLotTracked,
        isExpiryTracked: values.isExpiryTracked,
        requiresSerialNumber: values.requiresSerialNumber,
        isMaintainable: values.isMaintainable,
      };
      if (canViewCost) {
        body.standardCost = values.standardCost || null;
        body.lastPurchaseCost = values.lastPurchaseCost || null;
      }
      const saved =
        isEdit && item
          ? await updateItem(item.id, { ...body, version: item.version })
          : await createItem(body);

      // Item-specific UOM conversions live behind their own endpoints
      // (POST/PATCH/DELETE /uom-conversions) — the item body does not accept
      // them. Sync the editor rows against what the server has.
      const existing = item?.uomConversions ?? [];
      const desired = values.conversions;
      const conversionErrors: string[] = [];
      const keptIds = new Set(desired.map((row) => row.id).filter(Boolean));
      for (const row of existing) {
        if (row.id && !keptIds.has(row.id)) {
          await deleteUomConversion(row.id).catch((error) =>
            conversionErrors.push(getErrorMessage(error, 'Failed to remove a conversion.')),
          );
        }
      }
      for (const row of desired) {
        if (!row.id) {
          await createUomConversion({
            itemId: saved.id,
            fromUomId: row.fromUomId,
            toUomId: row.toUomId,
            factor: row.factor,
          }).catch((error) =>
            conversionErrors.push(getErrorMessage(error, 'Failed to add a conversion.')),
          );
          continue;
        }
        const before = existing.find((conversion) => conversion.id === row.id);
        const changed =
          before &&
          (before.fromUomId !== row.fromUomId ||
            before.toUomId !== row.toUomId ||
            formatFactor(before.factor) !== row.factor);
        if (changed) {
          await updateUomConversion(row.id, {
            fromUomId: row.fromUomId,
            toUomId: row.toUomId,
            factor: row.factor,
          }).catch((error) =>
            conversionErrors.push(getErrorMessage(error, 'Failed to update a conversion.')),
          );
        }
      }
      if (conversionErrors.length > 0) {
        toast({
          title: 'Item saved, but some UOM conversions failed',
          description: conversionErrors[0],
          variant: 'destructive',
        });
      }
      return saved;
    },
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['items'] });
      if (isEdit) {
        toast({ title: 'Item updated', description: saved.sku, variant: 'success' });
      } else {
        toast({
          title: 'Item created',
          description: `SKU ${saved.sku} is ready.`,
          variant: 'success',
        });
        router.replace(`/items/${saved.id}`);
      }
    },
    onError: (error) => {
      if (isVersionConflict(error)) {
        toast({
          title: 'Record changed',
          description:
            'This item was modified by someone else. The latest data has been reloaded — please reapply your changes.',
          variant: 'destructive',
        });
        queryClient.invalidateQueries({ queryKey: ['items', 'detail', itemId] });
        return;
      }
      if (isApiClientError(error) && error.code === 'INVALID_STATE_TRANSITION') {
        toast({
          title: 'Tracking method locked',
          description: error.message,
          variant: 'destructive',
        });
        setServerError(error.message);
        return;
      }
      if (isApiClientError(error) && error.code === 'VALIDATION_ERROR') {
        for (const [field, message] of Object.entries(error.fieldErrors)) {
          if (field in itemToFormValues(null)) {
            form.setError(field as keyof ItemFormValues, { type: 'server', message });
          }
        }
      }
      setServerError(getErrorMessage(error));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: () => (item!.isActive ? deactivateItem(item!.id) : activateItem(item!.id)),
    onSuccess: () => {
      toast({
        title: item?.isActive ? 'Item deactivated' : 'Item activated',
        description: item?.sku,
        variant: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setServerError(null);
    saveMutation.mutate(values);
  });
  const { errors } = form.formState;
  const pending = saveMutation.isPending;
  const uoms = uomsQuery.data?.data ?? [];

  if (isEdit && itemQuery.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isEdit && itemQuery.isError) {
    return (
      <>
        <BackLink />
        <ErrorState error={itemQuery.error} onRetry={() => itemQuery.refetch()} />
      </>
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={isEdit ? (item?.name ?? 'Item') : 'New item'}
        description={
          isEdit
            ? item
              ? `SKU ${item.sku}`
              : undefined
            : 'Define the catalog record — SKU is generated when left blank.'
        }
        actions={
          isEdit && item ? (
            <div className="flex items-center gap-2">
              {item.isActive ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="muted">Inactive</Badge>
              )}
              {canUpdate ? (
                <Button
                  variant={item.isActive ? 'destructive' : 'default'}
                  size="sm"
                  onClick={() => setToggleOpen(true)}
                >
                  {item.isActive ? (
                    <>
                      <PowerOff aria-hidden /> Deactivate
                    </>
                  ) : (
                    <>
                      <Power aria-hidden /> Activate
                    </>
                  )}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      />

      <form onSubmit={onSubmit} noValidate>
        <fieldset disabled={readOnly} className="space-y-4">
          <FormError message={serverError} />

          {/* ------------------------------ Basics ------------------------------ */}
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
              <CardDescription>
                Identity and classification. Business category drives the default tracking method.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField
                  label="SKU"
                  htmlFor="item-sku"
                  error={errors.sku?.message}
                  hint={isEdit ? undefined : 'Leave blank to auto-generate (SKU-{CAT}-{SEQ}).'}
                >
                  <Input
                    id="item-sku"
                    className="font-mono"
                    {...form.register('sku', {
                      onChange: (event) => {
                        const input = event.target as HTMLInputElement;
                        const normalized = input.value.toUpperCase().replace(/\s+/g, '-');
                        if (normalized !== input.value) {
                          form.setValue('sku', normalized, { shouldValidate: true });
                        }
                      },
                    })}
                  />
                </FormField>
                <FormField
                  label="Name"
                  htmlFor="item-name"
                  error={errors.name?.message}
                  required
                  className="sm:col-span-2"
                >
                  <Input id="item-name" aria-invalid={!!errors.name} {...form.register('name')} />
                </FormField>
              </div>
              <FormField label="Description" htmlFor="item-desc" error={errors.description?.message}>
                <Textarea id="item-desc" rows={2} {...form.register('description')} />
              </FormField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  label="Business category"
                  htmlFor="item-bizcat"
                  error={errors.businessCategory?.message}
                  required
                >
                  <Select
                    id="item-bizcat"
                    value={businessCategory}
                    onChange={(event) =>
                      handleBusinessCategoryChange(event.target.value as ItemBusinessCategory)
                    }
                  >
                    <option value={ItemBusinessCategory.SERIALIZED_ASSET}>Serialized asset</option>
                    <option value={ItemBusinessCategory.CONSUMABLE}>Consumable</option>
                    <option value={ItemBusinessCategory.BULK_NON_CONSUMABLE}>Bulk non-consumable</option>
                  </Select>
                </FormField>
                <FormField
                  label="Tracking method"
                  htmlFor="item-tracking"
                  error={errors.trackingMethod?.message}
                  hint="Locked once stock or assets exist for this item."
                  required
                >
                  <Select
                    id="item-tracking"
                    value={trackingMethod}
                    onChange={(event) => applyTrackingMethod(event.target.value as TrackingMethod)}
                  >
                    {allowedTracking.map((method) => (
                      <option key={method} value={method}>
                        {method === TrackingMethod.SERIAL
                          ? 'Serial — one asset per unit'
                          : method === TrackingMethod.QUANTITY
                            ? 'Quantity — stock by item'
                            : 'Lot — stock by batch'}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField label="Category" htmlFor="item-category" error={errors.categoryId?.message}>
                  <Select id="item-category" {...form.register('categoryId')}>
                    <option value="">No category</option>
                    {(categoriesQuery.data?.data ?? []).map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name} ({category.code})
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  label="Subcategory"
                  htmlFor="item-subcategory"
                  error={errors.subcategoryId?.message}
                >
                  <Select id="item-subcategory" disabled={!categoryId} {...form.register('subcategoryId')}>
                    <option value="">
                      {categoryId ? 'No subcategory' : 'Select a category first'}
                    </option>
                    {(subcategoriesQuery.data?.data ?? []).map((subcategory) => (
                      <option key={subcategory.id} value={subcategory.id}>
                        {subcategory.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField label="Brand" htmlFor="item-brand" error={errors.brandId?.message}>
                  <Select id="item-brand" {...form.register('brandId')}>
                    <option value="">No brand</option>
                    {(brandsQuery.data?.data ?? []).map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  label="Manufacturer"
                  htmlFor="item-manufacturer"
                  error={errors.manufacturerId?.message}
                >
                  <Select id="item-manufacturer" {...form.register('manufacturerId')}>
                    <option value="">No manufacturer</option>
                    {(manufacturersQuery.data?.data ?? []).map((manufacturer) => (
                      <option key={manufacturer.id} value={manufacturer.id}>
                        {manufacturer.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Model" htmlFor="item-model" error={errors.model?.message}>
                  <Input id="item-model" {...form.register('model')} />
                </FormField>
              </div>
            </CardContent>
          </Card>

          {/* ------------------------------- Units ------------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Units</CardTitle>
              <CardDescription>
                Base unit for stock; optional purchasing/issuance units with item-specific conversions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <FormField label="Base UOM" htmlFor="item-baseuom" error={errors.baseUomId?.message} required>
                  <Select id="item-baseuom" aria-invalid={!!errors.baseUomId} {...form.register('baseUomId')}>
                    <option value="">Select…</option>
                    {uoms.map((uom) => (
                      <option key={uom.id} value={uom.id}>
                        {uom.code} — {uom.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Purchase UOM" htmlFor="item-purchaseuom" error={errors.purchaseUomId?.message}>
                  <Select id="item-purchaseuom" {...form.register('purchaseUomId')}>
                    <option value="">Same as base</option>
                    {uoms.map((uom) => (
                      <option key={uom.id} value={uom.id}>
                        {uom.code} — {uom.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Issue UOM" htmlFor="item-issueuom" error={errors.issueUomId?.message}>
                  <Select id="item-issueuom" {...form.register('issueUomId')}>
                    <option value="">Same as base</option>
                    {uoms.map((uom) => (
                      <option key={uom.id} value={uom.id}>
                        {uom.code} — {uom.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Item UOM conversions</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => conversionsArray.append({ fromUomId: '', toUomId: '', factor: '' })}
                  >
                    <Plus aria-hidden /> Add conversion
                  </Button>
                </div>
                {conversionsArray.fields.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
                    No item-specific conversions. Global conversions from the lookup admin still apply.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {conversionsArray.fields.map((field, index) => {
                      const rowErrors = errors.conversions?.[index];
                      const fromId = form.watch(`conversions.${index}.fromUomId`);
                      const toId = form.watch(`conversions.${index}.toUomId`);
                      const factor = form.watch(`conversions.${index}.factor`);
                      const fromCode = uoms.find((uom) => uom.id === fromId)?.code;
                      const toCode = uoms.find((uom) => uom.id === toId)?.code;
                      const preview =
                        fromCode && toCode && factor && FACTOR_PATTERN.test(factor)
                          ? `1 ${fromCode} = ${formatFactor(factor)} ${toCode}`
                          : null;
                      return (
                        <li key={field.id} className="rounded-md border p-3">
                          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_8rem_auto]">
                            <FormField
                              label="From unit"
                              htmlFor={`conv-${index}-from`}
                              error={rowErrors?.fromUomId?.message}
                            >
                              <Select
                                id={`conv-${index}-from`}
                                aria-invalid={!!rowErrors?.fromUomId}
                                {...form.register(`conversions.${index}.fromUomId`)}
                              >
                                <option value="">Select…</option>
                                {uoms.map((uom) => (
                                  <option key={uom.id} value={uom.id}>
                                    {uom.code}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                            <FormField
                              label="To unit"
                              htmlFor={`conv-${index}-to`}
                              error={rowErrors?.toUomId?.message}
                            >
                              <Select
                                id={`conv-${index}-to`}
                                aria-invalid={!!rowErrors?.toUomId}
                                {...form.register(`conversions.${index}.toUomId`)}
                              >
                                <option value="">Select…</option>
                                {uoms.map((uom) => (
                                  <option key={uom.id} value={uom.id}>
                                    {uom.code}
                                  </option>
                                ))}
                              </Select>
                            </FormField>
                            <FormField
                              label="Factor"
                              htmlFor={`conv-${index}-factor`}
                              error={rowErrors?.factor?.message}
                            >
                              <Input
                                id={`conv-${index}-factor`}
                                inputMode="decimal"
                                aria-invalid={!!rowErrors?.factor}
                                {...form.register(`conversions.${index}.factor`)}
                              />
                            </FormField>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove conversion ${index + 1}`}
                              onClick={() => conversionsArray.remove(index)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" aria-hidden />
                            </Button>
                          </div>
                          {preview ? (
                            <p className="mt-2 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                              <ArrowRight className="h-3 w-3" aria-hidden /> {preview}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>

          {/* --------------------------- Tracking flags -------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle>Tracking flags</CardTitle>
              <CardDescription>
                Flags follow the business category and tracking method — locked options are enforced by
                the classification rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox className="mt-0.5" disabled checked={isLotTracked} readOnly />
                <span>
                  <span className="block font-medium">Lot tracking</span>
                  <span className="block text-xs text-muted-foreground">
                    Follows the tracking method — choose “Lot” above to enable.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  disabled={trackingMethod !== TrackingMethod.LOT}
                  checked={form.watch('isExpiryTracked')}
                  onChange={(event) => form.setValue('isExpiryTracked', event.target.checked, { shouldDirty: true })}
                />
                <span>
                  <span className="block font-medium">Expiry tracking</span>
                  <span className="block text-xs text-muted-foreground">
                    Capture expiry dates per lot (FEFO issuing). Requires lot tracking.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  disabled
                  checked={form.watch('requiresSerialNumber')}
                  readOnly
                />
                <span>
                  <span className="block font-medium">Serial number required</span>
                  <span className="block text-xs text-muted-foreground">
                    Follows the tracking method — “Serial” makes every unit an asset instance.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox
                  className="mt-0.5"
                  disabled={trackingMethod !== TrackingMethod.SERIAL}
                  checked={form.watch('isMaintainable')}
                  onChange={(event) => form.setValue('isMaintainable', event.target.checked, { shouldDirty: true })}
                />
                <span>
                  <span className="block font-medium">Maintenance eligible</span>
                  <span className="block text-xs text-muted-foreground">
                    Only serialized, individually identifiable assets can be maintained.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          {/* ------------------------------- Costs ------------------------------- */}
          {canViewCost ? (
            <Card>
              <CardHeader>
                <CardTitle>Costs</CardTitle>
                <CardDescription>Reference costs in PHP. Visible only with cost permission.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  label="Standard cost"
                  htmlFor="item-stdcost"
                  error={errors.standardCost?.message}
                >
                  <Input
                    id="item-stdcost"
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-invalid={!!errors.standardCost}
                    {...form.register('standardCost')}
                  />
                </FormField>
                <FormField
                  label="Last purchase cost"
                  htmlFor="item-lastcost"
                  error={errors.lastPurchaseCost?.message}
                >
                  <Input
                    id="item-lastcost"
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-invalid={!!errors.lastPurchaseCost}
                    {...form.register('lastPurchaseCost')}
                  />
                </FormField>
              </CardContent>
            </Card>
          ) : null}

          {!readOnly ? (
            <div className="flex items-center justify-end gap-2">
              <Link
                href="/items"
                className="text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancel
              </Link>
              <Button type="submit" loading={pending}>
                {isEdit ? 'Save changes' : 'Create item'}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>

      {/* Edit-only managers (need a persisted item id) */}
      {isEdit && item ? (
        <div className="mt-4 space-y-4">
          <ItemBarcodesCard item={item} canManage={canUpdate} />
          <ItemWarehouseSettingsCard item={item} canManage={canUpdate} />
        </div>
      ) : null}

      {isEdit && item ? (
        <ConfirmDialog
          open={toggleOpen}
          onOpenChange={setToggleOpen}
          title={item.isActive ? 'Deactivate item' : 'Activate item'}
          destructive={item.isActive}
          confirmLabel={item.isActive ? 'Deactivate' : 'Activate'}
          description={
            item.isActive ? (
              <>
                <span className="font-medium text-foreground">{item.name}</span> will be unavailable for
                new transactions. Stock and history are preserved.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">{item.name}</span> will be available again
                for new transactions.
              </>
            )
          }
          onConfirm={() => toggleMutation.mutateAsync()}
        />
      ) : null}
    </>
  );
}

function BackLink() {
  return (
    <div className="mb-3">
      <Link
        href="/items"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back to items
      </Link>
    </div>
  );
}
