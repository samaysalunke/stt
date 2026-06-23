import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { isTripListable, isTripPublic, listTrips, tripPublicationStatus } from '../../src/lib/trips';
import { isAlbumPublic } from '../../src/lib/albums';

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
});
