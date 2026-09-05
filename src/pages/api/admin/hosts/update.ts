import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { writeHost, readHost, saveImageFile, deleteImageByUrl } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls, allCacheablePaths, TRIP_LISTING_PATHS } from '../../../../lib/cachePurge';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const body = await request.formData();
  const slug = sanitizeInput(body.get('slug'));
  if (!slug) return redirect('/admin/hosts');
  const existing = readHost(slug);
  if (!existing) return redirect('/admin/hosts');

  // Keep the current photo unless a new file was actually chosen.
  const photoFile = body.get('photo') as File | null;
  let photo = existing.photo;
  if (photoFile && photoFile.size > 0) {
    photo = await saveImageFile(photoFile, 'images/hosts', slug);
    if (existing.photo && existing.photo !== photo) deleteImageByUrl(existing.photo);
  }

  writeHost(slug, {
    name: sanitizeInput(body.get('name')),
    subtitle: sanitizeInput(body.get('subtitle')),
    photo,
    bio: sanitizeInput(body.get('bio')),
  });
  await submitToIndexNow(TRIP_LISTING_PATHS);
  await purgeUrls(allCacheablePaths());
  return redirect('/admin/hosts');
};
