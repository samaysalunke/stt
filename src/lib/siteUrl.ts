// Single source of truth for the canonical public origin.
//
// Production serves www (Railway + Cloudflare + Google OAuth are all www); the
// fallback here matches that. Set SITE_URL in the environment to override.
// Everything user-facing — canonical tags, OG URLs, sitemap, feed, JSON-LD @ids,
// email links, OAuth redirect URIs — must build off these, never a literal.

const RAW = process.env.SITE_URL ?? 'https://www.seekthethrill.in';

/** Canonical origin, no trailing slash. e.g. "https://www.seekthethrill.in" */
export const SITE_ORIGIN = new URL(RAW).origin;

/** Canonical host. e.g. "www.seekthethrill.in" */
export const SITE_HOST = new URL(RAW).host;

/** Absolutize a path (or pass through an already-absolute URL). */
export function siteUrl(path: string): string {
  return path.startsWith('http') ? path : new URL(path, SITE_ORIGIN).href;
}
