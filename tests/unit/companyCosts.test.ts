import { describe, expect, it } from 'vitest';
import {
  elapsedMonthsInFinancialYear,
  monthKey,
  monthsInFinancialYear,
} from '../../src/lib/companyCosts';

describe('monthsInFinancialYear', () => {
  // The likeliest bug in the whole feature: which FY a March/April month lands in.
  it('puts March in the FY that started the previous April', () => {
    expect(monthsInFinancialYear(2025)).toContain('2026-03');
    expect(monthsInFinancialYear(2025)).not.toContain('2026-04');
    expect(monthsInFinancialYear(2026)).toContain('2026-04');
    expect(monthsInFinancialYear(2026)).not.toContain('2026-03');
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
