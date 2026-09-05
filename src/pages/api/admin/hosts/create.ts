import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { writeHost, readHost, saveImageFile } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls, allCacheablePaths, TRIP_LISTING_PATHS } from '../../../../lib/cachePurge';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const body = await request.formData();
  const name = sanitizeInput(body.get('name'));
  const slug = slugify(sanitizeInput(body.get('slug') as string) || name);
  if (!slug) return redirect('/admin/hosts/new?error=1');
  if (readHost(slug)) return redirect('/admin/hosts/new?error=duplicate');

  const photoFile = body.get('photo') as File | null;
  const photo = photoFile && photoFile.size > 0
    ? await saveImageFile(photoFile, 'images/hosts', slug)
    : null;

  writeHost(slug, {
    name,
    subtitle: sanitizeInput(body.get('subtitle')),
    photo,
    bio: sanitizeInput(body.get('bio')),
  });
  await submitToIndexNow(TRIP_LISTING_PATHS);
  await purgeUrls(allCacheablePaths());
  return redirect('/admin/hosts');
};
