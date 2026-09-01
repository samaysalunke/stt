import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { resolveBooking } from '../../src/lib/content';

// Pin the clock to 2026-07-01 so upcomingBatches() date-filtering is deterministic
// regardless of when the suite runs. 2099 fixture dates are always "future";
// 2020 dates are always "past".
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
});
afterAll(() => vi.useRealTimers());

const FAR_FUTURE = '2099-01-01';
const FAR_FUTURE_END = '2099-01-05';
const PAST = '2020-01-01';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSingleTierTrip(overrides: Record<string, any> = {}) {
  return {
    status: 'booking-open',
    occupancyCatalog: [{ id: 'standard', label: 'Standard', helperText: '' }],
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [{ tierId: 'standard', price: 35000, cap: 15, booked: 0 }],
      },
    ],
    paymentAmount: 10000,
    balanceDueRule: '15 days before trip',
    ...overrides,
  };
}

function makeMultiTierTrip(overrides: Record<string, any> = {}) {
  return {
    status: 'booking-open',
    occupancyCatalog: [
      { id: 'dorm', label: 'Dorm Bed', helperText: 'Shared room.' },
      { id: 'private', label: 'Private Room', helperText: 'Own room.' },
    ],
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [
          { tierId: 'dorm', price: 5000, cap: 12, booked: 0 },
          { tierId: 'private', price: 7000, cap: 3, booked: 0 },
        ],
      },
    ],
    paymentAmount: 1000,
    balanceDueRule: '10 days before trip',
    ...overrides,
  };
}

// ── New schema — single tier ──────────────────────────────────────────────────

describe('new schema — single tier (Kashmir/Ladakh pattern)', () => {
  test('catalog has exactly one entry', () => {
    const b = resolveBooking(makeSingleTierTrip());
    expect(b.occupancyCatalog).toHaveLength(1);
    expect(b.occupancyCatalog[0].id).toBe('standard');
  });

  test('single departure with one offer', () => {
    const b = resolveBooking(makeSingleTierTrip());
    expect(b.departures).toHaveLength(1);
    expect(b.departures[0].offers).toHaveLength(1);
  });

  test('fromPrice equals the single offer price', () => {
    const b = resolveBooking(makeSingleTierTrip());
    expect(b.fromPrice).toBe(35000);
  });

  test('offer is available when booked < cap', () => {
    const b = resolveBooking(makeSingleTierTrip());
    expect(b.departures[0].offers[0].available).toBe(true);
  });

  test('departure is not sold out', () => {
    const b = resolveBooking(makeSingleTierTrip());
    expect(b.departures[0].soldOut).toBe(false);
  });
});

// ── New schema — multi-tier, both available ───────────────────────────────────

describe('new schema — multi-tier, both available (Meghalaya pattern)', () => {
  test('fromPrice is the cheaper tier price', () => {
    const b = resolveBooking(makeMultiTierTrip());
    expect(b.fromPrice).toBe(5000);
  });

  test('both offers are available', () => {
    const dep = resolveBooking(makeMultiTierTrip()).departures[0];
    expect(dep.offers.every((o) => o.available)).toBe(true);
  });

  test('offers carry label and helperText from catalog', () => {
    const offers = resolveBooking(makeMultiTierTrip()).departures[0].offers;
    const dorm = offers.find((o) => o.tierId === 'dorm')!;
    expect(dorm.label).toBe('Dorm Bed');
    expect(dorm.helperText).toBe('Shared room.');
  });

  test('spotsLeft = sum of (cap - booked) across offers', () => {
    const dep = resolveBooking(makeMultiTierTrip()).departures[0];
    expect(dep.spotsLeft).toBe(15); // 12 + 3
    expect(dep.totalCap).toBe(15);
  });
});

