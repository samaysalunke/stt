import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { deleteHost, tripsUsingHost } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';
import { submitToIndexNow } from '../../../../lib/indexnow';
import { purgeUrls, allCacheablePaths, TRIP_LISTING_PATHS } from '../../../../lib/cachePurge';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const body = await request.formData();
  const slug = sanitizeInput(body.get('slug'));
  if (!slug) return redirect('/admin/hosts');

  // A host wired into live departures must not vanish out from under them.
  const used = tripsUsingHost(slug);
  if (used.length > 0) {
    return redirect('/admin/hosts?blocked=' + encodeURIComponent(slug));
  }

  deleteHost(slug);
  await submitToIndexNow(TRIP_LISTING_PATHS);
  await purgeUrls(allCacheablePaths());
  return redirect('/admin/hosts');
};
