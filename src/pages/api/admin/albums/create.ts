import type { APIRoute } from 'astro';
import { writeAlbum, saveImageFile } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();

  const name = sanitizeInput(body.get('name'));
  const slug = slugify(sanitizeInput(body.get('slug') as string) || name);
  if (!slug) return redirect('/admin/photo-vault/new?error=slug');

  let coverImage: string | null = null;
  const coverFile = body.get('coverImage') as File | null;
  if (coverFile && coverFile.size > 0) {
    coverImage = await saveImageFile(coverFile, 'images/albums', `${slug}-cover`);
  }

  const data: Record<string, any> = {
    name,
    location: sanitizeInput(body.get('location')) || null,
    date: sanitizeInput(body.get('date')) || null,
    description: sanitizeInput(body.get('description')) || null,
    coverImage,
    published: body.get('published') === 'true',
    photos: [],
  };

  writeAlbum(slug, data);
  return redirect(`/admin/photo-vault/${slug}`);
};
