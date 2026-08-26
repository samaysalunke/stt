import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { writeFaq } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const body = await request.formData();
  const slug = sanitizeInput(body.get('slug'));
  if (!slug) return redirect('/admin/faqs');

  writeFaq(slug, {
    question: sanitizeInput(body.get('question')),
    answer: sanitizeInput(body.get('answer')),
    category: sanitizeInput(body.get('category')) || 'General',
    order: body.get('order') ? Number(body.get('order')) : 999,
    defaultOnTripPages: body.get('defaultOnTripPages') === 'on',
  });
  return redirect('/admin/faqs');
};
