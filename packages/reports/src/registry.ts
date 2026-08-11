/**
 * The Phase 7 report registry (api-outline §8): all 16 operational reports,
 * keyed by their endpoint segment (GET /reports/<key>). The API catalog,
 * report endpoints, and worker exports all resolve definitions here.
 */
import { auditActivity } from './reports/audit-reports';
import {
  assetCondition,
  assetCustody,
  assetMovements,
  assetRegister,
  assetTerminal,
} from './reports/asset-reports';
import {
  consumption,
  expiringLots,
  lowStock,
  stockMovement,
  stockOnHand,
} from './reports/inventory-reports';
import { maintenanceSummary } from './reports/maintenance-reports';
import { countVariance, transferStatus } from './reports/operations-reports';
import { poStatus, supplierPurchases } from './reports/procurement-reports';
import type { ReportDefinition } from './types';

const DEFINITIONS: readonly ReportDefinition[] = [
  assetRegister,
  assetCustody,
  assetMovements,
  assetCondition,
  assetTerminal,
  stockOnHand,
  stockMovement,
  lowStock,
  consumption,
  expiringLots,
  countVariance,
  transferStatus,
  supplierPurchases,
  poStatus,
  maintenanceSummary,
  auditActivity,
];

/** key → definition, in contract-table order. */
export const REPORT_REGISTRY: ReadonlyMap<string, ReportDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.key, definition]),
);

/** Every report key, in contract-table order. */
export const REPORT_KEYS: readonly string[] = DEFINITIONS.map((d) => d.key);

export function getReportDefinition(key: string): ReportDefinition | undefined {
  return REPORT_REGISTRY.get(key);
}
