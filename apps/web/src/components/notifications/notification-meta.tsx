import {
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  Clock,
  CornerUpLeft,
  Inbox,
  TriangleAlert,
  UserRoundX,
  Wrench,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { ALL_NOTIFICATION_TYPES, NOTIFICATION_TYPES } from '@gemerp/shared';
import { humanize } from '@/lib/utils';

/** Canonical labels for the shared notification type catalog (spec §20). */
const TYPE_LABELS: Record<string, string> = {
  [NOTIFICATION_TYPES.lowStock]: 'Low stock',
  [NOTIFICATION_TYPES.outOfStock]: 'Out of stock',
  [NOTIFICATION_TYPES.approvalPending]: 'Pending approval',
  [NOTIFICATION_TYPES.approvalApproved]: 'Approval granted',
  [NOTIFICATION_TYPES.approvalRejected]: 'Approval rejected',
  [NOTIFICATION_TYPES.approvalReturned]: 'Returned for revision',
  [NOTIFICATION_TYPES.maintenanceDue]: 'Maintenance due',
  [NOTIFICATION_TYPES.maintenanceOverdue]: 'Maintenance overdue',
  [NOTIFICATION_TYPES.warrantyExpiring]: 'Warranty expiring',
  [NOTIFICATION_TYPES.lotExpiring]: 'Lot expiring',
  [NOTIFICATION_TYPES.assetReturnOverdue]: 'Overdue asset return',
  [NOTIFICATION_TYPES.transferUnreceived]: 'Unreceived transfer',
  [NOTIFICATION_TYPES.separationOutstandingAssets]: 'Separation with outstanding assets',
  [NOTIFICATION_TYPES.jobFailed]: 'Failed job',
};

const TYPE_ICONS: Record<string, LucideIcon> = {
  [NOTIFICATION_TYPES.lowStock]: TriangleAlert,
  [NOTIFICATION_TYPES.outOfStock]: TriangleAlert,
  [NOTIFICATION_TYPES.approvalPending]: Inbox,
  [NOTIFICATION_TYPES.approvalApproved]: CheckCircle2,
  [NOTIFICATION_TYPES.approvalRejected]: XCircle,
  [NOTIFICATION_TYPES.approvalReturned]: CornerUpLeft,
  [NOTIFICATION_TYPES.maintenanceDue]: Wrench,
  [NOTIFICATION_TYPES.maintenanceOverdue]: Wrench,
  [NOTIFICATION_TYPES.warrantyExpiring]: BadgeCheck,
  [NOTIFICATION_TYPES.lotExpiring]: CalendarClock,
  [NOTIFICATION_TYPES.assetReturnOverdue]: Clock,
  [NOTIFICATION_TYPES.transferUnreceived]: ArrowLeftRight,
  [NOTIFICATION_TYPES.separationOutstandingAssets]: UserRoundX,
  [NOTIFICATION_TYPES.jobFailed]: CircleAlert,
};

/**
 * Icon + label per notification type. Exact matches come from the shared
 * catalog (@gemerp/shared NOTIFICATION_TYPES); unknown codes fall back to a
 * fuzzy guess so server-side additions still render sensibly.
 */
export function notificationTypeMeta(type: string | null | undefined): {
  icon: LucideIcon;
  label: string;
} {
  const code = (type ?? '').toUpperCase();
  const exactIcon = TYPE_ICONS[code];
  if (exactIcon) return { icon: exactIcon, label: TYPE_LABELS[code] ?? humanize(code) };
  if (code.includes('STOCK')) return { icon: TriangleAlert, label: humanize(code) };
  if (code.includes('APPROVAL')) return { icon: Inbox, label: humanize(code) };
  if (code.includes('MAINTENANCE')) return { icon: Wrench, label: humanize(code) };
  if (code.includes('EXPIR') || code.includes('WARRANTY'))
    return { icon: CalendarClock, label: humanize(code) };
  if (code.includes('TRANSFER')) return { icon: ArrowLeftRight, label: humanize(code) };
  if (code.includes('OVERDUE')) return { icon: Clock, label: humanize(code) };
  if (code.includes('SEPARATION')) return { icon: UserRoundX, label: humanize(code) };
  if (code.includes('JOB') || code.includes('FAIL'))
    return { icon: CircleAlert, label: humanize(code) };
  return { icon: Bell, label: code ? humanize(code) : 'Notification' };
}

/** Filter options — the shared type catalog with display labels. */
export const NOTIFICATION_TYPE_OPTIONS: Array<{ value: string; label: string }> =
  ALL_NOTIFICATION_TYPES.map((value) => ({
    value,
    label: TYPE_LABELS[value] ?? humanize(value),
  }));
