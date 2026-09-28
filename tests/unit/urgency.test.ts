import { describe, test, expect } from 'vitest';
import { liveSpotsLeft, lowStockSpots, spotsLeftLabel, womenBookedLabel } from '../../src/lib/urgency';
import { tallyConfirmed, departureKey } from '../../src/lib/departureCounts';

describe('liveSpotsLeft', () => {
  test('cap minus confirmed', () => expect(liveSpotsLeft(15, 12)).toBe(3));
  test('null when there is no cap', () => {
    expect(liveSpotsLeft(null, 3)).toBeNull();
    expect(liveSpotsLeft(0, 0)).toBeNull();
  });
  test('floors at 0 when overbooked', () => expect(liveSpotsLeft(10, 12)).toBe(0));
});

describe('lowStockSpots', () => {
  const open = (n: number | null) => ({ liveSpotsLeft: n, soldOut: false });
  test.each([1, 2, 3, 4])('shows %i', (n) => expect(lowStockSpots(open(n))).toBe(n));
  test.each([null, 0, 5, 6, 15])('hides %s', (n) => expect(lowStockSpots(open(n))).toBeNull());
  test('hides on sold-out and coming-soon departures', () => {
    expect(lowStockSpots({ liveSpotsLeft: 2, soldOut: true })).toBeNull();
    expect(lowStockSpots({ liveSpotsLeft: 2, soldOut: false, comingSoon: true })).toBeNull();
  });
});

test('spotsLeftLabel is singular for one spot', () => {
  expect(spotsLeftLabel(1)).toBe('Only 1 spot left');
  expect(spotsLeftLabel(3)).toBe('Only 3 spots left');
});

test('womenBookedLabel hides below 2', () => {
  expect(womenBookedLabel(null)).toBeNull();
  expect(womenBookedLabel(0)).toBeNull();
  expect(womenBookedLabel(1)).toBeNull();
  expect(womenBookedLabel(2)).toBe('2 women already booked');
});

test('tallyConfirmed counts per trip+departure and buckets gender like the admin matrix', () => {
  const counts = tallyConfirmed([
    { trip_slug: 'a', batch_id: 'b1', gender: 'female' },
    { trip_slug: 'a', batch_id: 'b1', gender: 'F' },
    { trip_slug: 'a', batch_id: 'b1', gender: 'male' },
    { trip_slug: 'a', batch_id: 'b1', gender: null },
    { trip_slug: 'z', batch_id: 'b1', gender: 'female' },
  ]);
  expect(counts.get(departureKey('a', 'b1'))).toEqual({ confirmed: 4, women: 2 });
  expect(counts.get(departureKey('z', 'b1'))).toEqual({ confirmed: 1, women: 1 });
});