describe('departure-wide discounts', () => {
  test('active fixed discount applies to every accommodation and retains base prices', () => {
    const trip = makeMultiTierTrip({
      batches: [{
        ...makeMultiTierTrip().batches[0],
        discountAmount: 1200,
        discountEndsAt: '2026-07-02T00:00:00.000Z',
      }],
    });
    const dep = resolveBooking(trip).departures[0];
    expect(dep.discountActive).toBe(true);
    expect(dep.discountAmount).toBe(1200);
    expect(dep.offers.map((offer) => offer.price)).toEqual([3800, 5800]);
    expect(dep.offers.map((offer) => offer.originalPrice)).toEqual([5000, 7000]);
    expect(resolveBooking(trip).fromPrice).toBe(3800);
  });

  test('expired discount automatically restores base prices', () => {
    const trip = makeMultiTierTrip({
      batches: [{
        ...makeMultiTierTrip().batches[0],
        discountAmount: 1200,
        discountEndsAt: '2026-06-30T23:59:59.000Z',
      }],
    });
    const dep = resolveBooking(trip).departures[0];
    expect(dep.discountActive).toBe(false);
    expect(dep.offers.map((offer) => offer.price)).toEqual([5000, 7000]);
    expect(dep.offers.every((offer) => offer.originalPrice === null)).toBe(true);
  });

  test('discount without an expiry remains active and never makes a price negative', () => {
    const trip = makeSingleTierTrip({
      batches: [{
        ...makeSingleTierTrip().batches[0],
        discountAmount: 50000,
      }],
    });
    const dep = resolveBooking(trip).departures[0];
    expect(dep.discountActive).toBe(true);
    expect(dep.discountEndsAt).toBeNull();
    expect(dep.offers[0].price).toBe(0);
    expect(dep.offers[0].originalPrice).toBe(35000);
  });
});

// ── New schema — one tier sold out on a departure ────────────────────────────

describe('new schema — one tier sold out (Sahyadri jul1 pattern)', () => {
  const trip = makeMultiTierTrip({
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [
          { tierId: 'dorm', price: 5000, cap: 12, booked: 0 },
          { tierId: 'private', price: 7000, cap: 3, booked: 3 }, // sold out
        ],
      },
    ],
  });

  test('departure has 2 offers (chooser shown with disabled row)', () => {
    const dep = resolveBooking(trip).departures[0];
    expect(dep.offers).toHaveLength(2);
  });

  test('private offer is not available', () => {
    const dep = resolveBooking(trip).departures[0];
    const priv = dep.offers.find((o) => o.tierId === 'private')!;
    expect(priv.available).toBe(false);
  });

  test('dorm offer is still available', () => {
    const dep = resolveBooking(trip).departures[0];
    const dorm = dep.offers.find((o) => o.tierId === 'dorm')!;
    expect(dorm.available).toBe(true);
  });

  test('departure is not sold out (dorm still has spots)', () => {
    const dep = resolveBooking(trip).departures[0];
    expect(dep.soldOut).toBe(false);
  });

  test('spotsLeft counts only dorm (private fully booked)', () => {
    const dep = resolveBooking(trip).departures[0];
    expect(dep.spotsLeft).toBe(12);
  });
});

// ── New schema — single-tier date in multi-tier trip ─────────────────────────

describe('new schema — single-tier date in multi-tier trip (Sahyadri jul2 pattern)', () => {
  const trip = makeMultiTierTrip({
    batches: [
      {
        id: 'dep-dorm-only',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [
          { tierId: 'dorm', price: 5000, cap: 15, booked: 0 }, // only dorm offered
        ],
      },
    ],
  });

  test('departure has only 1 offer', () => {
    expect(resolveBooking(trip).departures[0].offers).toHaveLength(1);
  });

  test('catalog still has 2 tiers (trip-level, not filtered)', () => {
    expect(resolveBooking(trip).occupancyCatalog).toHaveLength(2);
  });
});

// ── New schema — tier absent from departure ───────────────────────────────────

test('tier absent from a departure does not appear in that departure offers', () => {
  const trip = makeMultiTierTrip({
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [{ tierId: 'dorm', price: 5000, cap: 10, booked: 0 }],
        // 'private' deliberately absent — no phantom row
      },
    ],
  });
  const dep = resolveBooking(trip).departures[0];
  expect(dep.offers.find((o) => o.tierId === 'private')).toBeUndefined();
  expect(dep.offers).toHaveLength(1);
});

// ── All departures sold out ───────────────────────────────────────────────────

describe('all departures sold out', () => {
  const trip = makeMultiTierTrip({
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [
          { tierId: 'dorm', price: 5000, cap: 5, booked: 5 },
          { tierId: 'private', price: 7000, cap: 2, booked: 2 },
        ],
      },
    ],
  });

  test('departure is sold out', () => {
    expect(resolveBooking(trip).departures[0].soldOut).toBe(true);
  });

  test('fromPrice falls back to cheapest offer overall when everything sold out', () => {
    expect(resolveBooking(trip).fromPrice).toBe(5000);
  });
});

// ── Unmetered cap (cap = null) ────────────────────────────────────────────────

describe('unmetered cap (cap = null)', () => {
  const trip = makeSingleTierTrip({
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [{ tierId: 'standard', price: 35000, cap: null, booked: 0 }],
      },
    ],
  });

  test('offer is available', () => {
    expect(resolveBooking(trip).departures[0].offers[0].available).toBe(true);
  });

  test('spotsLeft is null (unmetered)', () => {
    expect(resolveBooking(trip).departures[0].spotsLeft).toBeNull();
  });

  test('totalCap is null (unmetered)', () => {
    expect(resolveBooking(trip).departures[0].totalCap).toBeNull();
  });
});

