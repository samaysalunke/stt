import type { APIRoute } from 'astro';
import { deleteUserSession } from '../../../lib/session';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get('user_session')?.value;
  if (token) deleteUserSession(token);
  cookies.delete('user_session', { path: '/' });
  return redirect('/');
};
