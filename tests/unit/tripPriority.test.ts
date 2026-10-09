import { describe, expect, it } from 'vitest';
import { contentSeededRandom, sortTripsByPriority, tripPriority } from '../../src/lib/trips';

describe('trip priority', () => {
  it('normalizes absent and invalid values to medium', () => {
    expect(tripPriority(undefined)).toBe('medium');
    expect(tripPriority('urgent')).toBe('medium');
    expect(tripPriority('HIGH')).toBe('high');
  });

  it('orders high before medium before low without mutating the input', () => {
    const trips = [
      { slug: 'low', priority: 'low' },
      { slug: 'missing' },
      { slug: 'high', priority: 'high' },
      { slug: 'invalid', priority: 'urgent' },
      { slug: 'medium', priority: 'medium' },
    ];
    const original = [...trips];
    const sorted = sortTripsByPriority(trips, () => 0.999);

    expect(sorted.map((trip) => trip.slug)).toEqual(['high', 'missing', 'invalid', 'medium', 'low']);
    expect(trips).toEqual(original);
  });

  it('uses Fisher-Yates within a bucket and retains the same members', () => {
    const trips = ['alpha', 'bravo', 'charlie'].map((slug) => ({ slug, priority: 'medium' }));
    const unchanged = sortTripsByPriority(trips, () => 0.999).map((trip) => trip.slug);
    const reversed = sortTripsByPriority(trips, () => 0).map((trip) => trip.slug);

    expect(new Set(reversed)).toEqual(new Set(unchanged));
    expect(reversed).not.toEqual(unchanged);
  });

  it('produces the same order for the same content version, and a new one after a bump', () => {
    const trips = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((slug) => ({ slug, priority: 'medium' }));
    const order = () => sortTripsByPriority(trips, contentSeededRandom(7)).map((trip) => trip.slug);

    // Stable within a content version: every edge PoP and every revalidation
    // renders the same order instead of reshuffling.
    expect(order()).toEqual(order());
    expect(order()).toEqual(order());

    // A content edit bumps the version, which rotates the order.
    const afterBump = sortTripsByPriority(trips, contentSeededRandom(8)).map((trip) => trip.slug);
    expect(new Set(afterBump)).toEqual(new Set(order()));
    expect(afterBump).not.toEqual(order());
  });

  it('can be applied after visibility filtering', () => {
    const trips = [
      { slug: 'hidden-high', priority: 'high', visible: false },
      { slug: 'visible-low', priority: 'low', visible: true },
      { slug: 'visible-medium', visible: true },
    ];
    const sorted = sortTripsByPriority(trips.filter((trip) => trip.visible), () => 0.999);
    expect(sorted.map((trip) => trip.slug)).toEqual(['visible-medium', 'visible-low']);
  });

  it('sinks a trip whose every departure is sold out below all bookable trips', () => {
    const departure = (id: string, status: string) => ({
      id, startDate: '2099-01-10', endDate: '2099-01-15', status,
      offers: [{ tierId: 'standard', price: 20000, cap: 10, booked: 0 }],
    });
    const trip = (slug: string, priority: string, statuses: string[]) => ({
      slug, priority,
      pricingTiers: [{ id: 'standard', name: 'Standard' }],
      batches: statuses.map((s, i) => departure(`${slug}-${i}`, s)),
    });
    const trips = [
      trip('low-open', 'low', ['booking-open']),
      trip('high-full', 'high', ['sold-out']),
      trip('medium-full', 'medium', ['sold-out', 'sold-out']),
      // One full departure is not enough — another is still bookable.
      trip('high-one-left', 'high', ['sold-out', 'booking-open']),
    ];
    const sorted = sortTripsByPriority(trips, () => 0.999);
    expect(sorted.map((t) => t.slug)).toEqual(['high-one-left', 'low-open', 'high-full', 'medium-full']);
  });
});
