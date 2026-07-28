import { AppException } from '../common/errors/app.exception';

/**
 * Generic lookup types served by /lookups/:type (spec §10, api-outline 3.3).
 * URL segment (kebab-case plural) → lookup_values.category. Enums stay
 * reserved for true system invariants; everything here is business-managed.
 */
export const LOOKUP_TYPES = {
  'asset-conditions': 'ASSET_CONDITION',
  'transaction-reasons': 'TRANSACTION_REASON',
  'adjustment-reasons': 'ADJUSTMENT_REASON',
  'disposal-methods': 'DISPOSAL_METHOD',
  'maintenance-types': 'MAINTENANCE_TYPE',
  'maintenance-priorities': 'MAINTENANCE_PRIORITY',
  'work-order-statuses': 'WORK_ORDER_STATUS',
  'supplier-categories': 'SUPPLIER_CATEGORY',
  'document-types': 'DOCUMENT_TYPE',
  'notification-types': 'NOTIFICATION_TYPE',
  'asset-types': 'ASSET_TYPE',
} as const;

export type LookupType = keyof typeof LOOKUP_TYPES;

/** Resolve a URL :type segment or reject with a per-field validation error. */
export function categoryForLookupType(type: string): string {
  const category = LOOKUP_TYPES[type as LookupType];
  if (!category) {
    throw AppException.validation([
      {
        field: 'type',
        message: `Unknown lookup type "${type}". Valid types: ${Object.keys(
          LOOKUP_TYPES,
        ).join(', ')}.`,
      },
    ]);
  }
  return category;
}
