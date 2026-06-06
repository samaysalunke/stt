import type { APIRoute } from 'astro';
import { writeFaq } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();
  const slug = sanitizeInput(body.get('slug'));
  if (!slug) return redirect('/admin/faqs');

  writeFaq(slug, {
    question: sanitizeInput(body.get('question')),
    answer: sanitizeInput(body.get('answer')),
    category: sanitizeInput(body.get('category')) || 'General',
    order: body.get('order') ? Number(body.get('order')) : 999,
  });
  return redirect('/admin/faqs');
};
