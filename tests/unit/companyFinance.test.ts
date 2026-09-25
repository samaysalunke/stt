import { describe, expect, it } from 'vitest';
import { computePnl, monthRange, COVERAGE_THRESHOLD } from '../../src/lib/companyFinance';
import {
  computeDepartureFinance,
  costBreakdown,
  EMPTY_AGGREGATE,
  type DepartureFinance,
  type DepartureMeta,
  type RegAggregate,
} from '../../src/lib/departureFinance';
import type { CompanyCostRow } from '../../src/lib/companyCosts';

const meta = (over: Partial<DepartureMeta> = {}): DepartureMeta => ({
  tripSlug: 'ladakh', tripName: 'Ladakh', batchId: 'ladakh-2026-06',
  startDate: '2026-06-27', endDate: '2026-07-05', status: 'completed',
  lowestOfferPrice: 35000, capacity: 15, balanceDueRule: '15 days before trip',
  ...over,
});

/** A departure with known collected cash and an optional cost. */
const dep = (collected: number, cost: number | null, over: Partial<DepartureMeta> = {}): DepartureFinance =>
  computeDepartureFinance(
    meta(over),
    { ...EMPTY_AGGREGATE, collected, collectedCommitted: collected } as RegAggregate,
    costBreakdown(cost === null ? null : { base_amount: cost, note: null, updated_at: null, updated_by_email: null }, []),
  );

const overhead = (month: string, category: string, amount: number): CompanyCostRow =>
  ({ id: 1, month, category, amount, note: null, updatedAt: null, updatedByEmail: null });

const NO_LEAKS = { unallocatedCollected: 0, orphanCostTotal: 0, allDepartures: [] as DepartureFinance[] };
const opts = (monthsInPeriod: number) => ({ fyStart: 2026, label: 'FY 2026–27', monthsInPeriod });

describe('computePnl', () => {
  it('walks cash collected down to net profit', () => {
    const pnl = computePnl(
      [dep(500_000, 300_000)],
      [overhead('2026-04', 'salaries', 50_000), overhead('2026-05', 'salaries', 50_000)],
      NO_LEAKS,
      opts(2),
    );
    expect(pnl.cashCollected).toBe(500_000);
    expect(pnl.directCost).toBe(300_000);
    expect(pnl.grossMargin).toBe(200_000);
    expect(pnl.grossMarginPct).toBeCloseTo(40, 5);
    expect(pnl.overheads).toBe(100_000);
    expect(pnl.netProfit).toBe(100_000);
    expect(pnl.monthsEntered).toBe(2);
    expect(pnl.indicative).toBe(false);
    expect(pnl.netProfitPct).toBeCloseTo(20, 5);
  });

  it('never nulls net profit when overheads are only partly entered', () => {
    const pnl = computePnl([dep(500_000, 300_000)], [overhead('2026-04', 'salaries', 50_000)], NO_LEAKS, opts(12));
    expect(pnl.netProfit).toBe(150_000);       // a number, not null
    expect(pnl.indicative).toBe(true);
    expect(pnl.netProfitPct).toBeNull();       // the percentage is what gets withheld
    expect(pnl.monthsEntered).toBe(1);
    expect(pnl.monthsInPeriod).toBe(12);
  });

  it('extrapolates a run rate from the months that are entered', () => {
    const pnl = computePnl([dep(500_000, 300_000)], [overhead('2026-04', 'salaries', 50_000)], NO_LEAKS, opts(12));
    expect(pnl.overheadRunRate).toBe(600_000);            // 50,000 x 12
    expect(pnl.netProfitAtRunRate).toBe(-400_000);        // 200,000 - 600,000
  });

  it('has no run rate when nothing is entered, rather than dividing by zero', () => {
    const pnl = computePnl([dep(500_000, 300_000)], [], NO_LEAKS, opts(12));
    expect(pnl.overheadRunRate).toBeNull();
    expect(pnl.netProfitAtRunRate).toBeNull();
    expect(pnl.netProfit).toBe(200_000);
  });

  it('withholds the percentage when cost coverage is thin', () => {
    // 100k costed, 900k uncosted -> coverage 0.1
    const pnl = computePnl(
      [dep(100_000, 40_000), dep(900_000, null, { batchId: 'other' })],
      [overhead('2026-04', 'salaries', 10_000)],
      NO_LEAKS,
      opts(1),
    );
    expect(pnl.costCoverage).toBeCloseTo(0.1, 5);
    expect(pnl.costCoverage!).toBeLessThan(COVERAGE_THRESHOLD);
    expect(pnl.indicative).toBe(true);
    expect(pnl.netProfitPct).toBeNull();
    expect(pnl.uncostedDepartures).toBe(1);
    expect(pnl.uncostedCollected).toBe(900_000);
    // The margin base is the costed subset, not all cash.
    expect(pnl.cashCollected).toBe(1_000_000);
    expect(pnl.cashCollectedCosted).toBe(100_000);
  });

  it('reports a loss when overheads exist and no departure ran', () => {
    const pnl = computePnl([], [overhead('2026-04', 'salaries', 80_000)], NO_LEAKS, opts(1));
    expect(pnl.netProfit).toBe(-80_000);
    expect(pnl.grossMargin).toBe(0);
    expect(pnl.indicative).toBe(false);
  });

  it('returns null percentages rather than NaN when everything is zero', () => {
    const pnl = computePnl([], [], NO_LEAKS, opts(0));
    expect(pnl.grossMarginPct).toBeNull();
    expect(pnl.netProfitPct).toBeNull();
    expect(pnl.costCoverage).toBeNull();
    expect(Number.isNaN(pnl.netProfit)).toBe(false);
  });

  it('groups overheads by category and drops empty ones', () => {
    const pnl = computePnl([], [
      overhead('2026-04', 'salaries', 50_000),
      overhead('2026-05', 'salaries', 50_000),
      overhead('2026-04', 'software', 8_000),
      overhead('2026-04', 'marketing', 0),
    ], NO_LEAKS, opts(2));
    expect(pnl.overheadsByCategory).toEqual([
      { category: 'salaries', amount: 100_000 },
      { category: 'software', amount: 8_000 },
    ]);
  });

  it('lets a negative overhead reduce the total', () => {
    const pnl = computePnl([], [
      overhead('2026-04', 'software', 12_000),
      overhead('2026-05', 'software', -5_000),
    ], NO_LEAKS, opts(2));
    expect(pnl.overheads).toBe(7_000);
  });

  it('counts departures that fall out of every financial year', () => {
    const stranded = dep(70_000, null, { startDate: 'sometime in June', batchId: 'bad-date' });
    expect(stranded.financialYearStart).toBeNull();
    const pnl = computePnl([], [], { ...NO_LEAKS, allDepartures: [stranded] }, opts(1));
    expect(pnl.departuresWithoutFy).toBe(1);
    expect(pnl.departuresWithoutFyCollected).toBe(70_000);
  });

});

describe('monthRange', () => {
  it('spans a calendar year boundary', () => {
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });

  it('includes a single month', () => {
    expect(monthRange('2026-06', '2026-06')).toEqual(['2026-06']);
  });

  it('is empty when the range is inverted', () => {
    expect(monthRange('2026-06', '2026-05')).toEqual([]);
  });
});
