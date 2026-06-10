import { defineMiddleware } from 'astro:middleware';
import { getUserBySession } from './lib/session';
import { getAdminBySession } from './lib/admin-session';

export const onRequest = defineMiddleware(async ({ url, cookies, locals, redirect }, next) => {
  // ── User session (all routes) ──────────────────────────────────────────────
  const userToken = cookies.get('user_session')?.value;
  locals.user = userToken ? (getUserBySession(userToken) ?? null) : null;

  // ── Protect /profile ──────────────────────────────────────────────────────
  if (url.pathname.startsWith('/profile') && !locals.user) {
    return redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
  }

  // ── Admin auth ─────────────────────────────────────────────────────────────
  const isAdminRoute =
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/api/admin') ||
    url.pathname.startsWith('/api/uploads') ||
    url.pathname.startsWith('/keystatic');

  // Auth endpoints that are always public
  const isAuthRoute =
    url.pathname === '/admin/login' ||
    url.pathname.startsWith('/api/admin/login') ||
    url.pathname.startsWith('/api/admin/auth/');

  if (isAdminRoute && !isAuthRoute) {
    const token = cookies.get('admin_token')?.value;
    if (!token) return redirect('/admin/login');

    const adminUser = getAdminBySession(token);
    if (!adminUser) {
      // Clear stale cookie
      cookies.delete('admin_token', { path: '/' });
      return redirect('/admin/login');
    }

    locals.adminUser = adminUser;

    // Role-based page guards
    const ownerOnlyPages = [
      '/admin/settings/roles',
      '/admin/audit',
      '/api/admin/roles',
    ];
    const ownerOrOpsOnly = [
      '/admin/trips',
      '/api/admin/trips',
    ];

    const path = url.pathname;
    if (ownerOnlyPages.some(p => path.startsWith(p)) && adminUser.role !== 'owner') {
      return new Response('Access denied', { status: 403 });
    }
    if (ownerOrOpsOnly.some(p => path.startsWith(p)) && adminUser.role === 'trip_lead') {
      return new Response('Access denied', { status: 403 });
    }
  } else {
    locals.adminUser = null;
  }

  return next();
});
