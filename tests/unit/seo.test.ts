import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { isTripArchived, isTripListable, isTripPublic, isTripViewable, listTrips, pastBatches, tripPublicationStatus } from '../../src/lib/trips';
import { isAlbumPublic } from '../../src/lib/albums';
import { indexNowUrls } from '../../src/lib/indexnow';

describe('SEO publication controls', () => {
  it('keeps admin surfaces out of search and AI indexes', () => {
    const robots = fs.readFileSync('public/robots.txt', 'utf8');
    const adminLayout = fs.readFileSync('src/layouts/AdminLayout.astro', 'utf8');
    const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
    expect(robots).toContain('Disallow: /admin/');
    expect(robots).toContain('Disallow: /api/');
    expect(adminLayout).toContain('noindex, nofollow');
    expect(middleware).toContain("headers.set('X-Robots-Tag', 'noindex, nofollow')");
    expect(robots).toContain('User-agent: OAI-SearchBot');
    expect(robots).toContain('User-agent: Claude-SearchBot');
    expect(robots.indexOf('User-agent: GPTBot')).toBeGreaterThan(robots.indexOf('# Model-training crawlers'));
  });

  it('supports webmaster verification without hard-coding account tokens', () => {
    const layout = fs.readFileSync('src/layouts/BaseLayout.astro', 'utf8');
    const settings = fs.readFileSync('src/pages/admin/settings.astro', 'utf8');
    expect(layout).toContain('name="google-site-verification"');
    expect(layout).toContain('name="msvalidate.01"');
    expect(settings).toContain('name="googleSiteVerification"');
    expect(settings).toContain('name="bingSiteVerification"');
  });

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

  it('gives past trips an internal link path and a low-priority sitemap entry', () => {
    const sitemap = fs.readFileSync('src/pages/sitemap.xml.ts', 'utf8');
    const tripsIndex = fs.readFileSync('src/pages/trips/index.astro', 'utf8');
    const footer = fs.readFileSync('src/components/Footer.astro', 'utf8');
    expect(sitemap).toContain('isTripArchived');
    expect(sitemap).toContain("url('/trips/past/'");
    expect(tripsIndex).toContain('href="/trips/past/"');
    expect(footer).toContain('href="/trips/past/"');
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

  it('keeps the photo vault out of public discovery while preserving direct routes', () => {
    const header = fs.readFileSync('src/components/Header.astro', 'utf8');
    const footer = fs.readFileSync('src/components/Footer.astro', 'utf8');
    const sitemap = fs.readFileSync('src/pages/sitemap.xml.ts', 'utf8');
    // llms.txt is a generated route now, so the guard is that its source never
    // reaches for album or vault content — not that a static file omits it.
    const llms = fs.readFileSync('src/pages/llms.txt.ts', 'utf8');
    const vaultIndex = fs.readFileSync('src/pages/photo-vault/index.astro', 'utf8');
    const vaultAlbum = fs.readFileSync('src/pages/photo-vault/[slug].astro', 'utf8');

    expect(header).not.toContain("href: '/photo-vault/'");
    expect(footer).not.toContain('href="/photo-vault/"');
    expect(sitemap).not.toContain("url('/photo-vault/");
    expect(sitemap).not.toContain('`/photo-vault/${');
    expect(llms).not.toContain('/photo-vault/');
    expect(llms).not.toContain('listAlbums');
    expect(vaultIndex).toContain('robots="noindex, follow"');
    expect(vaultAlbum).toContain('robots="noindex, follow"');
  });

  it('generates llms.txt from live content on the canonical origin', () => {
    const llms = fs.readFileSync('src/pages/llms.txt.ts', 'utf8');
    // Same gating helpers as the sitemap, so the two cannot disagree about
    // what is public; drafts and QA fixtures are excluded by construction.
    expect(llms).toContain('isTripListable');
    expect(llms).toContain('isTripArchived');
    // The static file it replaced linked the apex, costing a 308 on every link.
    expect(llms).toContain('SITE_ORIGIN');
    expect(llms).not.toContain('https://seekthethrill.in');
    expect(fs.existsSync('public/llms.txt')).toBe(false);
  });

  it('canonicalizes host, protocol, case, and trailing slash in one hop', () => {
    const middleware = fs.readFileSync('src/middleware.ts', 'utf8');
    // Only GET/HEAD navigations get the path-shape redirect (never form posts).
    expect(middleware).toContain("request.method === 'GET' || request.method === 'HEAD'");
    expect(middleware).toContain('toLowerCase()');
    // Single redirect emitted only when the normalized target actually differs
    // from the browser-facing URL (built from x-forwarded-* behind the proxy).
    expect(middleware).toContain('x-forwarded-host');
    expect(middleware).toContain('if (target.href !== publicHref) return redirect(target.toString(), 308)');
  });

  it('emits valid absolute JSON-LD on trip pages', () => {
    const tripPage = fs.readFileSync('src/pages/trips/[slug].astro', 'utf8');
    expect(tripPage).toContain('const heroImgAbs =');
    expect(tripPage).toContain('image: [heroImgAbs]');
    // The dead soldOut ? EventScheduled : EventScheduled ternary must be gone.
    expect(tripPage).not.toContain("departure.soldOut ? 'https://schema.org/EventScheduled'");
  });

  it('describes the itinerary as a TouristTrip built from rendered days', () => {
    const tripPage = fs.readFileSync('src/pages/trips/[slug].astro', 'utf8');
    expect(tripPage).toContain("'@type': 'TouristTrip'");
    // The ItemList must come from the same normalized array DayAccordion
    // renders — schema for content that is not on the page is a violation.
    expect(tripPage).toContain('itemListElement: itinerary.map(');
    expect(tripPage).toContain('<DayAccordion itinerary={itinerary}');
    // Departures are referenced by @id, never restated with their own dates.
    expect(tripPage).toContain('subjectOf: eventSchemas.map(');
  });

  it('builds absolute, de-duplicated IndexNow URL lists', () => {
    expect(indexNowUrls(['/trips/ladakh-high-passes/'])).toEqual(['https://www.seekthethrill.in/trips/ladakh-high-passes/']);
    expect(indexNowUrls(['/trips/a/', '/trips/a/'])).toEqual(['https://www.seekthethrill.in/trips/a/']);
    expect(indexNowUrls(['https://www.seekthethrill.in/trips/a/', ''])).toEqual(['https://www.seekthethrill.in/trips/a/']);
  });
});
