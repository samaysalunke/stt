import type { APIRoute } from 'astro';
import { rateLimit } from '../../lib/rateLimit';
import { SITE_ORIGIN } from '../../lib/siteUrl';
import { attributionCookieNames, attributionFromRequest, hasCampaignTouch, sameOriginLandingPath } from '../../lib/attribution';

// Server-rendered endpoint (sets cookies) — never prerender.
export const prerender = false;

/**
 * First/latest-touch attribution capture, moved off the HTML response.
 *
 * The middleware used to set these cookies on every public HTML GET. That is
 * incompatible with edge caching, and the failure mode is worse than it looks:
 * the middleware only writes when a cookie is ABSENT, so it is the REPEAT
 * visitor whose response carries no Set-Cookie — and that cookie-free response
 * is exactly the one Cloudflare caches and then serves to first-time visitors,
 * who would then never receive attribution cookies at all. Silent, total
 * first-touch loss on new traffic.
 *
 * So the capture moves here, to a request the cache never sees. The documented
 * trade-off: a first visit with JS disabled loses first-touch attribution. That
 * is strictly better than losing it for every new visitor once caching is on.
 *
 * The conversion endpoints are unchanged — they still read the cookies.
 */

const MAX_VALUE = 500;
const clamp = (value: unknown): string => (typeof value === 'string' ? value : '').trim().slice(0, MAX_VALUE);

export const POST: APIRoute = async ({ request, clientAddress, cookies }) => {
  // Generous: the beacon fires once per session, so anything above this is
  // not a real visitor.
  if (!rateLimit(`attribution:${clientAddress}`, 20, 60 * 60 * 1000)) {
    return new Response(JSON.stringify({ success: false }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '3600' },
    });
  }

  try {
    const body = await request.json();

    // The client controls all three of these, so nothing is trusted: the path
    // is forced same-origin (see sameOriginLandingPath), the query is re-parsed
    // from it, and every field is clamped to the same 500 chars the cookie
    // parser uses.
    const landingPath = sameOriginLandingPath(clamp(body?.landingPage));
    const search = clamp(body?.search);
    const referrer = clamp(body?.referrer);

    const url = new URL(`${landingPath}${search.startsWith('?') ? search : ''}`, SITE_ORIGIN);

    // Reuse the exact shape the server-side parse produced, so downstream
    // readers (readAttribution, attributionSource) see no difference.
    const touch = attributionFromRequest(
      url,
      new Request(url, referrer ? { headers: { referer: referrer } } : undefined),
    );

    const cookieOptions = {
      path: '/', httpOnly: true, sameSite: 'lax' as const,
      secure: import.meta.env.PROD, maxAge: 60 * 60 * 24 * 90,
    };

    // Same guards the middleware applied: first-touch is written once and never
    // overwritten; latest-touch is refreshed on a campaign or off-site referrer.
    if (!cookies.get(attributionCookieNames.first)) {
      cookies.set(attributionCookieNames.first, JSON.stringify(touch), cookieOptions);
    }
    if (!cookies.get(attributionCookieNames.latest) || hasCampaignTouch(touch, SITE_ORIGIN)) {
      cookies.set(attributionCookieNames.latest, JSON.stringify(touch), cookieOptions);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    // Attribution is best-effort telemetry; never surface a failure to the page.
    return new Response(JSON.stringify({ success: false }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
};
