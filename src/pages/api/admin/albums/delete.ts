import type { APIRoute } from 'astro';
import { deleteAlbum } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { slug } = await request.json();
    if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
    deleteAlbum(slug);
    await submitToIndexNow([`/photo-vault/${slug}/`]);
    return new Response(JSON.stringify({ ok: true }));
  } catch {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
