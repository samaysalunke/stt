import type { APIRoute } from 'astro';
import { listTrips, listAlbums, isTripListable, isAlbumPublic, contentLastmod } from '../lib/content';
import { SITE_ORIGIN } from '../lib/siteUrl';

const SITE = SITE_ORIGIN;
const escapeXml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

function url(path: string, priority: string, changefreq: string, lastmod?: string): string {
  return `
  <url>
    <loc>${escapeXml(`${SITE}${path}`)}</loc>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}
  </url>`;
}

export const GET: APIRoute = () => {
  // Live trips only: at least one upcoming, non-draft departure (trip-level status
  // was removed — tripHasUpcomingDates already excludes draft/past departures).
  // Reads via listTrips() so production reflects the volume (CONTENT_DIR), not seed data.
  const tripPages = listTrips()
    .filter(isTripListable)
    .map((t) => url(`/trips/${encodeURIComponent(t.slug)}/`, '0.8', 'weekly', contentLastmod('trips', t.slug)));

  // Published albums only.
  const albumPages = listAlbums()
    .filter(isAlbumPublic)
    .map((a) => url(`/photo-vault/${encodeURIComponent(a.slug)}/`, '0.5', 'monthly', contentLastmod('albums', a.slug)));

  const staticPages = [
    url('/', '1.0', 'weekly'),
    url('/trips/', '0.9', 'daily'),
    url('/about/', '0.6', 'monthly'),
    url('/contact/', '0.6', 'monthly'),
    url('/faq/', '0.6', 'monthly'),
    url('/custom-itineraries/', '0.6', 'monthly'),
    url('/photo-vault/', '0.5', 'monthly'),
    url('/privacy/', '0.3', 'yearly'),
    url('/terms/', '0.3', 'yearly'),
    url('/cancellation/', '0.3', 'yearly'),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...staticPages, ...tripPages, ...albumPages].join('')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
