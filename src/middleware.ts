import { defineMiddleware } from 'astro:middleware';
import crypto from 'node:crypto';

export const onRequest = defineMiddleware(async ({ url, cookies, redirect }, next) => {
  const isAdminRoute = url.pathname.startsWith('/admin');
  const isLoginRoute =
    url.pathname === '/admin/login' ||
    url.pathname.startsWith('/api/admin/login');

  if (!isAdminRoute || isLoginRoute) return next();

  const token = cookies.get('admin_token')?.value;
  const password = (import.meta.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '');
  const expected = crypto.createHash('sha256').update(password).digest('hex');

  if (!token || token !== expected) return redirect('/admin/login');
  return next();
});
