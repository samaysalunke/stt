import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { deleteAlbum } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls } from '../../../../lib/cachePurge';

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  try {
    const { slug } = await request.json();
    if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
    deleteAlbum(slug);
    await submitToIndexNow([`/photo-vault/${slug}/`]);
    await purgeUrls([`/photo-vault/${slug}/`]);
    return new Response(JSON.stringify({ ok: true }));
  } catch {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
