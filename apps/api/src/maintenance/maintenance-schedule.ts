import { Prisma } from '@prisma/client';

/**
 * Pure scheduling math for maintenance plans and work orders (spec §18,
 * api-outline 6.1). No Nest/Prisma clients so next-due computation, the
 * reminder window, meter-interval dueness, and the downtime calculation are
 * unit-testable without infrastructure.
 *
 * Frequency mechanisms (master prompt §18 "Maintenance plans"):
 *  - date interval  → intervalDays: next due = anchor + intervalDays
 *  - usage meter    → meterInterval: due when latest reading − baseline ≥ interval
 *  - schedule       → scheduleCron: stored verbatim; the next occurrence must
 *    be supplied explicitly (nextDueAt / nextMaintenanceDate) — the codebase
 *    deliberately carries no cron parser yet (documented deferral).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/** anchor + intervalDays (UTC-safe date math). */
export function nextDueFromInterval(anchor: Date, intervalDays: number): Date {
  return new Date(anchor.getTime() + intervalDays * MS_PER_DAY);
}

export interface PlanFrequency {
  intervalDays: number | null;
  meterInterval: Prisma.Decimal | null;
  scheduleCron: string | null;
}

/**
 * Initial nextDueAt for a plan: an explicit date always wins; otherwise
 * interval plans anchor on `now`. Meter plans have no calendar due date
 * (dueness is derived from readings) and cron plans need an explicit date.
 */
export function initialNextDueAt(
  frequency: PlanFrequency,
  explicit: Date | null,
  now: Date,
): Date | null {
  if (explicit) {
    return explicit;
  }
  if (frequency.intervalDays !== null) {
    return nextDueFromInterval(now, frequency.intervalDays);
  }
  return null;
}

/**
 * nextDueAt after a plan work order completes: the completer's explicit
 * nextMaintenanceDate wins; else interval plans re-anchor on the completion
 * date; meter/cron plans go dateless until the next reading/explicit date.
 */
export function nextDueAfterCompletion(
  frequency: PlanFrequency,
  explicitNext: Date | null,
  completedAt: Date,
): Date | null {
  if (explicitNext) {
    return explicitNext;
  }
  if (frequency.intervalDays !== null) {
    return nextDueFromInterval(completedAt, frequency.intervalDays);
  }
  return null;
}

/** Calendar dueness: nextDueAt reached (or passed). */
export function isPlanDue(nextDueAt: Date | null, now: Date): boolean {
  return nextDueAt !== null && nextDueAt.getTime() <= now.getTime();
}

/**
 * Reminder window (spec §18 reminder lead time): the moment reminders may
 * start firing — nextDueAt minus the lead days. Null when the plan has no
 * calendar due date.
 */
export function reminderWindowStart(
  nextDueAt: Date | null,
  reminderLeadDays: number | null,
): Date | null {
  if (!nextDueAt) {
    return null;
  }
  return new Date(nextDueAt.getTime() - (reminderLeadDays ?? 0) * MS_PER_DAY);
}

/**
 * Meter-interval dueness: the usage accumulated since the last completed
 * service (its completion_meter_reading snapshot; 0 when the asset was never
 * serviced) has reached the plan's interval.
 */
export function isMeterPlanDue(
  latestReading: Prisma.Decimal | null,
  baselineReading: Prisma.Decimal | null,
  meterInterval: Prisma.Decimal,
): boolean {
  if (latestReading === null) {
    return false;
  }
  const baseline = baselineReading ?? new Prisma.Decimal(0);
  return latestReading.sub(baseline).gte(meterInterval);
}

/**
 * Downtime between actual start and end, in whole minutes (rounded up so a
 * 30-second repair still counts as one minute). Non-positive spans → 0.
 */
export function computeDowntimeMinutes(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / MS_PER_MINUTE);
}

/** 2dp hour mirror of a minute count (legacy downtime_hours column). */
export function downtimeHoursFromMinutes(minutes: number): Prisma.Decimal {
  return new Prisma.Decimal(minutes).div(60).toDecimalPlaces(2);
}
