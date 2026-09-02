import type { APIRoute } from 'astro';
import {
  listTrips,
  isTripListable,
  isTripArchived,
  readSiteSettings,
  tripCardSummary,
  tripName,
  pastBatches,
} from '../lib/content';
import { formatDepartureRange } from '../lib/departureSummary';
import { GROUP_SIZE, REFUND_WINDOWS } from '../lib/policyFacts';
import { generateTripSeo, markdownToPlainText } from '../lib/tripSeo';
import { SITE_ORIGIN } from '../lib/siteUrl';

/**
 * llms.txt, generated from the same content the site renders.
 *
 * It was previously a seventeen-line static file in `public/` listing eight
 * pages and naming no trip, price, date, group size, or policy — everything a
 * model would actually need to answer a question. Being static, it could not
 * have carried them: a hand-maintained inventory of a weekly-changing catalogue
 * goes stale immediately, and a confidently stale price is worse than none.
 *
 * Modelled on sitemap.xml.ts: same APIRoute shape, same listTrips() source, same
 * gating helpers, so it cannot disagree with the sitemap about what is public.
 * All URLs use SITE_ORIGIN (www) — the old file linked the apex, and every one
 * of those links cost a 308 hop.
 */

const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

function tripLine(trip: Record<string, any>): string {
  const name = tripName(trip);
  const url = `${SITE_ORIGIN}/trips/${encodeURIComponent(trip.slug)}/`;
  const summary = markdownToPlainText(trip.seoDescription || generateTripSeo(trip).seoDescription);
  const card = tripCardSummary(trip);

  const lines = [`### ${name}`, url];
  const facts = [trip.location, trip.duration].filter(Boolean).map(String);
  if (facts.length > 0) lines.push(facts.join(' · '));
  if (summary) lines.push(summary);

  // Coming-soon departures deliberately carry no price: the trip page conceals
  // it until the date opens, and this file must not reveal what that page hides.
  const departures = card.departures.map((departure) => {
    const range = formatDepartureRange(departure.startDate, departure.endDate);
    const year = String(departure.startDate).slice(0, 4);
    const dated = /\d{4}/.test(range) ? range : `${range}, ${year}`;
    if (departure.comingSoon) return `- ${dated} — dates announced, booking not yet open`;
    if (departure.soldOut) return `- ${dated} — sold out`;
    const cheapest = departure.offers.filter((o) => o.available).sort((a, b) => a.price - b.price)[0]
      ?? departure.offers.slice().sort((a, b) => a.price - b.price)[0];
    const price = cheapest ? ` — from ${money(cheapest.price)} per person` : '';
    const spots = departure.spotsLeft != null ? ` (${departure.spotsLeft} spots left)` : '';
    return `- ${dated}${price}${spots}`;
  });
  if (departures.length > 0) lines.push('Departures:', ...departures);

  const included = (Array.isArray(trip.included) ? trip.included : []).map(String).filter(Boolean);
  if (included.length > 0) lines.push(`Price includes: ${included.join('; ')}.`);

  return lines.join('\n');
}

export const GET: APIRoute = () => {
  const settings = readSiteSettings();
  const allTrips = listTrips();
  const live = allTrips.filter(isTripListable);
  const archived = allTrips.filter(isTripArchived);

  const refundPolicy = (settings.cancellationPolicy ?? '').trim()
    ? markdownToPlainText(settings.cancellationPolicy)
    : REFUND_WINDOWS.map((w) => `${w.period} before departure: ${w.refund.toLowerCase()} (${w.detail.toLowerCase()}).`).join(' ');

  const sections: string[] = [
    '# Seek the Thrill',
    '',
    'Seek the Thrill is an India-based travel company founded by Zahra Shakir. It organizes small-group trips on offbeat routes across India. Group size is typically ' +
      `${GROUP_SIZE} travellers. This file is generated from the live site, so the trips and prices below are current as of the time it was fetched.`,
    '',
    '## Upcoming trips',
    '',
    live.length > 0
      ? live.map(tripLine).join('\n\n')
      : 'No departures are currently open for booking.',
    '',
    '## Past trips',
    '',
    archived.length > 0
      ? `These have already run and are not bookable. They are kept online as a record of where the trips actually went.\n\n${archived
          .map((trip) => {
            const latest = pastBatches(trip)[0];
            const ran = latest ? ` — last ran ${String(latest.startDate).slice(0, 7)}` : '';
            return `- ${tripName(trip)}${ran}: ${SITE_ORIGIN}/trips/${encodeURIComponent(trip.slug)}/`;
          })
          .join('\n')}`
      : 'None yet.',
    '',
    '## Booking and cancellation',
    '',
    `Booking is per departure, with an advance paid to hold a seat and the balance due before the trip. Cancellation: ${refundPolicy}`,
    `Full terms: ${SITE_ORIGIN}/cancellation/ and ${SITE_ORIGIN}/terms/`,
    '',
    '## Primary pages',
    '',
    `- Home: ${SITE_ORIGIN}/`,
    `- Upcoming trips: ${SITE_ORIGIN}/trips/`,
    `- Past trips: ${SITE_ORIGIN}/trips/past/`,
    `- About Seek the Thrill: ${SITE_ORIGIN}/about/`,
    `- Frequently asked questions: ${SITE_ORIGIN}/faq/`,
    `- Custom itineraries: ${SITE_ORIGIN}/custom-itineraries/`,
    `- Contact: ${SITE_ORIGIN}/contact/`,
    `- Cancellation policy: ${SITE_ORIGIN}/cancellation/`,
    `- Terms and conditions: ${SITE_ORIGIN}/terms/`,
    `- Privacy policy: ${SITE_ORIGIN}/privacy/`,
    '',
    'Trip dates, prices, availability, and inclusions can change. Treat each canonical trip page as the source of truth.',
    '',
  ];

  return new Response(sections.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
