import type { APIRoute } from 'astro';
import { readAlbum, writeAlbum, saveImageFileWithMeta } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.formData();
    const slug = sanitizeInput(body.get('slug'));
    if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });

    const album = readAlbum(slug);
    if (!album) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

    const photoFile = body.get('photo') as File | null;
    if (!photoFile || photoFile.size === 0) {
      return new Response(JSON.stringify({ error: 'No photo provided' }), { status: 400 });
    }

    const { url: imageUrl, width, height } = await saveImageFileWithMeta(photoFile, 'images/albums/photos');
    const caption = sanitizeInput(body.get('caption')) || '';

    const photos = Array.isArray(album.photos) ? album.photos : [];
    photos.push({ image: imageUrl, caption, width, height });
    writeAlbum(slug, { ...album, photos });

    return new Response(JSON.stringify({ ok: true, image: imageUrl }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
