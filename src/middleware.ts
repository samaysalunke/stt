import { defineMiddleware } from 'astro:middleware';
import crypto from 'node:crypto';
import { getUserBySession } from './lib/session';

export const onRequest = defineMiddleware(async ({ url, cookies, locals, redirect }, next) => {
  // ── User session (all routes) ──────────────────────────────────────────────
  const userToken = cookies.get('user_session')?.value;
  locals.user = userToken ? (getUserBySession(userToken) ?? null) : null;

  // ── Protect /profile ──────────────────────────────────────────────────────
  if (url.pathname.startsWith('/profile') && !locals.user) {
    return redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  }

  // ── Admin auth (unchanged) ─────────────────────────────────────────────────
  const isAdminRoute =
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/api/admin') ||
    url.pathname.startsWith('/api/uploads') ||
    url.pathname.startsWith('/keystatic');
  const isLoginRoute =
    url.pathname === '/admin/login' ||
    url.pathname.startsWith('/api/admin/login');

  if (isAdminRoute && !isLoginRoute) {
    const token = cookies.get('admin_token')?.value;
    const password = (import.meta.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '');
    const expected = crypto.createHash('sha256').update(password).digest('hex');
    if (!token || token !== expected) return redirect('/admin/login');
  }

  return next();
});
