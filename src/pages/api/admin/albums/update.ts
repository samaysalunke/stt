import type { APIRoute } from 'astro';
import { readAlbum, writeAlbum, saveImageFile } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect }) => {
  const contentType = request.headers.get('content-type') ?? '';

  // JSON call from the "Save Captions" button — only updates photos array
  if (contentType.includes('application/json')) {
    try {
      const { slug, photosOnly, photos } = await request.json();
      if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
      const album = readAlbum(slug);
      if (!album) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      if (photosOnly && Array.isArray(photos)) {
        writeAlbum(slug, { ...album, photos });
      }
      return new Response(JSON.stringify({ ok: true }));
    } catch {
      return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
    }
  }

  // FormData call from the metadata form
  const body = await request.formData();
  const slug = sanitizeInput(body.get('slug'));
  if (!slug) return redirect('/admin/photo-vault');

  const album = readAlbum(slug);
  if (!album) return redirect('/admin/photo-vault');

  let coverImage = sanitizeInput(body.get('existingCoverImage')) || null;
  const coverFile = body.get('coverImage') as File | null;
  if (coverFile && coverFile.size > 0) {
    coverImage = await saveImageFile(coverFile, 'images/albums', `${slug}-cover`);
  }

  const updated = {
    ...album,
    name: sanitizeInput(body.get('name')) || album.name,
    location: sanitizeInput(body.get('location')) || null,
    date: sanitizeInput(body.get('date')) || null,
    description: sanitizeInput(body.get('description')) || null,
    coverImage,
    published: body.get('published') === 'true',
  };

  writeAlbum(slug, updated);
  return redirect(`/admin/photo-vault/${slug}`);
};
