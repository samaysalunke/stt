import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete('admin_token', { path: '/' });
  return redirect('/admin/login');
};
