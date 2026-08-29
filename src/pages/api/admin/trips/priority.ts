export const prerender = false;
import type { APIRoute } from 'astro';
import { readTrip, writeTrip, TRIP_PRIORITIES } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls, tripPaths } from '../../../../lib/cachePurge';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

export const POST: APIRoute = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Expected a JSON request body.' }, 400);
  }

  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  const priority = typeof body?.priority === 'string' ? body.priority : '';
  if (!/^[a-z0-9-]+$/.test(slug) || !(TRIP_PRIORITIES as readonly string[]).includes(priority)) {
    return json({ success: false, error: 'Invalid slug or priority.' }, 400);
  }

  const trip = readTrip(slug);
  if (!trip) return json({ success: false, error: 'Trip not found.' }, 404);

  writeTrip(slug, { ...trip, priority });
  await submitToIndexNow([`/trips/${slug}/`]);
  await purgeUrls(tripPaths(slug));
  return json({ success: true, priority });
};
