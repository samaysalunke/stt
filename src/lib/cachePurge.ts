// Cloudflare cache purge: drop edge copies of URLs an admin action just
// changed, so a content edit or a seat-count change is visible in seconds
// instead of waiting out s-maxage.
//
// Requires CF_ZONE_ID and a CF_PURGE_TOKEN scoped to Zone → Cache Purge →
// Purge. Without them every call is a no-op, so this is safe to leave wired up
// in non-prod and before the token is provisioned.
//
// Mirrors src/lib/indexnow.ts deliberately: same env-missing guard, same
// absolutize-and-dedupe step, same swallowed failure. Purging is best-effort
// and must never fail the admin action that triggered it — the TTL is the
// backstop if a purge is lost.
//
// Cache-Tag purge (one tag, one call) would be cleaner, but it is an
// Enterprise-only feature; at this catalogue size URL purge is entirely
// adequate.

import { SITE_ORIGIN } from './siteUrl';
import { listTrips } from './trips';

const ZONE_ID = process.env.CF_ZONE_ID ?? '';
const PURGE_TOKEN = process.env.CF_PURGE_TOKEN ?? '';

/** Absolutize against the canonical origin and de-duplicate. Pure — safe to test. */
export function purgeUrlList(paths: string[]): string[] {
  return [...new Set(
    paths.filter(Boolean).map((p) => (p.startsWith('http') ? p : `${SITE_ORIGIN}${p}`)),
  )];
}

/**
 * Purge the given paths from the Cloudflare edge cache. No-op unless both env
 * vars are set. Never throws.
 */
export async function purgeUrls(paths: string[]): Promise<void> {
  if (!ZONE_ID || !PURGE_TOKEN) return;
  const files = purgeUrlList(paths);
  if (files.length === 0) return;
  try {
    await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PURGE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ files }),
    });
  } catch {
    /* best-effort; ignore network/endpoint failures */
  }
}

/**
 * The listing surfaces every trip appears on. Any change to a trip's price,
 * seat count, or card copy changes these as well as the detail page.
 */
export const TRIP_LISTING_PATHS = ['/', '/trips/'];

/** Listings plus one trip's detail page. */
export function tripPaths(slug: string): string[] {
  return [...TRIP_LISTING_PATHS, `/trips/${slug}/`];
}

/** Cacheable pages that are not a trip detail page. */
const STATIC_PATHS = [
  '/', '/trips/', '/about/', '/faq/', '/contact/',
  '/custom-itineraries/', '/privacy/', '/terms/', '/cancellation/',
];

/**
 * Every cacheable page. For edits with site-wide reach — settings (header,
 * footer, contact details, policy copy), testimonials and FAQs (which surface
 * on the homepage and on each trip page) — the blast radius genuinely is the
 * whole site, so enumerate it rather than guessing which pages embed what.
 *
 * At this catalogue size that is a few dozen URLs in one API call.
 */
export function allCacheablePaths(): string[] {
  let tripDetailPaths: string[] = [];
  try {
    tripDetailPaths = listTrips().map((trip: any) => `/trips/${trip.slug}/`);
  } catch {
    /* listing failure must not block the purge of the static pages */
  }
  return [...STATIC_PATHS, ...tripDetailPaths];
}
