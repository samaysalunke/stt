import { describe, expect, it } from 'vitest';
import {
  buildRegAggregateSql,
  computeDepartureFinance,
  costBreakdown,
  parseItemLabel,
  parseRupees,
  rollUp,
  EMPTY_AGGREGATE,
  type DepartureMeta,
  type RegAggregate,
} from '../../src/lib/departureFinance';
import { NON_REVENUE_STATUSES } from '../../src/lib/registrationsView';

const meta = (over: Partial<DepartureMeta> = {}): DepartureMeta => ({
  tripSlug: 'nagaland', tripName: 'Nagaland', batchId: 'nagaland-2025-12-05',
  startDate: '2025-12-05', endDate: '2025-12-11', status: 'completed',
  lowestOfferPrice: 20500, capacity: 15, balanceDueRule: '10 days before trip',
  ...over,
});

const agg = (over: Partial<RegAggregate> = {}): RegAggregate => ({ ...EMPTY_AGGREGATE, ...over });

/** 10 committed seats @ ₹20,000 contracted, ₹1,50,000 collected. */
const TEN_SEATS = agg({
  seats: 10, committedSeats: 10, confirmedSeats: 10,
  collected: 150_000, collectedCommitted: 150_000, contracted: 200_000,
  outstanding: 50_000,
});

const finance = (a: RegAggregate, base: number | null, items: number[] = [], m = meta()) =>
  computeDepartureFinance(
    m,
    a,
    costBreakdown(
      base === null ? null : { base_amount: base, note: null, updated_at: null, updated_by_email: null },
      items.map((amount, i) => ({ id: i + 1, label: `item ${i + 1}`, amount })),
    ),
  );

describe('costBreakdown', () => {
  it('totals the base plus every line item, credits included', () => {
    const cost = finance(TEN_SEATS, 90_000, [15_000, -5_000]).cost;
    expect(cost.base).toBe(90_000);
    expect(cost.itemsTotal).toBe(10_000);
    expect(cost.total).toBe(100_000);
    expect(cost.costed).toBe(true);
  });

  it('orders items by sort_order, then id', () => {
    const cost = costBreakdown(null, [
      { id: 9, label: 'c', amount: 1, sort_order: 2 },
      { id: 3, label: 'b', amount: 1, sort_order: 1 },
      { id: 1, label: 'a', amount: 1, sort_order: 1 },
    ]);
    expect(cost.items.map((i) => i.label)).toEqual(['a', 'b', 'c']);
  });

  it('is costed on a line item alone, with base 0 and no base row', () => {
    const cost = costBreakdown(null, [{ id: 1, label: 'permits', amount: 4_000 }]);
    expect(cost.costed).toBe(true);
    expect(cost.hasBaseRow).toBe(false);
    expect(cost.base).toBe(0);
    expect(cost.total).toBe(4_000);
  });
});

describe('margin', () => {
  it('computes margin, percentage and outstanding balance', () => {
    const f = finance(TEN_SEATS, 90_000, [15_000, -5_000]);
    expect(f.margin).toBe(50_000);
    expect(f.marginPct).toBeCloseTo(33.33, 2);
    expect(f.stillToCollect).toBe(50_000);
  });

  it('is null — never 0 — when the departure is not costed', () => {
    const f = finance(TEN_SEATS, null, []);
    expect(f.cost.costed).toBe(false);
    expect(f.margin).toBeNull();
    expect(f.marginPct).toBeNull();
  });

  it('treats an explicit base of 0 as costed, not as missing', () => {
    const f = finance(TEN_SEATS, 0, []);
    expect(f.cost.costed).toBe(true);
    expect(f.cost.hasBaseRow).toBe(true);
    expect(f.margin).toBe(150_000);
    expect(f.marginPct).toBe(100);
  });

  it('keeps margin meaningful but percentage null when nothing was collected', () => {
    const f = finance(agg(), 90_000, []);
    expect(f.margin).toBe(-90_000);
    expect(f.marginPct).toBeNull();
  });

  it('allows credits to exceed the base without clamping', () => {
    const f = finance(TEN_SEATS, 10_000, [-30_000]);
    expect(f.cost.total).toBe(-20_000);
    expect(f.margin).toBe(170_000);
    expect(Number.isFinite(f.marginPct!)).toBe(true);
  });
});

describe('the three traps', () => {
  it('(a) never subtracts amount_refunded — amount_paid is already net', () => {
    // A fully refunded booking: amount_paid decremented to 0, amount_refunded 5000.
    const f = finance(agg({ refundedGross: 5_000, collected: 0 }), 10_000, []);
    expect(f.collected).toBe(0);
    expect(f.refundedGross).toBe(5_000);
    // Had refundedGross been subtracted, margin would be -15,000.
    expect(f.margin).toBe(-10_000);
  });

  it('(b) a lead advance never offsets a committed traveller’s balance', () => {
    // One confirmed seat owing 20,000 having paid 8,000, plus a lead who paid 5,000.
    const f = finance(agg({
      seats: 2, committedSeats: 1, confirmedSeats: 1, leadSeats: 1,
      collected: 13_000, collectedCommitted: 8_000, contracted: 20_000,
      outstanding: 12_000,
    }), 0, []);
    expect(f.leadAdvances).toBe(5_000);
    expect(f.stillToCollect).toBe(12_000); // not 7,000
    expect(f.contracted).toBe(20_000);
  });

  it('(c) surfaces cash retained from a cancelled booking', () => {
    const f = finance(agg({ ...TEN_SEATS, cancelledSeats: 1, retained: 12_000 }), 90_000, []);
    expect(f.collected).toBe(150_000);
    expect(f.retained).toBe(12_000);
    expect(f.marginIncludingRetained! - f.margin!).toBe(12_000);
  });
});

