import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { writeAlbum, readAlbum, saveImageFile } from '../../../../lib/content';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls } from '../../../../lib/cachePurge';
import { sanitizeInput, slugify } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const body = await request.formData();

  const name = sanitizeInput(body.get('name'));
  // Slug is always derived from the name; uniqueness is ensured with a -2/-3 suffix.
  const base = slugify(name);
  if (!base) return redirect('/admin/photo-vault/new?error=slug');
  let slug = base;
  for (let n = 2; readAlbum(slug) !== null; n++) slug = `${base}-${n}`;

  let coverImage: string | null = null;
  const coverFile = body.get('coverImage') as File | null;
  if (coverFile && coverFile.size > 0) {
    coverImage = await saveImageFile(coverFile, 'images/albums', `${slug}-cover`);
  }

  const data: Record<string, any> = {
    name,
    publicationStatus: sanitizeInput(body.get('publicationStatus')) || 'draft',
    location: sanitizeInput(body.get('location')) || null,
    date: sanitizeInput(body.get('date')) || null,
    description: sanitizeInput(body.get('description')) || null,
    seoTitle: sanitizeInput(body.get('seoTitle')) || null,
    seoDescription: sanitizeInput(body.get('seoDescription')) || null,
    socialImageAlt: sanitizeInput(body.get('socialImageAlt')) || null,
    coverImage,
    published: body.get('publicationStatus') === 'published',
    photos: [],
  };

  writeAlbum(slug, data);
  await submitToIndexNow([`/photo-vault/${slug}/`]);
  await purgeUrls([`/photo-vault/${slug}/`]);
  return redirect(`/admin/photo-vault/${slug}`);
};
