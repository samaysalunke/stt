import type { APIRoute } from 'astro';
import { deleteFaq } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();
  const slug = sanitizeInput(body.get('slug'));
  if (slug) deleteFaq(slug);
  return redirect('/admin/faqs');
};
