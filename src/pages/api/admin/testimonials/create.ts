import type { APIRoute } from 'astro';
import { writeTestimonial } from '../../../../lib/content';
import { sanitizeInput, slugify } from '../../../../lib/utils';

export const POST: APIRoute = async ({ request, redirect }) => {
  const body = await request.formData();
  const name = sanitizeInput(body.get('name'));
  const slug = slugify(sanitizeInput(body.get('slug') as string) || name);
  if (!slug) return redirect('/admin/testimonials/new?error=1');

  writeTestimonial(slug, {
    name,
    location: sanitizeInput(body.get('location')) || null,
    rating: body.get('rating') ? Number(body.get('rating')) : 5,
    tripName: sanitizeInput(body.get('tripName')) || null,
    quote: sanitizeInput(body.get('quote')) || '',
    featured: body.get('featured') === 'on' || body.get('featured') === 'true',
  });
  return redirect('/admin/testimonials');
};
