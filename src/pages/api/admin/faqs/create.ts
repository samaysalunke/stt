import type { APIRoute } from 'astro';
import { requireRole } from '../../../../lib/requireRole';
import { writeFaq, listFaqs } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  const body = await request.formData();
  const question = sanitizeInput(body.get('question'));
  const slug = slugify(sanitizeInput(body.get('slug') as string) || question);
  if (!slug) return redirect('/admin/faqs/new?error=1');

  const order = body.get('order') ? Number(body.get('order')) : listFaqs().length + 1;
  writeFaq(slug, {
    question,
    answer: sanitizeInput(body.get('answer')),
    category: sanitizeInput(body.get('category')) || 'General',
    order,
  });
  return redirect('/admin/faqs');
};
