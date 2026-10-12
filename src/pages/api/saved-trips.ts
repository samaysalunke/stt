import type { APIRoute } from 'astro';
import { readTrip, isTripPublic } from '../../lib/content';
import { rateLimit } from '../../lib/rateLimit';
import { jsonOk, jsonFail } from '../../lib/apiResponse';
import { saveTrip, unsaveTrip } from '../../lib/userTrips';

export const prerender = false;

/**
 * Save or unsave a trip for the signed-in traveller (the heart on a trip card).
 * POST saves, DELETE removes; both take `{ slug }` and are idempotent.
 * Signed-out visitors never reach this: their heart is a link through sign-in.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;

async function handle(request: Request, locals: App.Locals, clientAddress: string, save: boolean) {
  const user = locals.user;
  if (!user) return jsonFail('Sign in to save trips.', 401);
  if (!rateLimit(`saved-trips:${user.id}:${clientAddress}`, 60, 60 * 1000)) {
    return jsonFail('Too many requests. Please try again shortly.', 429);
  }

  let body: any;
  try { body = await request.json(); } catch { return jsonFail('Invalid request body.', 400); }
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  if (!SLUG_RE.test(slug)) return jsonFail('Trip not found.', 404);

  if (save) {
    // Only trips a visitor could open can be saved; unsaving a trip that has
    // since been removed or unpublished must still work.
    const trip = readTrip(slug);
    if (!trip || !isTripPublic({ slug, ...trip })) return jsonFail('Trip not found.', 404);
    saveTrip(user.id, slug);
  } else {
    unsaveTrip(user.id, slug);
  }
  return jsonOk({ success: true, saved: save });
}

export const POST: APIRoute = ({ request, locals, clientAddress }) => handle(request, locals, clientAddress, true);
export const DELETE: APIRoute = ({ request, locals, clientAddress }) => handle(request, locals, clientAddress, false);
