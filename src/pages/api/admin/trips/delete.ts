import type { APIRoute } from 'astro';
import { softDeleteTrip } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const { slug } = await request.json();
    if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
    softDeleteTrip(slug, {
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
    });
    await submitToIndexNow([`/trips/${slug}/`]);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
