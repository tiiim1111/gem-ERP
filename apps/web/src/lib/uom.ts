'use client';

/**
 * Shared UOM selection + conversion helpers for line editors.
 *
 * The items LIST payload carries nested `baseUom`/`purchaseUom`/`issueUom`
 * objects but no scalar `*UomId` fields and no global conversions, so line
 * editors must combine the item row with the global UOM catalog/conversions
 * (fetched once here) to offer units and preview base quantities. Conversion
 * lookup walks the graph (e.g. BOX→PACK→PC) exactly like the API's
 * normalization does.
 */
import { useQuery } from '@tanstack/react-query';
import { listUomConversions, listUoms } from '@/lib/endpoints';
import type { Item } from '@/lib/types';

/** Minimal structural shape shared by global and item-specific conversions. */
interface ConversionLike {
  fromUomId: string;
  toUomId: string;
  factor: string | number;
  fromUom?: { id: string; code: string } | null;
  toUom?: { id: string; code: string } | null;
}

export interface UomData {
  conversions: ConversionLike[];
  uomCodeById: Map<string, string>;
  isLoading: boolean;
}

export function useUomData(): UomData {
  const uomsQuery = useQuery({
    queryKey: ['uoms', 'all'],
    queryFn: ({ signal }) => listUoms({ page: 1, pageSize: 100 }, signal),
    staleTime: 5 * 60_000,
  });
  const conversionsQuery = useQuery({
    queryKey: ['uom-conversions', 'all'],
    queryFn: ({ signal }) => listUomConversions({ page: 1, pageSize: 100 }, signal),
    staleTime: 5 * 60_000,
  });
  const uomCodeById = new Map<string, string>();
  for (const uom of uomsQuery.data?.data ?? []) {
    uomCodeById.set(uom.id, uom.code);
  }
  return {
    conversions: conversionsQuery.data?.data ?? [],
    uomCodeById,
    isLoading: uomsQuery.isLoading || conversionsQuery.isLoading,
  };
}

function baseUomIdOf(item: Item): string | null {
  return item.baseUom?.id ?? item.baseUomId ?? null;
}

function itemConversions(item: Item, uom: UomData): ConversionLike[] {
  // Item-specific conversions (present on detail payloads) take precedence.
  return [...(item.uomConversions ?? []), ...uom.conversions];
}

/** UOMs selectable for an item: base + purchase + issue + graph-reachable units. */
export function itemUomChoices(item: Item, uom: UomData): Array<{ id: string; code: string }> {
  const seen = new Map<string, string>();
  const add = (id: string | null | undefined, code: string | null | undefined) => {
    if (id && !seen.has(id)) seen.set(id, code ?? uom.uomCodeById.get(id) ?? id);
  };
  add(baseUomIdOf(item), item.baseUom?.code);
  add(item.purchaseUom?.id ?? item.purchaseUomId, item.purchaseUom?.code);
  add(item.issueUom?.id ?? item.issueUomId, item.issueUom?.code);

  // Any unit connected to an already-offered unit through the conversion
  // graph is also enterable (BOX when base is PC via BOX→PACK→PC, ...).
  const conversions = itemConversions(item, uom);
  let grew = true;
  while (grew) {
    grew = false;
    for (const conversion of conversions) {
      const fromKnown = seen.has(conversion.fromUomId);
      const toKnown = seen.has(conversion.toUomId);
      if (fromKnown && !toKnown) {
        add(conversion.toUomId, conversion.toUom?.code);
        grew = true;
      } else if (toKnown && !fromKnown) {
        add(conversion.fromUomId, conversion.fromUom?.code);
        grew = true;
      }
    }
  }
  return Array.from(seen, ([id, code]) => ({ id, code }));
}

/**
 * Entered-UOM → base-UOM factor via breadth-first walk over the conversion
 * graph (both directions per edge). Returns null when no path exists.
 */
export function convertToBase(
  item: Item,
  uomId: string,
  quantity: number,
  uom: UomData,
): number | null {
  const baseUomId = baseUomIdOf(item);
  if (!baseUomId || !uomId) return null;
  if (uomId === baseUomId) return quantity;

  const conversions = itemConversions(item, uom);
  const factors = new Map<string, number>([[uomId, 1]]);
  const queue = [uomId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentFactor = factors.get(current) as number;
    for (const conversion of conversions) {
      const factor = Number(conversion.factor);
      if (!Number.isFinite(factor) || factor <= 0) continue;
      if (conversion.fromUomId === current && !factors.has(conversion.toUomId)) {
        factors.set(conversion.toUomId, currentFactor * factor);
        queue.push(conversion.toUomId);
      } else if (conversion.toUomId === current && !factors.has(conversion.fromUomId)) {
        factors.set(conversion.fromUomId, currentFactor / factor);
        queue.push(conversion.fromUomId);
      }
    }
  }
  const toBase = factors.get(baseUomId);
  return toBase === undefined ? null : quantity * toBase;
}
