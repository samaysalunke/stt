import { SITE_HOST } from './siteUrl';

/** Hosts that only ever appear on the internal proxy hop, never in a browser. */
export function isInternalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)(:\d+)?$/i.test(host);
}

export function firstHeaderValue(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null;
}

/**
 * One canonical public origin and path shape, resolved in a SINGLE hop:
 * host (apex→www) + protocol (http→https) + lowercase + trailing slash are
 * all folded into one target. Returns the URL to 308 to, or null when the
 * request is already canonical.
 *
 * Railway terminates TLS at the edge and proxies to the container on
 * http://localhost, so `url` may carry the INTERNAL host — the browser-facing
 * host/proto live in the x-forwarded-* headers. Build the target from those, or
 * every canonicalized URL 308s to https://localhost/… and dies.
 *
 * Which `url` arrives depends on Astro: 5.x built it from Host unconditionally;
 * 7.x builds it from Host only when Host matches `security.allowedDomains`, and
 * otherwise falls back to `localhost:<port>`. The target below comes from the
 * headers either way, so both produce the same redirect.
 */
export function canonicalRedirect(url: URL, request: Request, prod: boolean): string | null {
  const fwdHost =
    firstHeaderValue(request.headers.get('x-forwarded-host')) ??
    firstHeaderValue(request.headers.get('host')) ??
    url.host;
  const fwdProto = (
    firstHeaderValue(request.headers.get('x-forwarded-proto')) ?? url.protocol
  ).replace(/:$/, '');
  const publicHost = isInternalHost(url.host) && isInternalHost(fwdHost) ? url.host : fwdHost;
  const externalRequest = !isInternalHost(publicHost);

  const target = new URL(url);
  target.host = publicHost;
  // Assigning a host without a port keeps the URL's existing port, and under
  // Astro 7 an unlisted Host leaves `url` on localhost:<port> — so a redirect
  // for a domain missing from allowedDomains went to https://that-domain:8080/.
  if (!/:\d+$/.test(publicHost)) target.port = '';
  target.protocol = `${fwdProto}:`;
  // Compare against the URL as the browser actually sees it, not the internal one.
  const publicHref = target.href;

  if (prod && externalRequest && (request.method === 'GET' || request.method === 'HEAD')) {
    if (target.hostname === SITE_HOST.replace(/^www\./, '')) target.host = SITE_HOST;
    if (target.protocol === 'http:') target.protocol = 'https:';
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    const nonIndexablePrefix = ['/admin', '/api', '/keystatic', '/profile', '/login', '/unsubscribe', '/leaderboard', '/u/'];
    const canonicalizable = !nonIndexablePrefix.some((prefix) => url.pathname.startsWith(prefix)) && !url.pathname.endsWith('/book');
    const isFile = !!url.pathname.split('/').pop()?.includes('.');
    if (canonicalizable && !isFile) {
      target.pathname = target.pathname.toLowerCase();
      if (target.pathname !== '/' && !target.pathname.endsWith('/')) target.pathname = `${target.pathname}/`;
    }
  }
  return target.href !== publicHref ? target.toString() : null;
}
