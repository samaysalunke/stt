import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { deleteFaq } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const body = await request.formData();
  const slug = sanitizeInput(body.get('slug'));
  if (slug) deleteFaq(slug);
  return redirect('/admin/faqs');
};
