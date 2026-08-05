import { Prisma } from '@prisma/client';
import {
  computeDowntimeMinutes,
  downtimeHoursFromMinutes,
  initialNextDueAt,
  isMeterPlanDue,
  isPlanDue,
  nextDueAfterCompletion,
  nextDueFromInterval,
  reminderWindowStart,
} from './maintenance-schedule';

const D = (value: string | number) => new Prisma.Decimal(value);
const at = (iso: string) => new Date(iso);

describe('maintenance-schedule (pure)', () => {
  describe('nextDueFromInterval', () => {
    it('adds whole days in UTC', () => {
      expect(nextDueFromInterval(at('2026-08-05T00:00:00.000Z'), 180)).toEqual(
        at('2027-02-01T00:00:00.000Z'),
      );
    });
  });

  describe('initialNextDueAt', () => {
    const interval = { intervalDays: 30, meterInterval: null, scheduleCron: null };

    it('an explicit date always wins', () => {
      expect(
        initialNextDueAt(interval, at('2026-09-01T00:00:00.000Z'), at('2026-08-05T00:00:00.000Z')),
      ).toEqual(at('2026-09-01T00:00:00.000Z'));
    });

    it('interval plans anchor on now', () => {
      expect(initialNextDueAt(interval, null, at('2026-08-05T00:00:00.000Z'))).toEqual(
        at('2026-09-04T00:00:00.000Z'),
      );
    });

    it('meter plans have no calendar due date', () => {
      expect(
        initialNextDueAt(
          { intervalDays: null, meterInterval: D('250'), scheduleCron: null },
          null,
          at('2026-08-05T00:00:00.000Z'),
        ),
      ).toBeNull();
    });

    it('cron plans without an explicit date stay dateless', () => {
      expect(
        initialNextDueAt(
          { intervalDays: null, meterInterval: null, scheduleCron: '0 0 1 * *' },
          null,
          at('2026-08-05T00:00:00.000Z'),
        ),
      ).toBeNull();
    });
  });

  describe('nextDueAfterCompletion', () => {
    it('the completer’s explicit next date wins', () => {
      expect(
        nextDueAfterCompletion(
          { intervalDays: 180, meterInterval: null, scheduleCron: null },
          at('2026-12-24T00:00:00.000Z'),
          at('2026-08-05T00:00:00.000Z'),
        ),
      ).toEqual(at('2026-12-24T00:00:00.000Z'));
    });

    it('interval plans re-anchor on the completion date', () => {
      expect(
        nextDueAfterCompletion(
          { intervalDays: 180, meterInterval: null, scheduleCron: null },
          null,
          at('2026-08-05T06:30:00.000Z'),
        ),
      ).toEqual(at('2027-02-01T06:30:00.000Z'));
    });

    it('meter plans go dateless until the next reading', () => {
      expect(
        nextDueAfterCompletion(
          { intervalDays: null, meterInterval: D('250'), scheduleCron: null },
          null,
          at('2026-08-05T00:00:00.000Z'),
        ),
      ).toBeNull();
    });
  });

  describe('isPlanDue', () => {
    const now = at('2026-08-05T12:00:00.000Z');

    it.each([
      [at('2026-08-05T12:00:00.000Z'), true], // exactly now
      [at('2026-08-01T00:00:00.000Z'), true], // overdue
      [at('2026-08-06T00:00:00.000Z'), false], // future
      [null, false], // dateless (meter/cron)
    ])('nextDueAt %p → %p', (nextDueAt, expected) => {
      expect(isPlanDue(nextDueAt, now)).toBe(expected);
    });
  });

  describe('reminderWindowStart', () => {
    it('subtracts the lead days', () => {
      expect(
        reminderWindowStart(at('2026-08-19T00:00:00.000Z'), 14),
      ).toEqual(at('2026-08-05T00:00:00.000Z'));
    });

    it('no lead → window opens at the due date', () => {
      expect(reminderWindowStart(at('2026-08-19T00:00:00.000Z'), null)).toEqual(
        at('2026-08-19T00:00:00.000Z'),
      );
    });

    it('dateless plans have no window', () => {
      expect(reminderWindowStart(null, 14)).toBeNull();
    });
  });

  describe('isMeterPlanDue', () => {
    it('due when usage since last service reaches the interval', () => {
      expect(isMeterPlanDue(D('1410'), D('1160'), D('250'))).toBe(true);
    });

    it('not due below the interval', () => {
      expect(isMeterPlanDue(D('1409.9'), D('1160'), D('250'))).toBe(false);
    });

    it('never-serviced assets baseline at zero', () => {
      expect(isMeterPlanDue(D('250'), null, D('250'))).toBe(true);
      expect(isMeterPlanDue(D('249'), null, D('250'))).toBe(false);
    });

    it('no readings → never due', () => {
      expect(isMeterPlanDue(null, D('100'), D('250'))).toBe(false);
    });
  });

  describe('downtime', () => {
    it('whole minutes, rounded up', () => {
      expect(
        computeDowntimeMinutes(
          at('2026-08-05T08:00:00.000Z'),
          at('2026-08-05T11:00:30.000Z'),
        ),
      ).toBe(181);
    });

    it('non-positive spans clamp to zero', () => {
      expect(
        computeDowntimeMinutes(
          at('2026-08-05T08:00:00.000Z'),
          at('2026-08-05T08:00:00.000Z'),
        ),
      ).toBe(0);
      expect(
        computeDowntimeMinutes(
          at('2026-08-05T08:00:00.000Z'),
          at('2026-08-05T07:00:00.000Z'),
        ),
      ).toBe(0);
    });

    it('mirrors to 2dp hours for the legacy column', () => {
      expect(downtimeHoursFromMinutes(90).toString()).toBe('1.5');
      expect(downtimeHoursFromMinutes(181).toString()).toBe('3.02');
      expect(downtimeHoursFromMinutes(0).toString()).toBe('0');
    });
  });
});
