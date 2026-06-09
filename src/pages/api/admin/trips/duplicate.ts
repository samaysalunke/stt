export const prerender = false;
import type { APIRoute } from 'astro';
import { readTrip, writeTrip, listTrips } from '../../../../lib/content';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { slug } = await request.json();
    if (!slug) {
      return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
    }

    const source = readTrip(slug);
    if (!source) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), { status: 404 });
    }

    // Find a unique slug for the copy
    const existingSlugs = new Set(listTrips().map((t: any) => t.slug));
    let newSlug = `${slug}-copy`;
    let counter = 2;
    while (existingSlugs.has(newSlug)) {
      newSlug = `${slug}-copy-${counter}`;
      counter++;
    }

    // A copy is a fresh trip — reset booked counts on every departure, both the
    // legacy per-batch count and the new per-offer counts.
    const copiedBatches = (Array.isArray(source.batches) ? source.batches : []).map((b: any) => ({
      ...b,
      bookedSpots: 0,
      ...(Array.isArray(b.offers) ? { offers: b.offers.map((o: any) => ({ ...o, booked: 0 })) } : {}),
    }));

    const newData = {
      ...source,
      name: `${source.name ?? slug} (Copy)`,
      status: 'draft',
      batches: copiedBatches,
    };

    writeTrip(newSlug, newData);

    return new Response(JSON.stringify({ success: true, newSlug }), { status: 200 });
  } catch (err) {
    console.error('Duplicate trip error:', err);
    return new Response(JSON.stringify({ error: 'Failed to duplicate trip' }), { status: 500 });
  }
};
