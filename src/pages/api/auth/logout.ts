import type { APIRoute } from 'astro';
import { deleteUserSession } from '../../../lib/session';
import { safeProfileReturn } from '../../../lib/authReturn';

export const POST: APIRoute = async ({ cookies, redirect, request }) => {
  const token = cookies.get('user_session')?.value;
  if (token) deleteUserSession(token);
  cookies.delete('user_session', { path: '/' });
  // "Switch Google account" (e.g. on a review form opened while signed in as
  // someone else): sign out, then straight back to sign-in for that page.
  const form = await request.formData().catch(() => null);
  const next = form?.get('next');
  if (typeof next === 'string' && next) return redirect(`/login?next=${encodeURIComponent(safeProfileReturn(next))}`);
  return redirect('/');
};
