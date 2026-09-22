import type { APIRoute } from 'astro';
import { rateLimit } from '../../lib/rateLimit';
import { SITE_ORIGIN } from '../../lib/siteUrl';
import {
  attributionCookieNames, attributionFromRequest, hasCampaignTouch, readAttribution,
  restoreTouch, sameOriginLandingPath,
} from '../../lib/attribution';

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
 *
 * The cookie is not the only copy. The page mirrors whatever first touch this
 * endpoint settles on into localStorage and replays it on the next visit, so a
 * cleared or expired cookie no longer erases the campaign that found someone.
 * That matters most for exactly the traffic this was built for: a ₹20-30k trip
 * booked days after the Instagram DM that started it. Both stores are still
 * per-browser — nothing here recovers a visitor who reads the trip page in
 * Instagram's in-app browser and pays from Chrome two days later. The subscriber
 * id on the DM link is what covers that hop, by joining the site lead back to
 * the conversation rather than to the browser.
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
    //
    // What is new is where a missing first-touch cookie can be refilled from.
    // The page replays its localStorage mirror, and a valid replay wins over
    // this visit: a visitor whose cookie was cleared is not a new visitor, and
    // treating them as one is precisely how Instagram loses credit for a
    // booking to "direct" a week later. A readable cookie still wins over the
    // replay, so the page can never rewrite a first touch we already hold; an
    // absent or unreadable one is what the replay refills.
    const stored = readAttribution(cookies).firstTouch;
    const firstTouch = stored ?? restoreTouch(body?.firstTouch) ?? touch;

    if (!stored) {
      cookies.set(attributionCookieNames.first, JSON.stringify(firstTouch), cookieOptions);
    }
    if (!cookies.get(attributionCookieNames.latest) || hasCampaignTouch(touch, SITE_ORIGIN)) {
      cookies.set(attributionCookieNames.latest, JSON.stringify(touch), cookieOptions);
    }

    // Echo the first touch back so the page can keep its mirror in step — and
    // so a visitor who still has the cookie but lost localStorage gets the
    // mirror rebuilt from the cookie, rather than from this visit.
    return new Response(JSON.stringify({ success: true, firstTouch }), {
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
