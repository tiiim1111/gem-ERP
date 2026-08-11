/**
 * Pure report-authorization helpers (Phase 7). Every report requires
 * report.view (route guard) PLUS the definition's underlying permission;
 * cost columns additionally require the definition's costPermission.
 * Super admins bypass permission checks (never branch/audit concerns).
 */
import type { ReportDefinition } from '@gemerp/reports';
import { REPORT_REGISTRY } from '@gemerp/reports';

export interface ReportActor {
  isSuperAdmin: boolean;
  permissions: readonly string[];
}

export function canRunReport(user: ReportActor, definition: ReportDefinition): boolean {
  return user.isSuperAdmin || user.permissions.includes(definition.permission);
}

export function includeCostColumns(
  user: ReportActor,
  definition: ReportDefinition,
): boolean {
  if (!definition.costPermission) {
    return false;
  }
  return (
    user.isSuperAdmin || user.permissions.includes(definition.costPermission)
  );
}

/** The caller's runnable subset, in contract-table order. */
export function runnableReports(user: ReportActor): ReportDefinition[] {
  return [...REPORT_REGISTRY.values()].filter((definition) =>
    canRunReport(user, definition),
  );
}
