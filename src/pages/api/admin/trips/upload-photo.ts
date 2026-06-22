import type { APIRoute } from 'astro';
import { saveImageFileWithMeta } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';

// Upload a trip-only photo. Stored under images/trips/<slug>/ and returned to the
// editor to append to the trip's gallery. These never enter the Photo Vault.
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.formData();
    const slug = slugify(sanitizeInput(body.get('slug')));
    if (!slug) return new Response(JSON.stringify({ error: 'Missing slug' }), { status: 400 });

    const photoFile = body.get('photo') as File | null;
    if (!photoFile || photoFile.size === 0) {
      return new Response(JSON.stringify({ error: 'No photo provided' }), { status: 400 });
    }

    const { url, width, height } = await saveImageFileWithMeta(photoFile, `images/trips/${slug}`);
    return new Response(JSON.stringify({ ok: true, url, width, height }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Failed' }), { status: 500 });
  }
};
