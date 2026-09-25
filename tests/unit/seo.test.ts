import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { isTripArchived, isTripListable, isTripPublic, isTripViewable, listTrips, pastBatches, tripPublicationStatus } from '../../src/lib/trips';
import { isAlbumPublic } from '../../src/lib/albums';

describe('SEO publication controls', () => {

  it('never exposes test or draft trips', () => {
    const future = [{ startDate: '2099-01-01', status: 'booking-open' }];
    expect(isTripListable({ slug: 'qa-test-leak', publicationStatus: 'test', batches: future })).toBe(false);
    expect(isTripPublic({ publicationStatus: 'draft' })).toBe(false);
    expect(tripPublicationStatus({ slug: 'qa-test-legacy' })).toBe('test');
    expect(listTrips().filter(isTripListable).some((trip) => String(trip.slug).startsWith('qa-test-'))).toBe(false);
  });

  it('lists only published trips with a live departure', () => {
    expect(isTripListable({ publicationStatus: 'published', batches: [{ startDate: '2099-01-01', status: 'booking-open' }] })).toBe(true);
    expect(isTripListable({ publicationStatus: 'archived', batches: [{ startDate: '2099-01-01', status: 'booking-open' }] })).toBe(false);
    expect(isTripListable({ publicationStatus: 'published', batches: [{ startDate: '2000-01-01', status: 'completed' }] })).toBe(false);
  });

  it('never advertises a URL whose detail page would 404', () => {
    // Regression: the archive shipped built on isTripPublic alone, which put two
    // duplicate-in-progress trips into the sitemap and /trips/past/ whose pages
    // returned 404. The admin duplicate action marks every departure `draft`
    // (src/pages/api/admin/trips/duplicate.ts) precisely so the copy stays
    // hidden until reviewed — so a draft-only trip is viewable nowhere.
    const draftOnly = { publicationStatus: 'published', batches: [{ startDate: '2099-01-01', status: 'draft' }] };
    expect(isTripViewable(draftOnly)).toBe(false);
    expect(isTripArchived(draftOnly)).toBe(false);
    expect(isTripListable(draftOnly)).toBe(false);

    // One non-draft departure is enough, past or upcoming.
    expect(isTripViewable({ publicationStatus: 'published', batches: [{ startDate: '2000-01-01', status: 'completed' }, { startDate: '2099-01-01', status: 'draft' }] })).toBe(true);
    // Legacy trips predating the batches array stay viewable.
    expect(isTripViewable({ publicationStatus: 'published' })).toBe(true);
    // Still gated on publication status.
    expect(isTripViewable({ publicationStatus: 'draft', batches: [{ startDate: '2000-01-01', status: 'completed' }] })).toBe(false);

    // The detail page must ask the shared helper, not re-derive the rule.
    const tripPage = fs.readFileSync('src/pages/trips/[slug].astro', 'utf8');
    expect(tripPage).toContain('isTripViewable({ slug, ...trip })');
    expect(tripPage).not.toContain('_isPublished');
  });

  it('treats public-but-unlistable trips as the archive, and nothing else', () => {
    const past = [{ startDate: '2000-01-01', status: 'completed' }];
    const future = [{ startDate: '2099-01-01', status: 'booking-open' }];
    // Explicitly archived, and published-with-every-date-behind-us, both qualify.
    expect(isTripArchived({ publicationStatus: 'archived', batches: past })).toBe(true);
    expect(isTripArchived({ publicationStatus: 'published', batches: past })).toBe(true);
    // A live trip belongs in the listing, not the archive — never both.
    expect(isTripArchived({ publicationStatus: 'published', batches: future })).toBe(false);
    // Drafts and QA fixtures stay invisible on this surface too.
    expect(isTripArchived({ publicationStatus: 'draft', batches: past })).toBe(false);
    expect(isTripArchived({ slug: 'qa-test-leak', batches: past })).toBe(false);
    expect(listTrips().filter(isTripArchived).some((t) => String(t.slug).startsWith('qa-test-'))).toBe(false);
  });

  it('reads past departures without leaking drafts or future dates', () => {
    const trip = {
      batches: [
        { startDate: '2099-01-01', status: 'booking-open' },
        { startDate: '2000-01-01', status: 'draft' },
        { startDate: '2000-06-01', status: 'completed' },
        { startDate: '2000-03-01', status: 'booking-open' },
      ],
    };
    // Newest first, drafts and upcoming dates excluded.
    expect(pastBatches(trip).map((b) => b.startDate)).toEqual(['2000-06-01', '2000-03-01']);
  });

  it('allows only published or archived albums', () => {
    expect(isAlbumPublic({ publicationStatus: 'published' })).toBe(true);
    expect(isAlbumPublic({ publicationStatus: 'archived' })).toBe(true);
    expect(isAlbumPublic({ publicationStatus: 'test', published: true })).toBe(false);
  });

});
