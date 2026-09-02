import type { APIRoute } from 'astro';
import { isTripListable, listTrips, contentLastmod, tripName } from '../lib/content';
import { generateTripSeo, markdownToPlainText } from '../lib/tripSeo';
import { SITE_ORIGIN } from '../lib/siteUrl';

const SITE = SITE_ORIGIN;
const escapeXml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&apos;');

export const GET: APIRoute = () => {
  const items = listTrips().filter(isTripListable).map((trip) => {
    const link = `${SITE}/trips/${encodeURIComponent(trip.slug)}/`;
    const updated = contentLastmod('trips', trip.slug) ?? new Date().toISOString().slice(0, 10);
    // Same chain as the trip page (trips/[slug].astro): authored copy first,
    // then the generated fallback, both through markdownToPlainText. Building
    // the summary independently here shipped raw markdown into the feed, and
    // emitted an empty <summary> for a trip missing all three source fields —
    // generateTripSeo always returns a description, so neither can recur.
    const generated = generateTripSeo(trip);
    const summary = markdownToPlainText(trip.seoDescription || generated.seoDescription);
    return `<entry><title>${escapeXml(tripName(trip))}</title><id>${link}</id><link href="${link}"/><updated>${updated}T00:00:00Z</updated><summary>${escapeXml(summary)}</summary></entry>`;
  }).join('');
  const xml = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Seek the Thrill — Upcoming Trips</title><id>${SITE}/</id><link href="${SITE}/feed.xml" rel="self"/><link href="${SITE}/"/><updated>${new Date().toISOString()}</updated>${items}</feed>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/atom+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
};
