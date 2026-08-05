import { AssetLifecycleStatus } from '@prisma/client';

/**
 * Pure decision logic for generating work orders from due maintenance plans
 * (spec §18 "Scheduled jobs should generate upcoming and overdue maintenance
 * alerts"). The BullMQ processor in apps/worker applies these decisions with
 * database queries; keeping the decisions pure makes the idempotency
 * invariant — a due plan generates exactly ONE open WO per covered asset —
 * unit-testable without a database.
 */

/**
 * Lifecycle statuses a preventive WO may be generated for. Terminal/absent
 * assets (Lost, Retired, Disposed) and unactivated Drafts are excluded;
 * Under Maintenance is excluded because the asset is already being serviced
 * (its own open WO also trips the one-open-WO check).
 */
export const GENERATION_ELIGIBLE_STATUSES: readonly AssetLifecycleStatus[] = [
  AssetLifecycleStatus.AVAILABLE,
  AssetLifecycleStatus.RESERVED,
  AssetLifecycleStatus.ASSIGNED,
  AssetLifecycleStatus.IN_TRANSFER,
  AssetLifecycleStatus.UNDER_INSPECTION,
  AssetLifecycleStatus.DAMAGED,
];

export function isGenerationEligible(status: AssetLifecycleStatus): boolean {
  return GENERATION_ELIGIBLE_STATUSES.includes(status);
}

export interface CoveredAsset {
  assetId: string;
  status: AssetLifecycleStatus;
  archived: boolean;
}

/**
 * The idempotent core: which covered assets need a WO right now.
 *
 * An asset is selected when it is lifecycle-eligible, not archived, and has
 * NO open WO for this plan yet (`assetIdsWithOpenPlanWo`). Re-running the
 * job after generation therefore selects nothing — the invariant holds no
 * matter how often the scheduler fires.
 */
export function selectAssetsNeedingWorkOrder(
  covered: readonly CoveredAsset[],
  assetIdsWithOpenPlanWo: ReadonlySet<string>,
): string[] {
  return covered
    .filter(
      (asset) =>
        !asset.archived &&
        isGenerationEligible(asset.status) &&
        !assetIdsWithOpenPlanWo.has(asset.assetId),
    )
    .map((asset) => asset.assetId);
}

/** Problem description stamped on generated WOs (marker aids traceability). */
export function generatedProblemDescription(
  planCode: string,
  planName: string,
  dueAt: Date | null,
): string {
  const due = dueAt ? ` — due ${dueAt.toISOString().slice(0, 10)}` : '';
  return `[preventive] Generated from plan ${planCode} (${planName})${due}`;
}
