import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { isTripArchived, isTripListable, isTripPublic, listTrips, pastBatches, tripPublicationStatus } from '../../src/lib/trips';
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
    const llms = fs.readFileSync('public/llms.txt', 'utf8');
    const vaultIndex = fs.readFileSync('src/pages/photo-vault/index.astro', 'utf8');
    const vaultAlbum = fs.readFileSync('src/pages/photo-vault/[slug].astro', 'utf8');

    expect(header).not.toContain("href: '/photo-vault/'");
    expect(footer).not.toContain('href="/photo-vault/"');
    expect(sitemap).not.toContain("url('/photo-vault/");
    expect(sitemap).not.toContain('`/photo-vault/${');
    expect(llms).not.toContain('/photo-vault/');
    expect(vaultIndex).toContain('robots="noindex, follow"');
    expect(vaultAlbum).toContain('robots="noindex, follow"');
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

  it('builds absolute, de-duplicated IndexNow URL lists', () => {
    expect(indexNowUrls(['/trips/ladakh-high-passes/'])).toEqual(['https://www.seekthethrill.in/trips/ladakh-high-passes/']);
    expect(indexNowUrls(['/trips/a/', '/trips/a/'])).toEqual(['https://www.seekthethrill.in/trips/a/']);
    expect(indexNowUrls(['https://www.seekthethrill.in/trips/a/', ''])).toEqual(['https://www.seekthethrill.in/trips/a/']);
  });
});
