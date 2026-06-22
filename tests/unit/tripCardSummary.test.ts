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
