export const prerender = false;
import type { APIRoute } from 'astro';
import { readTrip, writeTrip, listTrips } from '../../../../lib/content';

export const POST: APIRoute = async ({ request, cookies }) => {
  const token = cookies.get('admin_token')?.value;
  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

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

    const newData = {
      ...source,
      name: `${source.name ?? slug} (Copy)`,
      status: 'draft',
      currentBookings: 0,
      // Clear dates so admin sets new ones
      startDate: '',
      endDate: '',
    };

    writeTrip(newSlug, newData);

    return new Response(JSON.stringify({ success: true, newSlug }), { status: 200 });
  } catch (err) {
    console.error('Duplicate trip error:', err);
    return new Response(JSON.stringify({ error: 'Failed to duplicate trip' }), { status: 500 });
  }
};
