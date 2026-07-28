/**
 * UOM conversion normalization (spec §5 consumables):
 * transactions store the entered unit AND the normalized base-unit quantity.
 *
 * A conversion edge means: 1 fromUom = factor × toUom (e.g. 1 BOX = 10 PACK).
 * Conversions form a graph; chains are resolved by breadth-first search so
 * 1 BOX = 10 PACK and 1 PACK = 100 PC yields 1 BOX = 1000 PC. Edges are
 * traversed in both directions (the reverse edge divides by the factor).
 *
 * Pure functions — callers merge item-specific and global conversion lists
 * (item-specific first so its factors win when both define the same pair).
 */

export interface ConversionEdge {
  fromUomId: string;
  /** 1 fromUom = factor × toUom. */
  toUomId: string;
  factor: number | string | { toString(): string };
}

interface Step {
  uomId: string;
  factor: number;
}

/**
 * Multiplier converting a quantity in `fromUomId` to `toUomId`, or `null`
 * when no conversion path exists. Identity conversions return 1. The FIRST
 * edge listed for a (from, to) pair wins, so item-specific overrides must be
 * placed before global conversions in `edges`.
 */
export function conversionFactor(
  fromUomId: string,
  toUomId: string,
  edges: readonly ConversionEdge[],
): number | null {
  if (fromUomId === toUomId) {
    return 1;
  }

  const adjacency = new Map<string, Step[]>();
  const seenPairs = new Set<string>();
  const addEdge = (from: string, to: string, factor: number): void => {
    const key = `${from}→${to}`;
    if (seenPairs.has(key)) {
      return; // earlier (higher-precedence) edge already defines this pair
    }
    seenPairs.add(key);
    const list = adjacency.get(from) ?? [];
    list.push({ uomId: to, factor });
    adjacency.set(from, list);
  };
  for (const edge of edges) {
    const factor = Number(edge.factor);
    if (!Number.isFinite(factor) || factor <= 0) {
      continue; // defensive: malformed factors never poison the graph
    }
    addEdge(edge.fromUomId, edge.toUomId, factor);
    addEdge(edge.toUomId, edge.fromUomId, 1 / factor);
  }

  const visited = new Set<string>([fromUomId]);
  const queue: Step[] = [{ uomId: fromUomId, factor: 1 }];
  while (queue.length > 0) {
    const current = queue.shift() as Step;
    for (const next of adjacency.get(current.uomId) ?? []) {
      if (visited.has(next.uomId)) {
        continue;
      }
      const combined = current.factor * next.factor;
      if (next.uomId === toUomId) {
        return combined;
      }
      visited.add(next.uomId);
      queue.push({ uomId: next.uomId, factor: combined });
    }
  }
  return null;
}

/**
 * Normalize an entered quantity to the base unit: entered qty × factor.
 * Returns `null` when the units are not connected by any conversion chain.
 */
export function normalizeQuantity(
  quantity: number,
  enteredUomId: string,
  baseUomId: string,
  edges: readonly ConversionEdge[],
): number | null {
  const factor = conversionFactor(enteredUomId, baseUomId, edges);
  return factor === null ? null : quantity * factor;
}
