import { describe, expect, it } from 'vitest';
import { DEFAULT_BALANCE_RULE, balanceDueDate, parseBalanceDueDays } from '../../src/lib/balanceDue';

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
