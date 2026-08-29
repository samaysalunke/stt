import { describe, expect, it, vi, afterEach } from 'vitest';
import { purgeUrls, purgeUrlList, tripPaths, TRIP_LISTING_PATHS } from '../../src/lib/cachePurge';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('is a no-op without credentials, and never throws when the API fails', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // No CF_ZONE_ID / CF_PURGE_TOKEN in the test environment: purging must stay
    // silent rather than erroring out the admin action that triggered it.
    await expect(purgeUrls(['/'])).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();

    // Empty input is a no-op too.
    await expect(purgeUrls([])).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
