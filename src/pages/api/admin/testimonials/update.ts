import type { APIRoute } from 'astro';
import { writeTestimonial } from '../../../../lib/content';
import { sanitizeInput } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();
  const slug = sanitizeInput(body.get('slug'));
  if (!slug) return redirect('/admin/testimonials');

  writeTestimonial(slug, {
    name: sanitizeInput(body.get('name')),
    location: sanitizeInput(body.get('location')) || null,
    rating: body.get('rating') ? Number(body.get('rating')) : 5,
    tripName: sanitizeInput(body.get('tripName')) || null,
    quote: sanitizeInput(body.get('quote')) || '',
    featured: body.get('featured') === 'on' || body.get('featured') === 'true',
  });
  return redirect('/admin/testimonials');
};
