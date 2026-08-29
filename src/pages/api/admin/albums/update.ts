import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { readAlbum, writeAlbum, saveImageFile } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls } from '../../../../lib/cachePurge';
import { sanitizeInput } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const contentType = request.headers.get('content-type') ?? '';

  // JSON call from the "Save Captions" button — only updates photos array
  if (contentType.includes('application/json')) {
    try {
      const { slug, photosOnly, photos } = await request.json();
      if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });
      const album = readAlbum(slug);
      if (!album) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
      if (photosOnly && Array.isArray(photos)) {
        // The captions form only posts { image, caption }. Merge back the stored
        // width/height (keyed by image URL) so dimensions aren't lost on save.
        const dims = new Map<string, { width?: number; height?: number }>(
          (Array.isArray(album.photos) ? album.photos : []).map((p: any) => [p.image, { width: p.width, height: p.height }]),
        );
        const merged = photos.map((p: any) => ({ ...dims.get(p.image), image: p.image, caption: p.caption }));
        writeAlbum(slug, { ...album, photos: merged });
        await submitToIndexNow([`/photo-vault/${slug}/`]);
        await purgeUrls([`/photo-vault/${slug}/`]);
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
    // Deterministic filename — overwrites in place, so purge the old copy.
    await purgeUrls([coverImage]);
  }

  const updated = {
    ...album,
    name: sanitizeInput(body.get('name')) || album.name,
    publicationStatus: sanitizeInput(body.get('publicationStatus')) || album.publicationStatus || 'draft',
    location: sanitizeInput(body.get('location')) || null,
    date: sanitizeInput(body.get('date')) || null,
    description: sanitizeInput(body.get('description')) || null,
    seoTitle: sanitizeInput(body.get('seoTitle')) || null,
    seoDescription: sanitizeInput(body.get('seoDescription')) || null,
    socialImageAlt: sanitizeInput(body.get('socialImageAlt')) || null,
    coverImage,
    published: body.get('publicationStatus') === 'published',
  };

  writeAlbum(slug, updated);
  await submitToIndexNow([`/photo-vault/${slug}/`]);
  await purgeUrls([`/photo-vault/${slug}/`]);
  return redirect(`/admin/photo-vault/${slug}`);
};
