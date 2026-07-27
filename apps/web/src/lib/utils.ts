import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { ORG_TIMEZONE } from '@gemerp/shared';

/** Tailwind-aware className combiner (clsx + tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const dateTimeFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: ORG_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: ORG_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
});

/** Format an ISO timestamp in the org display timezone (Asia/Manila). */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

/** Format an ISO timestamp as a date only, in the org display timezone. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

/** Compact relative time ("3m ago", "2h ago", "5d ago") for activity feeds. */
export function formatRelativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 45) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return formatDate(date);
}

/** Initials for avatar chips ("Maria dela Cruz" -> "MD"). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** "user_branch_access" / "storage_location" -> "User branch access". */
export function humanize(value: string): string {
  const spaced = value.replace(/[_.-]+/g, ' ').trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
