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

// ── Derived financial values ──────────────────────────────────────────────────

describe('derived financial values', () => {
  test('missing paymentAmount falls back to DEFAULT_ADVANCE (3000)', () => {
    const trip = makeSingleTierTrip({ paymentAmount: undefined });
    expect(resolveBooking(trip).advanceAmount).toBe(3000);
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