describe('edge cases', () => {
  it('flags committed seats with no recorded price and never goes negative', () => {
    const f = finance(agg({
      seats: 3, committedSeats: 3, confirmedSeats: 3,
      collected: 60_000, collectedCommitted: 60_000,
      contracted: 20_000, contractedUnknownSeats: 2, outstanding: 0,
    }), 10_000, []);
    expect(f.contractedUnknownSeats).toBe(2);
    expect(f.stillToCollect).toBe(0);
    expect(f.overCollected).toBe(40_000);
  });

  it('falls back to the lowest offer price for break-even with no bookings', () => {
    const f = finance(agg(), 90_000, [], meta({ lowestOfferPrice: 20_500 }));
    expect(f.avgContractedSeatPrice).toBe(20_500);
    expect(f.breakEvenSeats).toBe(5); // ceil(90000 / 20500)
    expect(f.breakEvenSeatsRemaining).toBe(5);
  });

  it('derives break-even from realised contracted price when seats are sold', () => {
    const f = finance(TEN_SEATS, 90_000, []);
    expect(f.avgContractedSeatPrice).toBe(20_000);
    expect(f.breakEvenSeats).toBe(5);
    expect(f.breakEvenSeatsRemaining).toBe(0);
  });

  it('has no break-even when the departure is not costed', () => {
    expect(finance(TEN_SEATS, null, []).breakEvenSeats).toBeNull();
  });
});

describe('outstanding is summed per registration, not netted per departure', () => {
  it('does not let an overpayer hide a debtor', () => {
    // Two bookings on one departure: one overpaid by 10,000, one still owes
    // 10,000. Netting at departure level reports nothing outstanding; the SQL
    // sums max(0, owed) per row, so the real debt survives.
    const f = finance(agg({
      seats: 2, committedSeats: 2, confirmedSeats: 2,
      contracted: 40_000, collected: 40_000, collectedCommitted: 40_000,
      outstanding: 10_000,
    }), 0, []);
    expect(f.stillToCollect).toBe(10_000);
    expect(f.overCollected).toBe(0);
  });

  it('never reports a negative balance', () => {
    expect(finance(agg({ outstanding: 0, contracted: 10_000, collectedCommitted: 25_000 }), 0, []).stillToCollect).toBe(0);
  });
});

describe('buildRegAggregateSql', () => {
  it('expands the shared non-revenue status list rather than a retyped copy', () => {
    const { sql, params } = buildRegAggregateSql();
    // The seat-count column binds the live-status list first, so the leading
    // params must be NON_REVENUE_STATUSES verbatim. If someone edits that
    // constant without touching this module, this fails.
    expect(params.slice(0, NON_REVENUE_STATUSES.length)).toEqual([...NON_REVENUE_STATUSES]);
    const firstNotIn = sql.match(/NOT IN \(([?,\s]+)\)/);
    expect(firstNotIn?.[1].split(',')).toHaveLength(NON_REVENUE_STATUSES.length);
    expect(sql).toContain('GROUP BY trip_slug, batch_id');
    // Statuses are bound, never inlined, so the list cannot silently fork.
    expect(sql).not.toMatch(/'rejected'|'wishlist'/);
  });
});

describe('rollUp', () => {
  const costedA = finance(TEN_SEATS, 90_000, []);          // collected 150k, cost 90k
  const costedB = finance(agg({ collected: 50_000, collectedCommitted: 50_000, seats: 4, committedSeats: 4 }), 20_000, []);
  const uncosted = finance(agg({ collected: 400_000, collectedCommitted: 400_000, seats: 20, committedSeats: 20 }), null, []);

  it('excludes uncosted departures from the margin lines', () => {
    const totals = rollUp([costedA, costedB, uncosted]);
    expect(totals.cost).toBe(110_000);
    expect(totals.margin).toBe(90_000); // (150k + 50k) - 110k, the 400k excluded
    expect(totals.marginPct).toBeCloseTo(45, 5);
    expect(totals.uncostedDepartures).toBe(1);
    expect(totals.costedDepartures).toBe(2);
  });

  it('still counts every departure in the collected total', () => {
    const totals = rollUp([costedA, costedB, uncosted]);
    expect(totals.collected).toBe(600_000);
  });

  it('reconciles unallocated registrations into the collected total', () => {
    const totals = rollUp([costedA], { rows: 2, seats: 3, collected: 25_000 });
    expect(totals.collected).toBe(175_000);
    expect(totals.seats).toBe(13);
  });

  it('has a null blended percentage when no costed departure collected anything', () => {
    expect(rollUp([finance(agg(), 5_000, [])]).marginPct).toBeNull();
  });
});

describe('parseRupees', () => {
  it.each([
    ['abc', null], ['', null], [null, null], [undefined, null],
    [Infinity, null], [NaN, null], [2e12, null],
    [1500.6, 1501], [1500.4, 1500], ['20,500', 20500], [' 900 ', 900], [0, 0],
  ])('parses %p as %p', (input, expected) => {
    expect(parseRupees(input)).toBe(expected);
  });

  it('rejects a negative when a minimum of zero is set', () => {
    expect(parseRupees(-1, { min: 0 })).toBeNull();
    expect(parseRupees(-1)).toBe(-1);
  });

  it('rejects zero for line items, which must not be zero', () => {
    expect(parseRupees(0, { allowZero: false })).toBeNull();
    expect(parseRupees(-5000, { allowZero: false })).toBe(-5000);
  });
});

describe('parseItemLabel', () => {
  it.each([['', null], ['   ', null], [null, null], ['x'.repeat(81), null], ['  Permits ', 'Permits']])(
    'parses %p as %p',
    (input, expected) => {
      expect(parseItemLabel(input)).toBe(expected);
    },
  );
});
