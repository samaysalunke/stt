import type { APIRoute } from 'astro';
import { readTrip, writeTrip } from '../../../../lib/content';

const VALID_STATUSES = ['booking-open', 'upcoming', 'draft', 'sold-out', 'completed'];

export const POST: APIRoute = async ({ request }) => {
  try {
    const { slug, status } = await request.json();
    if (!slug || !VALID_STATUSES.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid parameters' }), { status: 400 });
    }
    const trip = readTrip(slug);
    if (!trip) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    writeTrip(slug, { ...trip, status });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
