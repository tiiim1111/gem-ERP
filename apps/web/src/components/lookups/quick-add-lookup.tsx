'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { PERMISSIONS } from '@gemerp/shared';
import { getErrorMessage } from '@/lib/api';
import {
  createBrand,
  createItemCategory,
  createItemSubcategory,
  createManufacturer,
  createUom,
  createUomConversion,
} from '@/lib/endpoints';
import { useSession } from '@/components/auth/session-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FormError } from '@/components/ui/error-state';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';

/**
 * Sentinel option value. A `<select>` cannot hold a button, so the "add"
 * affordance is an option the change handler intercepts and never commits.
 */
const ADD_NEW = '__add_new__';

export type QuickAddKind = 'item-category' | 'item-subcategory' | 'brand' | 'manufacturer' | 'uom';

const KIND_LABEL: Record<QuickAddKind, string> = {
  'item-category': 'category',
  'item-subcategory': 'subcategory',
  brand: 'brand',
  manufacturer: 'manufacturer',
  uom: 'unit of measure',
};

const schema = z.object({
  code: z
    .string()
    .min(1, 'Code is required')
    .max(20)
    .regex(/^[A-Z0-9_-]+$/i, 'Letters, numbers, dashes, and underscores only'),
  name: z.string().min(1, 'Name is required').max(160),
  /** UOM only: how many base units one of the new unit holds. */
  factor: z.string().regex(/^\d*\.?\d*$/, 'Numbers only').optional(),
});

type Values = z.infer<typeof schema>;

export interface QuickAddContext {
  /** Required for 'item-subcategory' — the parent category. */
  categoryId?: string;
  /** UOM only: offers a conversion so the new unit is usable immediately. */
  baseUom?: { id: string; code: string } | null;
}

/** Creates the lookup and returns its id, per kind. */
async function createLookup(
  kind: QuickAddKind,
  values: Values,
  context: QuickAddContext,
): Promise<string> {
  const body = { code: values.code.toUpperCase(), name: values.name };
  switch (kind) {
    case 'item-category':
      return (await createItemCategory(body)).id;
    case 'item-subcategory': {
      if (!context.categoryId) {
        throw new Error('Select a category first.');
      }
      return (await createItemSubcategory(context.categoryId, body)).id;
    }
    case 'brand':
      return (await createBrand(body)).id;
    case 'manufacturer':
      return (await createManufacturer(body)).id;
    case 'uom':
      return (await createUom(body)).id;
  }
}

function queryKeyFor(kind: QuickAddKind, context: QuickAddContext): unknown[] {
  switch (kind) {
    case 'item-category':
      return ['item-categories'];
    case 'item-subcategory':
      return ['item-subcategories', context.categoryId];
    case 'brand':
      return ['brands'];
    case 'manufacturer':
      return ['manufacturers'];
    case 'uom':
      return ['uoms'];
  }
}

export function QuickAddLookupDialog({
  open,
  onOpenChange,
  kind,
  context = {},
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: QuickAddKind;
  context?: QuickAddContext;
  /** Receives the new id so the caller can select it. */
  onCreated: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const label = KIND_LABEL[kind];
  const offersConversion = kind === 'uom' && !!context.baseUom;

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { code: '', name: '', factor: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ code: '', name: '', factor: '' });
      setServerError(null);
    }
  }, [open, form]);

  const mutation = useMutation({
    mutationFn: async (values: Values) => {
      const id = await createLookup(kind, values, context);
      // A new unit with no path to the base unit cannot be converted, so the
      // optional factor is offered here rather than sending the user hunting
      // for the conversions table. A failure here must not lose the unit.
      if (offersConversion && values.factor && Number(values.factor) > 0) {
        try {
          await createUomConversion({
            fromUomId: id,
            toUomId: context.baseUom!.id,
            factor: values.factor,
          });
        } catch (error) {
          toast({
            title: 'Unit saved, conversion not',
            description: getErrorMessage(error, 'Add the conversion below instead.'),
            variant: 'destructive',
          });
        }
      }
      return id;
    },
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: queryKeyFor(kind, context) });
      toast({ title: `New ${label} added`, variant: 'success' });
      onCreated(id);
      onOpenChange(false);
    },
    onError: (error) => {
      setServerError(getErrorMessage(error, `Could not add the ${label}.`));
    },
  });

  const submit = form.handleSubmit((values) => mutation.mutate(values));

  /**
   * This dialog is rendered from inside another form. The portal moves it out
   * of that form in the DOM, but React still propagates events up the
   * component tree — so without stopping it here, saving a lookup also submits
   * the form that owns the dropdown.
   */
  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void submit(event);
  };

  const codeRegistration = form.register('code');
  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader>
        <DialogTitle>Add {label}</DialogTitle>
        <DialogDescription>
          Saved right away and selected for you — nothing you have typed is lost.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={onSubmit}>
        <DialogBody className="space-y-4">
          <FormError message={serverError} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Code" htmlFor="quick-code" error={errors.code?.message} required>
              <Input
                id="quick-code"
                autoFocus
                className="font-mono uppercase"
                {...codeRegistration}
                onChange={(event) => {
                  event.target.value = event.target.value.toUpperCase();
                  void codeRegistration.onChange(event);
                }}
              />
            </FormField>
            <FormField label="Name" htmlFor="quick-name" error={errors.name?.message} required>
              <Input id="quick-name" {...form.register('name')} />
            </FormField>
          </div>
          {offersConversion ? (
            <FormField
              label={`How many ${context.baseUom!.code} in one of these?`}
              htmlFor="quick-factor"
              error={errors.factor?.message}
              hint="Optional, but quantities cannot convert to the base unit without it."
            >
              <Input id="quick-factor" inputMode="decimal" placeholder="e.g. 12" {...form.register('factor')} />
            </FormField>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Add {label}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/**
 * A `<select>` that can create its own options. Keeps the surrounding form
 * mounted, so a missing lookup no longer costs the user everything they typed.
 */
export function CreatableSelect({
  id,
  kind,
  context,
  registration,
  value,
  onCreated,
  disabled,
  ariaInvalid,
  children,
}: {
  id: string;
  kind: QuickAddKind;
  context?: QuickAddContext;
  /** Spread of `form.register(field)`. */
  registration: UseFormRegisterReturn<string>;
  /** Current field value — restored when the add option is picked. */
  value: string;
  onCreated: (id: string) => void;
  disabled?: boolean;
  ariaInvalid?: boolean;
  /** The real options, including any placeholder. */
  children: React.ReactNode;
}) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const { can } = useSession();
  const canCreate = can(PERMISSIONS.lookup.manage);
  // A subcategory needs its parent; offering the option without one is a dead end.
  const ready = kind !== 'item-subcategory' || !!context?.categoryId;

  return (
    <>
      <Select
        id={id}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        {...registration}
        onChange={(event) => {
          if (event.target.value === ADD_NEW) {
            event.target.value = value;
            setDialogOpen(true);
            return;
          }
          void registration.onChange(event);
        }}
      >
        {children}
        {canCreate && ready ? <option value={ADD_NEW}>+ Add {KIND_LABEL[kind]}…</option> : null}
      </Select>
      {canCreate ? (
        <QuickAddLookupDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          kind={kind}
          context={context}
          onCreated={onCreated}
        />
      ) : null}
    </>
  );
}
