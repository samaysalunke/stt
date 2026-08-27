import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { isTripListable, isTripPublic, listTrips, tripPublicationStatus } from '../../src/lib/trips';
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
