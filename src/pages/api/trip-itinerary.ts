import type { APIRoute } from 'astro';
import { readTrip, isTripViewable, isTripDeleted } from '../../lib/content';
import { getAdminBySession } from '../../lib/admin-session';
import { rateLimit } from '../../lib/rateLimit';
import { jsonOk, jsonFail } from '../../lib/apiResponse';
import {
  ITINERARY_ACCESS_COOKIE,
  emailForAccessToken,
  hasItineraryAccess,
  itineraryGate,
  normalizeItinerary,
} from '../../lib/itineraryGate';

export const prerender = false;

/**
 * GET /api/trip-itinerary?slug=… — the full itinerary of a gated trip, for a
 * visitor who has registered for it. The trip page's locked render calls this
 * after load, so the cached page HTML never has to vary per visitor. Under
 * /api/, so middleware marks every response `private, no-store`.
 */
export const GET: APIRoute = async ({ url, cookies, locals, clientAddress }) => {
  if (!rateLimit(`trip-itinerary:${clientAddress}`, 120, 60 * 60 * 1000)) {
    return jsonFail('Too many requests. Please try again later.', 429);
  }

  const slug = String(url.searchParams.get('slug') ?? '').trim();
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) return jsonFail('Trip not found.', 404);
  const trip = readTrip(slug);
  if (!trip || isTripDeleted(slug) || !isTripViewable({ slug, ...trip })) return jsonFail('Trip not found.', 404);

  const itinerary = normalizeItinerary(trip);
  const gate = itineraryGate(trip);
  if (!gate.locked) return jsonOk({ success: true, itinerary });

  const adminToken = cookies.get('admin_token')?.value;
  const isAdmin = !!adminToken && !!getAdminBySession(adminToken);
  const cookieEmail = emailForAccessToken(cookies.get(ITINERARY_ACCESS_COOKIE)?.value);
  if (isAdmin || hasItineraryAccess([locals.user?.email, cookieEmail], slug)) {
    return jsonOk({ success: true, itinerary });
  }
  return jsonFail('Register for this trip to see the full itinerary.', 403, { locked: true });
};
