import { describe, expect, it } from 'vitest';
import { purgeUrlList, tripPaths, TRIP_LISTING_PATHS } from '../../src/lib/cachePurge';

describe('cache purge', () => {
  it('absolutizes against the canonical origin and de-duplicates', () => {
    const urls = purgeUrlList(['/', '/trips/', '/', 'https://www.seekthethrill.in/faq/', '']);

    expect(urls).toEqual([
      'https://www.seekthethrill.in/',
      'https://www.seekthethrill.in/trips/',
      'https://www.seekthethrill.in/faq/',
    ]);
  });

  it('purges both listings alongside the trip detail page', () => {
    // Confirming a booking changes the spots-left count on the listings, not
    // just on the trip page, so all three have to go.
    expect(tripPaths('ladakh-high-passes')).toEqual([
      ...TRIP_LISTING_PATHS,
      '/trips/ladakh-high-passes/',
    ]);
  });
});
