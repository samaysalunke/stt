import type { APIRoute } from 'astro';
import { deleteTrip } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { slug } = await request.json();
    if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
    deleteTrip(slug);
    await submitToIndexNow([`/trips/${slug}/`]);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
