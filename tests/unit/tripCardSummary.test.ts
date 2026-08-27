import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { tripCardSummary } from '../../src/lib/content';

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
});
afterAll(() => vi.useRealTimers());

const FAR = '2099-01-01';
const FAR_END = '2099-01-05';

function makeTrip(batches: any[], extra: Record<string, any> = {}) {
  return {
    status: 'booking-open',
    occupancyCatalog: [
      { id: 'dorm', label: 'Dorm', helperText: '' },
      { id: 'private', label: 'Private', helperText: '' },
    ],
    batches,
    paymentAmount: 1000,
    ...extra,
  };
}

test('multiPrice is true when multiple distinct prices exist', () => {
  const trip = makeTrip([
    {
      id: 'dep-1',
      startDate: FAR,
      endDate: FAR_END,
      status: 'booking-open',
      offers: [
        { tierId: 'dorm', price: 5000, cap: 10, booked: 0 },
        { tierId: 'private', price: 7000, cap: 3, booked: 0 },
      ],
    },
  ]);
  expect(tripCardSummary(trip).multiPrice).toBe(true);
});

test('multiPrice is false for single-tier trips', () => {
  const trip = {
    status: 'booking-open',
    occupancyCatalog: [{ id: 'standard', label: 'Standard', helperText: '' }],
    batches: [
      {
        id: 'dep-1',
        startDate: FAR,
        endDate: FAR_END,
        status: 'booking-open',
        offers: [{ tierId: 'standard', price: 35000, cap: 15, booked: 0 }],
      },
    ],
    paymentAmount: 10000,
  };
  expect(tripCardSummary(trip).multiPrice).toBe(false);
});

test('fromPrice equals cheapest available price', () => {
  const trip = makeTrip([
    {
      id: 'dep-1',
      startDate: FAR,
      endDate: FAR_END,
      status: 'booking-open',
      offers: [
        { tierId: 'dorm', price: 5000, cap: 10, booked: 0 },
        { tierId: 'private', price: 7000, cap: 3, booked: 0 },
      ],
    },
  ]);
  expect(tripCardSummary(trip).fromPrice).toBe(5000);
});

test('discounted lead price exposes its slashed base price and expiry', () => {
  const endsAt = '2026-07-02T00:00:00.000Z';
  const trip = makeTrip([{
    id: 'dep-sale', startDate: FAR, endDate: FAR_END, status: 'booking-open',
    discountAmount: 1000, discountEndsAt: endsAt,
    offers: [
      { tierId: 'dorm', price: 5000, cap: 10, booked: 0 },
      { tierId: 'private', price: 7000, cap: 3, booked: 0 },
    ],
  }]);
  expect(tripCardSummary(trip)).toMatchObject({
    fromPrice: 4000,
    originalFromPrice: 5000,
    discountEndsAt: endsAt,
  });
});

test('fromPrice is null when no departures', () => {
  const trip = makeTrip([]);
  expect(tripCardSummary(trip).fromPrice).toBeNull();
});

test('spotsLeft from soonest non-sold-out departure', () => {
  const trip = makeTrip([
    {
      id: 'dep-1',
      startDate: FAR,
      endDate: FAR_END,
      status: 'booking-open',
      offers: [{ tierId: 'dorm', price: 5000, cap: 10, booked: 7 }],
    },
  ]);
  expect(tripCardSummary(trip).spotsLeft).toBe(3);
});

test('spotsLeft is null when cap is null (unmetered)', () => {
  const trip = makeTrip([
    {
      id: 'dep-1',
      startDate: FAR,
      endDate: FAR_END,
      status: 'booking-open',
      offers: [{ tierId: 'dorm', price: 5000, cap: null, booked: 0 }],
    },
  ]);
  expect(tripCardSummary(trip).spotsLeft).toBeNull();
});

describe('soldOut detection', () => {
  test('trip-level status is ignored — soldOut derives only from departures', () => {
    // Trip-level status was removed; a stray top-level status must NOT override
    // an open departure with available spots.
    const trip = makeTrip(
      [
        {
          id: 'dep-1',
          startDate: FAR,
          endDate: FAR_END,
          status: 'booking-open',
          offers: [{ tierId: 'dorm', price: 5000, cap: 10, booked: 0 }],
        },
      ],
      { status: 'sold-out' },
    );
    expect(tripCardSummary(trip).soldOut).toBe(false);
  });

  test('all departures sold out → soldOut = true', () => {
    const trip = makeTrip([
      {
        id: 'dep-1',
        startDate: FAR,
        endDate: FAR_END,
        status: 'booking-open',
        offers: [{ tierId: 'dorm', price: 5000, cap: 5, booked: 5 }],
      },
    ]);
    expect(tripCardSummary(trip).soldOut).toBe(true);
  });

  test('at least one available departure → soldOut = false', () => {
    const trip = makeTrip([
      {
        id: 'dep-1',
        startDate: FAR,
        endDate: FAR_END,
        status: 'booking-open',
        offers: [{ tierId: 'dorm', price: 5000, cap: 10, booked: 3 }],
      },
    ]);
    expect(tripCardSummary(trip).soldOut).toBe(false);
  });
});

describe('coming-soon flags', () => {
  test('all-coming-soon trip: no price, allComingSoon true, not sold out', () => {
    const trip = makeTrip([
      { id: 'cs-1', startDate: FAR, endDate: FAR_END, status: 'coming-soon',
        offers: [{ tierId: 'dorm', price: 5000, cap: 10, booked: 0 }] },
    ]);
    const s = tripCardSummary(trip);
    expect(s.fromPrice).toBeNull();
    expect(s.allComingSoon).toBe(true);
    expect(s.hasComingSoon).toBe(true);
    expect(s.soldOut).toBe(false);
  });

  test('mixed trip: price from the bookable date, hasComingSoon true, allComingSoon false', () => {
    const trip = makeTrip([
      { id: 'open-1', startDate: FAR, endDate: FAR_END, status: 'booking-open',
        offers: [{ tierId: 'dorm', price: 8000, cap: 10, booked: 0 }] },
      { id: 'cs-2', startDate: '2099-03-01', endDate: '2099-03-05', status: 'coming-soon',
        offers: [{ tierId: 'dorm', price: 4000, cap: 10, booked: 0 }] },
    ]);
    const s = tripCardSummary(trip);
    expect(s.fromPrice).toBe(8000);
    expect(s.hasComingSoon).toBe(true);
    expect(s.allComingSoon).toBe(false);
  });

  test('sold-out bookable date + a coming-soon date → not marked soldOut', () => {
    const trip = makeTrip([
      { id: 'open-1', startDate: FAR, endDate: FAR_END, status: 'booking-open',
        offers: [{ tierId: 'dorm', price: 5000, cap: 5, booked: 5 }] },
      { id: 'cs-2', startDate: '2099-03-01', endDate: '2099-03-05', status: 'coming-soon',
        offers: [{ tierId: 'dorm', price: 6000, cap: 10, booked: 0 }] },
    ]);
    expect(tripCardSummary(trip).soldOut).toBe(false);
  });
});
