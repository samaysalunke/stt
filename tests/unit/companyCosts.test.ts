import { describe, expect, it } from 'vitest';
import {
  OVERHEAD_CATEGORIES,
  elapsedMonthsInFinancialYear,
  monthKey,
  monthsInFinancialYear,
  parseCategory,
  parseMonth,
  parseOverheadAmount,
} from '../../src/lib/companyCosts';

describe('parseMonth', () => {
  it.each([['2026-04', '2026-04'], ['2026-12', '2026-12'], ['  2026-01  ', '2026-01']])(
    'accepts %p',
    (input, expected) => {
      expect(parseMonth(input)).toBe(expected);
    },
  );

  it.each([['2026-13'], ['2026-00'], ['2026-1'], ['26-04'], ['2026/04'], ['abc'], [''], [null], ['2026-04-01']])(
    'rejects %p',
    (input) => {
      expect(parseMonth(input)).toBeNull();
    },
  );
});

describe('parseCategory', () => {
  it('accepts every declared category, case-insensitively', () => {
    for (const category of OVERHEAD_CATEGORIES) {
      expect(parseCategory(category)).toBe(category);
      expect(parseCategory(category.toUpperCase())).toBe(category);
    }
  });

  it.each([['payroll'], ['Mktg'], [''], [null], ['salaries ']])('rejects or trims %p', (input) => {
    const result = parseCategory(input);
    expect(result === null || (OVERHEAD_CATEGORIES as readonly string[]).includes(result)).toBe(true);
  });

  it('rejects a category that is not in the vocabulary', () => {
    expect(parseCategory('payroll')).toBeNull();
    expect(parseCategory('Mktg')).toBeNull();
  });
});

describe('parseOverheadAmount', () => {
  it('allows negatives — a refunded subscription is a real credit', () => {
    expect(parseOverheadAmount(-5000)).toBe(-5000);
  });

  it('allows an explicit zero, which is distinct from an absent row', () => {
    expect(parseOverheadAmount(0)).toBe(0);
  });

  it.each([['abc'], [Infinity], [NaN], [2e12], ['']])('rejects %p', (input) => {
    expect(parseOverheadAmount(input)).toBeNull();
  });

  it('rounds fractions', () => {
    expect(parseOverheadAmount(1500.6)).toBe(1501);
  });
});

describe('monthsInFinancialYear', () => {
  it('runs April through March and crosses the calendar year', () => {
    const months = monthsInFinancialYear(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe('2026-04');
    expect(months[8]).toBe('2026-12');
    expect(months[9]).toBe('2027-01');
    expect(months[11]).toBe('2027-03');
  });

  // The likeliest bug in the whole feature: which FY a March/April month lands in.
  it('puts March in the FY that started the previous April', () => {
    expect(monthsInFinancialYear(2025)).toContain('2026-03');
    expect(monthsInFinancialYear(2025)).not.toContain('2026-04');
    expect(monthsInFinancialYear(2026)).toContain('2026-04');
    expect(monthsInFinancialYear(2026)).not.toContain('2026-03');
  });

  it('sorts lexicographically, so a string BETWEEN selects the year', () => {
    const months = monthsInFinancialYear(2026);
    expect([...months].sort()).toEqual(months);
  });
});

describe('elapsedMonthsInFinancialYear', () => {
  const sep2026 = new Date('2026-09-15T12:00:00Z');

  it('counts only the elapsed months of the current financial year', () => {
    const elapsed = elapsedMonthsInFinancialYear(2026, sep2026);
    expect(elapsed).toEqual(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  });

  it('counts all twelve for a completed financial year', () => {
    expect(elapsedMonthsInFinancialYear(2025, sep2026)).toHaveLength(12);
  });

  it('counts none for a future financial year, so a run rate divides by zero nowhere', () => {
    expect(elapsedMonthsInFinancialYear(2027, sep2026)).toHaveLength(0);
  });
});

describe('monthKey', () => {
  it('uses the business timezone, not the host timezone', () => {
    // 19:30 UTC on 31 March is 01:00 IST on 1 April — a different FY.
    expect(monthKey(new Date('2026-03-31T19:30:00Z'))).toBe('2026-04');
    expect(monthKey(new Date('2026-03-31T17:00:00Z'))).toBe('2026-03');
  });
});
