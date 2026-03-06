import type { APIRoute } from 'astro';
import { deleteTrip } from '../../../../lib/content';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { slug } = await request.json();
    if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
    deleteTrip(slug);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
