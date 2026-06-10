import type { APIRoute } from 'astro';
import { deleteAdminSession } from '../../../lib/admin-session';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  const token = cookies.get('admin_token')?.value;
  if (token) deleteAdminSession(token);
  cookies.delete('admin_token', { path: '/' });
  return redirect('/admin/login');
};
