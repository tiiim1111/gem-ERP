/**
 * Pure notification rules (spec §20, Phase 6). Free of Nest/Prisma so the
 * dedup decision table is unit-testable without infrastructure.
 */

/** What the writer should do given the recipient's existing row for a key. */
export type NotificationWriteDecision = 'create' | 'skip' | 'reopen';

/**
 * THE dedup rule (implementation plan Phase 6): a recipient never holds two
 * notifications for the same dedupe key, and never a duplicate UNREAD one.
 *
 * - No existing row → create.
 * - Existing UNREAD row → skip (the alert is already in front of the user).
 * - Existing READ row → reopen it as unread when `reopenAfterRead` (the
 *   condition fired again after the user acknowledged it); otherwise skip
 *   (one-shot alerts such as recurring detector scans must not nag).
 *
 * Rows without a dedupe key are always created.
 */
export function decideNotificationWrite(
  existing: { readAt: Date | null } | null,
  options: { hasDedupeKey: boolean; reopenAfterRead: boolean },
): NotificationWriteDecision {
  if (!options.hasDedupeKey || !existing) {
    return 'create';
  }
  if (existing.readAt === null) {
    return 'skip';
  }
  return options.reopenAfterRead ? 'reopen' : 'skip';
}
