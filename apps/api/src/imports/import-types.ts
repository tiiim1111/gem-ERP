import { PERMISSIONS } from '@gemerp/shared';
import { AppException } from '../common/errors/app.exception';

/**
 * Staged CSV import registry (spec §24, api-outline 3.7).
 *
 * Phase 2 supports CSV only. XLSX template/upload support is deliberately
 * deferred to Phase 8 polish (the endpoint contract already covers it — only
 * the parser/writer changes).
 *
 * P3+ will add: suppliers, opening-balances, assets.
 */
export type ImportType = 'employees' | 'items' | 'lookups';

export interface ImportTypeConfig {
  /**
   * Permission required for template/validate/commit/status of this type
   * (`<resource>.import`; lookups use lookup.manage — the permission catalog
   * defines no lookup.import).
   */
  permission: string;
  /** CSV header row (also the exact set of accepted columns). */
  headers: readonly string[];
  /** One example row for the downloadable template. */
  example: readonly string[];
}

export const IMPORT_TYPES: Record<ImportType, ImportTypeConfig> = {
  employees: {
    permission: PERMISSIONS.employee.import,
    headers: [
      'employeeNumber',
      'firstName',
      'middleName',
      'lastName',
      'displayName',
      'workEmail',
      'workPhone',
      'branchCode',
      'departmentCode',
      'positionCode',
      'supervisorEmployeeNumber',
      'status',
      'startDate',
    ],
    example: [
      '',
      'Juan',
      '',
      'Dela Cruz',
      'Juan D.',
      'juan.delacruz@gemcor.dev',
      'loc 101',
      'SUB',
      'OPS',
      'STAFF',
      '',
      'ACTIVE',
      '2026-01-15',
    ],
  },
  items: {
    permission: PERMISSIONS.item.import,
    headers: [
      'sku',
      'name',
      'description',
      'businessCategory',
      'trackingMethod',
      'categoryCode',
      'subcategoryCode',
      'brandCode',
      'manufacturerCode',
      'model',
      'baseUomCode',
      'purchaseUomCode',
      'issueUomCode',
      'standardCost',
      'barcode',
    ],
    example: [
      '',
      'Bond Paper A4 80gsm',
      'Substance 20, 500 sheets per ream',
      'CONSUMABLE',
      'QUANTITY',
      'OFC',
      '',
      '',
      '',
      '',
      'REAM',
      'BOX',
      'REAM',
      '240.00',
      '4806534001234',
    ],
  },
  lookups: {
    permission: PERMISSIONS.lookup.manage,
    headers: ['type', 'code', 'name', 'description', 'sortOrder'],
    example: ['asset-conditions', 'GOOD', 'Good', 'Normal wear and tear', '2'],
  },
};

export function importTypeConfig(type: string): ImportTypeConfig {
  const config = IMPORT_TYPES[type as ImportType];
  if (!config) {
    throw AppException.validation([
      {
        field: 'type',
        message: `Unknown import type "${type}". Valid types: ${Object.keys(
          IMPORT_TYPES,
        ).join(', ')}.`,
      },
    ]);
  }
  return config;
}

/** RFC-4180-ish CSV field escaping for template generation. */
export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildTemplateCsv(type: string): string {
  const config = importTypeConfig(type);
  const lines = [
    config.headers.map(csvEscape).join(','),
    config.example.map(csvEscape).join(','),
  ];
  return `${lines.join('\n')}\n`;
}
