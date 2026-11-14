import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
import { itineraryGate, normalizeItinerary, ITINERARY_PREVIEW_DAYS } from '../../src/lib/itineraryGate';

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
});
afterAll(() => vi.useRealTimers());

const offers = [{ tierId: 'standard', price: 10000, cap: 10, booked: 0 }];
const days = (n: number) => Array.from({ length: n }, (_, i) => ({ day: i + 1, title: `Day ${i + 1}`, description: 'x' }));
const dep = (id: string, over: Record<string, any> = {}) => ({
  id, startDate: '2099-01-01', endDate: '2099-01-05', status: 'booking-open', offers, ...over,
});
const trip = (batches: any[], itinerary = days(4)) => ({
  occupancyCatalog: [{ id: 'standard', label: 'Standard', helperText: '' }],
  batches,
  itinerary,
});

describe('itineraryGate', () => {
  test('open when no departure asks for it', () => {
    expect(itineraryGate(trip([dep('a'), dep('b')])).locked).toBe(false);
  });

  test('locked when a bookable departure asks for it, pointing the CTA at it', () => {
    const gate = itineraryGate(trip([dep('a'), dep('b', { startDate: '2099-02-01', itineraryGated: true })]));
    expect(gate).toEqual({ locked: true, previewDays: ITINERARY_PREVIEW_DAYS, unlockMode: 'book', unlockBatchId: 'b' });
  });

  test('one itinerary per trip: an ungated date does not reopen it', () => {
    expect(itineraryGate(trip([dep('open'), dep('gated', { itineraryGated: true })])).locked).toBe(true);
  });

  test('only a literal true counts', () => {
    expect(itineraryGate(trip([dep('a', { itineraryGated: 'true' })])).locked).toBe(false);
  });

  test('a gated date in the past, or in draft, no longer locks', () => {
    expect(itineraryGate(trip([dep('old', { startDate: '2020-01-01', endDate: '2020-01-05', itineraryGated: true })])).locked).toBe(false);
    expect(itineraryGate(trip([dep('wip', { status: 'draft', itineraryGated: true }), dep('live')])).locked).toBe(false);
  });

  test('a sold-out gated date still locks while another date can be booked', () => {
    const gate = itineraryGate(trip([dep('full', { status: 'sold-out', itineraryGated: true }), dep('open', { startDate: '2099-03-01' })]));
    expect(gate).toMatchObject({ locked: true, unlockMode: 'book', unlockBatchId: 'open' });
  });

  test('no dead end: open when every upcoming date is sold out', () => {
    expect(itineraryGate(trip([dep('full', { status: 'sold-out', itineraryGated: true })])).locked).toBe(false);
  });

  test('coming-soon only: unlocked by joining the wishlist', () => {
    const gate = itineraryGate(trip([dep('soon', { status: 'coming-soon', itineraryGated: true })]));
    expect(gate).toMatchObject({ locked: true, unlockMode: 'wishlist', unlockBatchId: 'soon' });
  });

  test('a bookable date beats a coming-soon one for the CTA', () => {
    const gate = itineraryGate(trip([
      dep('soon', { status: 'coming-soon', itineraryGated: true }),
      dep('open', { startDate: '2099-04-01' }),
    ]));
    expect(gate).toMatchObject({ unlockMode: 'book', unlockBatchId: 'open' });
  });

  test('no itinerary, nothing to lock', () => {
    expect(itineraryGate(trip([dep('a', { itineraryGated: true })], [])).locked).toBe(false);
  });

  test('a one-day plan previews nothing rather than everything', () => {
    expect(itineraryGate(trip([dep('a', { itineraryGated: true })], days(1)))).toMatchObject({ locked: true, previewDays: 0 });
  });
});

describe('normalizeItinerary', () => {
  test('maps the legacy schema to the current one', () => {
    const [day] = normalizeItinerary({
      itinerary: [{ dayNumber: 2, dayTitle: 'Old', activities: 'Walk', accommodation: 'Camp', breakfast: true, dinner: true, specialNotes: 'n' }],
    });
    expect(day).toMatchObject({ day: 2, title: 'Old', description: 'Walk', stay: 'Camp', meals: ['B', 'D'], note: 'n', photos: [] });
  });
});
