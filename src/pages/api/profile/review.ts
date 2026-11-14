import type { APIRoute } from 'astro';
import { rateLimit } from '../../../lib/rateLimit';
import { parseReviewForm, reviewAccess, saveReview } from '../../../lib/tripReviews';

export const prerender = false;

/**
 * POST /api/profile/review — save the signed-in traveller's review of one of
 * their bookings. A plain form post (no JavaScript needed); redirects back to
 * the form with ?saved=1 or ?error=…. Middleware's same-origin check covers CSRF.
 */
export const POST: APIRoute = async ({ request, locals, redirect, clientAddress }) => {
  const form = await request.formData().catch(() => null);
  const id = Number(form?.get('registrationId'));
  const back = (query: string) => redirect(`/profile/review/${Number.isInteger(id) && id > 0 ? id : ''}?${query}`, 303);

  const user = locals.user;
  if (!user) return redirect(`/login?next=${encodeURIComponent(`/profile/review/${Number.isInteger(id) ? id : ''}`)}`, 303);
  if (!rateLimit(`trip-review:${user.id}:${clientAddress}`, 30, 60 * 60 * 1000)) {
    return new Response('Too many requests. Please try again later.', { status: 429 });
  }
  if (!form) return back('error=invalid');

  // Same checks as the page: this account's own confirmed booking, trip ended.
  const access = reviewAccess(id, user.email);
  if (!access.ok) return redirect(`/profile/review/${id}`, 303);

  const { input, errors } = parseReviewForm(form);
  if (errors.length) return back(input.ratings.overall == null ? 'error=overall' : 'error=invalid');

  saveReview(access.registration, user.id, input);
  return back('saved=1');
};
