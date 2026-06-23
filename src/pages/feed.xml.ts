import type { APIRoute } from 'astro';
import { isTripListable, listTrips, contentLastmod } from '../lib/content';

const SITE = 'https://seekthethrill.in';
const escapeXml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export const GET: APIRoute = () => {
  const items = listTrips().filter(isTripListable).map((trip) => {
    const link = `${SITE}/trips/${encodeURIComponent(trip.slug)}/`;
    const updated = contentLastmod('trips', trip.slug) ?? new Date().toISOString().slice(0, 10);
    return `<entry><title>${escapeXml(trip.title || trip.name)}</title><id>${link}</id><link href="${link}"/><updated>${updated}T00:00:00Z</updated><summary>${escapeXml(trip.seoDescription || trip.shortDescription || trip.description)}</summary></entry>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Seek the Thrill — Upcoming Trips</title><id>${SITE}/</id><link href="${SITE}/feed.xml" rel="self"/><link href="${SITE}/"/><updated>${new Date().toISOString()}</updated>${items}</feed>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
