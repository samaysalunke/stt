import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { readAlbum, writeAlbum, deleteImageByUrl } from '../../../../lib/content';

export const POST: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  try {
    const { slug, photoUrl } = await request.json();
    if (!slug || !photoUrl) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400 });
    }
    const album = readAlbum(slug);
    if (!album) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

    const photos = Array.isArray(album.photos) ? album.photos : [];
    const updated = photos.filter((p: { image: string }) => p.image !== photoUrl);
    writeAlbum(slug, { ...album, photos: updated });

    // Remove the underlying file from the volume (best-effort).
    deleteImageByUrl(photoUrl);

    return new Response(JSON.stringify({ ok: true }));
  } catch {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