// ── Status-driven sold-out ────────────────────────────────────────────────────

test('batch status sold-out makes departure soldOut regardless of stock', () => {
  const trip = makeSingleTierTrip({
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'sold-out',
        offers: [{ tierId: 'standard', price: 35000, cap: 15, booked: 0 }],
      },
    ],
  });
  expect(resolveBooking(trip).departures[0].soldOut).toBe(true);
});

// ── Date filtering ────────────────────────────────────────────────────────────

test('past departure is filtered out (pinned clock: 2026-07-01)', () => {
  const trip = makeSingleTierTrip({
    batches: [
      {
        id: 'past-dep',
        startDate: PAST,
        endDate: PAST,
        status: 'booking-open',
        offers: [{ tierId: 'standard', price: 35000, cap: 15, booked: 0 }],
      },
    ],
  });
  expect(resolveBooking(trip).departures).toHaveLength(0);
  expect(resolveBooking(trip).fromPrice).toBeNull();
});

test('draft batch is filtered out', () => {
  const trip = makeSingleTierTrip({
    batches: [
      {
        id: 'dep-draft',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'draft',
        offers: [{ tierId: 'standard', price: 35000, cap: 15, booked: 0 }],
      },
    ],
  });
  expect(resolveBooking(trip).departures).toHaveLength(0);
});

test('completed batch is filtered out', () => {
  const trip = makeSingleTierTrip({
    batches: [
      {
        id: 'dep-done',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'completed',
        offers: [{ tierId: 'standard', price: 35000, cap: 15, booked: 0 }],
      },
    ],
  });
  expect(resolveBooking(trip).departures).toHaveLength(0);
});

test('offer with missing tierId is silently filtered', () => {
  const trip = makeSingleTierTrip({
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [
          { tierId: null, price: 35000, cap: 15, booked: 0 }, // invalid
          { tierId: 'standard', price: 35000, cap: 15, booked: 0 }, // valid
        ],
      },
    ],
  });
  expect(resolveBooking(trip).departures[0].offers).toHaveLength(1);
});

test('offer with non-finite price is silently filtered', () => {
  const trip = makeSingleTierTrip({
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        offers: [
          { tierId: 'standard', price: 'not-a-number', cap: 15, booked: 0 },
        ],
      },
    ],
  });
  expect(resolveBooking(trip).departures[0].offers).toHaveLength(0);
});

test('fromPrice is null when no departures', () => {
  const trip = makeSingleTierTrip({ batches: [] });
  expect(resolveBooking(trip).fromPrice).toBeNull();
  expect(resolveBooking(trip).departures).toHaveLength(0);
});

// ── Legacy schema synthesis ───────────────────────────────────────────────────

describe('legacy schema — sharingOptions synthesis', () => {
  const trip = {
    status: 'booking-open',
    sharingOptions: [
      { id: 'triple', label: 'Triple Sharing', price: 29000 },
      { id: 'double', label: 'Double Sharing', price: 31000 },
    ],
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        totalSpots: 15,
        bookedSpots: 3,
      },
    ],
    paymentAmount: 10000,
  };

  test('catalog is derived from sharingOptions', () => {
    const b = resolveBooking(trip);
    expect(b.occupancyCatalog).toHaveLength(2);
    expect(b.occupancyCatalog[0].id).toBe('triple');
    expect(b.occupancyCatalog[1].id).toBe('double');
  });

  test('each sharing tier becomes an offer on the departure', () => {
    const dep = resolveBooking(trip).departures[0];
    expect(dep.offers).toHaveLength(2);
    expect(dep.offers[0].price).toBe(29000);
    expect(dep.offers[1].price).toBe(31000);
  });

  test('fromPrice is cheapest sharing option', () => {
    expect(resolveBooking(trip).fromPrice).toBe(29000);
  });
});

describe('legacy schema — flat price synthesis', () => {
  const trip = {
    status: 'booking-open',
    batches: [
      {
        id: 'dep-1',
        startDate: FAR_FUTURE,
        endDate: FAR_FUTURE_END,
        status: 'booking-open',
        price: 5000,
        totalSpots: 20,
        bookedSpots: 0,
      },
    ],
    paymentAmount: 1000,
  };

  test('catalog has single standard tier', () => {
    const b = resolveBooking(trip);
    expect(b.occupancyCatalog).toHaveLength(1);
    expect(b.occupancyCatalog[0].id).toBe('standard');
  });

  test('departure has one offer at the batch price', () => {
    const dep = resolveBooking(trip).departures[0];
    expect(dep.offers).toHaveLength(1);
    expect(dep.offers[0].price).toBe(5000);
  });

  test('status sold-out on batch still produces soldOut=true', () => {
    const soldOutTrip = {
      ...trip,
      batches: [{ ...trip.batches[0], status: 'sold-out' }],
    };
    expect(resolveBooking(soldOutTrip).departures[0].soldOut).toBe(true);
  });
});

