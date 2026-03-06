import type { APIRoute } from 'astro';
import { readAlbum, writeAlbum } from '../../../../lib/content';

export const POST: APIRoute = async ({ request }) => {
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

    return new Response(JSON.stringify({ ok: true }));
  } catch {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
