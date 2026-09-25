import { describe, expect, it } from 'vitest';
import { DEFAULT_BALANCE_RULE, balanceDueDate, daysBetweenDates, overdueDays, parseBalanceDueDays } from '../../src/lib/balanceDue';

describe('parseBalanceDueDays', () => {
  it.each([
    ['15 days before trip', 15],
    ['10 days before trip', 10],
    ['10 days before departure', 10],
    ['1 day before trip', 1],
    ['  7 days before trip  ', 7],
    ['30 DAYS BEFORE TRIP', 30],
    ['21days before', 21],
    [DEFAULT_BALANCE_RULE, 15],
  ])('parses %p as %p', (rule, expected) => {
    expect(parseBalanceDueDays(rule)).toBe(expected);
  });

  it.each([
    ['on arrival'],
    [''],
    ['   '],
    [null],
    [undefined],
    ['due before trip'],
    // The pattern is anchored. This case is pinned deliberately: the same
    // function renders the due date shown to travellers at checkout, so
    // loosening the pattern must be an explicit change to this test, never a
    // side effect of an unrelated edit.
    ['Balance due 15 days before'],
  ])('returns null for %p', (rule) => {
    expect(parseBalanceDueDays(rule)).toBeNull();
  });
});

describe('balanceDueDate', () => {
  it('subtracts the stated days from the departure date', () => {
    expect(balanceDueDate('2026-06-27', '15 days before trip')).toBe('2026-06-12');
    expect(balanceDueDate('2025-12-05', '10 days before trip')).toBe('2025-11-25');
  });

  it('rolls back across a month and a year boundary', () => {
    expect(balanceDueDate('2026-01-05', '15 days before trip')).toBe('2025-12-21');
    expect(balanceDueDate('2026-03-01', '1 day before trip')).toBe('2026-02-28');
  });

  /**
   * Regression guard. The lifted checkout code parsed the start date as LOCAL
   * midnight and then serialised it with toISOString() (UTC), so in any zone
   * ahead of UTC the result rolled back a day — every traveller in IST was shown
   * a due date one day early. These assertions must hold whatever TZ the suite
   * runs under.
   */
  it('is timezone-independent', () => {
    const original = process.env.TZ;
    try {
      for (const tz of ['Asia/Kolkata', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        process.env.TZ = tz;
        expect(balanceDueDate('2026-06-27', '15 days before trip')).toBe('2026-06-12');
      }
    } finally {
      process.env.TZ = original;
    }
  });

  it.each([
    ['2026-06-27', 'on arrival'],
    ['2026-06-27', ''],
    ['', '15 days before trip'],
    ['27 June 2026', '15 days before trip'],
    [null, '15 days before trip'],
  ])('returns null for start %p with rule %p', (startDate, rule) => {
    expect(balanceDueDate(startDate, rule)).toBeNull();
  });
});

describe('daysBetweenDates', () => {
  it('counts whole UTC days in either direction', () => {
    expect(daysBetweenDates('2026-09-01', '2026-09-15')).toBe(14);
    expect(daysBetweenDates('2026-09-15', '2026-09-01')).toBe(-14);
    expect(daysBetweenDates('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('overdueDays', () => {
  it('is null without a due date', () => {
    expect(overdueDays({ dueDate: null, todayKey: '2026-09-24', createdAt: '2026-01-01' })).toBeNull();
  });

  it('is zero or negative before and on the due date', () => {
    expect(overdueDays({ dueDate: '2026-10-01', todayKey: '2026-09-24' })).toBe(-7);
    expect(overdueDays({ dueDate: '2026-09-24', todayKey: '2026-09-24' })).toBe(0);
  });

  it('counts days late from the due date for an old booking', () => {
    expect(overdueDays({ dueDate: '2026-09-14', todayKey: '2026-09-24', createdAt: '2026-06-01 10:00:00' })).toBe(10);
  });

  // The number a traveller is shown to create urgency must not claim they are
  // 50 days late on a booking they made three days ago.
  it('clamps by the booking date: booked 3 days ago against a due date 50 days past is 3, not 50', () => {
    expect(overdueDays({ dueDate: '2026-08-05', todayKey: '2026-09-24', createdAt: '2026-09-21 09:00:00' })).toBe(3);
  });

  it('ignores an unparseable booking date rather than clamping to it', () => {
    expect(overdueDays({ dueDate: '2026-08-05', todayKey: '2026-09-24', createdAt: 'yesterday' })).toBe(50);
  });
});
