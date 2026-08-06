import { decideNotificationWrite } from './notification-rules';

/**
 * The Phase 6 dedup contract (spec §20, implementation plan): never a
 * duplicate UNREAD notification for the same type+resource+recipient key.
 * Recipient/type/resource identity lives in the dedupe key; this table
 * decides what the writer does given the recipient's existing row.
 */
describe('decideNotificationWrite — dedup rules', () => {
  it('creates when there is no existing row for the key', () => {
    expect(
      decideNotificationWrite(null, { hasDedupeKey: true, reopenAfterRead: true }),
    ).toBe('create');
  });

  it('always creates keyless notifications (no dedup identity)', () => {
    expect(
      decideNotificationWrite(null, { hasDedupeKey: false, reopenAfterRead: true }),
    ).toBe('create');
    // Even a matching row cannot dedupe a keyless write.
    expect(
      decideNotificationWrite(
        { readAt: null },
        { hasDedupeKey: false, reopenAfterRead: true },
      ),
    ).toBe('create');
  });

  it('SKIPS when an UNREAD row already exists — the core rule', () => {
    expect(
      decideNotificationWrite(
        { readAt: null },
        { hasDedupeKey: true, reopenAfterRead: true },
      ),
    ).toBe('skip');
    expect(
      decideNotificationWrite(
        { readAt: null },
        { hasDedupeKey: true, reopenAfterRead: false },
      ),
    ).toBe('skip');
  });

  it('reopens a READ row for event-driven alerts (condition fired again)', () => {
    expect(
      decideNotificationWrite(
        { readAt: new Date('2026-08-01T00:00:00.000Z') },
        { hasDedupeKey: true, reopenAfterRead: true },
      ),
    ).toBe('reopen');
  });

  it('skips a READ row for one-shot detector alerts (no nagging)', () => {
    expect(
      decideNotificationWrite(
        { readAt: new Date('2026-08-01T00:00:00.000Z') },
        { hasDedupeKey: true, reopenAfterRead: false },
      ),
    ).toBe('skip');
  });
});