// ── Derived financial values ──────────────────────────────────────────────────

describe('derived financial values', () => {
  test('missing paymentAmount falls back to DEFAULT_ADVANCE (3000)', () => {
    const trip = makeSingleTierTrip({ paymentAmount: undefined });
    expect(resolveBooking(trip).advanceAmount).toBe(3000);
  });

  test('missing balanceDueRule falls back to default string', () => {
    const trip = makeSingleTierTrip({ balanceDueRule: undefined });
    expect(resolveBooking(trip).balanceDueRule).toBe('15 days before trip');
  });

  test('explicit balanceDueRule is preserved', () => {
    const trip = makeSingleTierTrip({ balanceDueRule: '10 days before trip' });
    expect(resolveBooking(trip).balanceDueRule).toBe('10 days before trip');
  });

  test('spotsLeft is null when any offer has null cap', () => {
    const trip = makeMultiTierTrip({
      batches: [
        {
          id: 'dep-1',
          startDate: FAR_FUTURE,
          endDate: FAR_FUTURE_END,
          status: 'booking-open',
          offers: [
            { tierId: 'dorm', price: 5000, cap: null, booked: 0 },
            { tierId: 'private', price: 7000, cap: 3, booked: 0 },
          ],
        },
      ],
    });
    const dep = resolveBooking(trip).departures[0];
    expect(dep.spotsLeft).toBeNull();
    expect(dep.totalCap).toBeNull();
  });

  test('currency is always INR', () => {
    expect(resolveBooking(makeSingleTierTrip()).currency).toBe('INR');
  });
});

// ── Empty batches ─────────────────────────────────────────────────────────────

test('empty batches array → no departures, null fromPrice', () => {
  const b = resolveBooking({ status: 'booking-open', batches: [], paymentAmount: 5000 });
  expect(b.departures).toHaveLength(0);
  expect(b.fromPrice).toBeNull();
});

// ── coming-soon departures ───────────────────────────────────────────────────

describe('coming-soon departures', () => {
  test('a coming-soon-only trip resolves the departure but hides its price', () => {
    const trip = makeSingleTierTrip({
      batches: [{
        id: 'cs-1', startDate: FAR_FUTURE, endDate: FAR_FUTURE_END, status: 'coming-soon',
        offers: [{ tierId: 'standard', price: 35000, cap: 15, booked: 0 }],
      }],
    });
    const b = resolveBooking(trip);
    expect(b.departures).toHaveLength(1);
    expect(b.departures[0].comingSoon).toBe(true);
    expect(b.departures[0].soldOut).toBe(false);
    expect(b.fromPrice).toBeNull();
  });

  test('mixed trip: fromPrice reflects only the bookable departure', () => {
    const trip = makeSingleTierTrip({
      batches: [
        {
          id: 'open-1', startDate: FAR_FUTURE, endDate: FAR_FUTURE_END, status: 'booking-open',
          offers: [{ tierId: 'standard', price: 40000, cap: 15, booked: 0 }],
        },
        {
          id: 'cs-2', startDate: '2099-03-01', endDate: '2099-03-05', status: 'coming-soon',
          offers: [{ tierId: 'standard', price: 30000, cap: 15, booked: 0 }],
        },
      ],
    });
    const b = resolveBooking(trip);
    expect(b.fromPrice).toBe(40000); // the cheaper coming-soon 30000 is excluded
    expect(b.departures.find((d) => d.id === 'cs-2')!.comingSoon).toBe(true);
  });
});

describe('filling-fast departures', () => {
  test('remain bookable and expose the manual urgency flag', () => {
    const booking = resolveBooking(makeSingleTierTrip({
      batches: [{
        id: 'fast-1', startDate: FAR_FUTURE, endDate: FAR_FUTURE_END, status: 'filling_fast',
        offers: [{ tierId: 'standard', price: 35000, cap: 15, booked: 4 }],
      }],
    }));

    expect(booking.departures[0]).toMatchObject({
      id: 'fast-1', fillingFast: true, soldOut: false, comingSoon: false,
    });
    expect(booking.fromPrice).toBe(35000);
  });
});
