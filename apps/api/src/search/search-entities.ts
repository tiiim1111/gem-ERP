/**
 * Entity types the global search covers (api-outline §4.7, spec §25):
 * asset tags/serials, item SKUs/names/barcodes, employees, suppliers, and
 * document numbers (POs, goods receipts, work orders, transfers, stock
 * transactions). One vocabulary with the audit log's resource_type strings.
 */
export const SEARCH_ENTITY_TYPES = [
  'asset',
  'item',
  'employee',
  'supplier',
  'purchase_order',
  'goods_receipt',
  'maintenance_work_order',
  'transfer',
  'stock_transaction',
] as const;

export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

/** One hit. `title` is the primary identifier, `subtitle` adds context. */
export interface SearchResult {
  type: SearchEntityType;
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  branchId: string | null;
}

export interface SearchResponse {
  query: string;
  /** Maximum hits per entity type that were fetched (bounded). */
  limitPerType: number;
  results: SearchResult[];
}
