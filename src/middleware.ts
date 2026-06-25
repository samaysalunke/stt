import { defineMiddleware } from 'astro:middleware';
import { getUserBySession } from './lib/session';
import { getAdminBySession } from './lib/admin-session';
import { getDb } from './lib/db';

export const onRequest = defineMiddleware(async ({ url, request, cookies, locals, redirect }, next) => {
  // One canonical public origin and path shape, resolved in a SINGLE hop:
  // host (www→apex) + protocol (http→https) + lowercase + trailing slash are
  // all folded into one target before redirecting. Keep local/preview hosts
  // untouched; never redirect non-GET requests (form posts) or asset paths.
  const target = new URL(url);
  if (import.meta.env.PROD) {
    if (target.hostname === 'www.seekthethrill.in') target.hostname = 'seekthethrill.in';
    if (target.protocol === 'http:') target.protocol = 'https:';
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    const nonIndexablePrefix = ['/admin', '/api', '/keystatic', '/profile', '/login', '/unsubscribe', '/leaderboard', '/u/'];
    const canonicalizable = !nonIndexablePrefix.some((prefix) => url.pathname.startsWith(prefix)) && !url.pathname.endsWith('/book');
    const isFile = !!url.pathname.split('/').pop()?.includes('.');
    if (canonicalizable && !isFile) {
      target.pathname = target.pathname.toLowerCase();
      if (target.pathname !== '/' && !target.pathname.endsWith('/')) target.pathname = `${target.pathname}/`;
    }
  }
  if (target.href !== url.href) return redirect(target.toString(), 308);

  // Ensure DB is initialized on first request so schema migrations run early
  getDb();

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
    const isAnalyticsApi = url.pathname.startsWith('/api/admin/analytics');
    if (!token) {
      if (isAnalyticsApi) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      return redirect('/admin/login');
    }

    const adminUser = getAdminBySession(token);
    if (!adminUser) {
      // Clear stale cookie
      cookies.delete('admin_token', { path: '/' });
      if (isAnalyticsApi) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      return redirect('/admin/login');
    }

    locals.adminUser = adminUser;

    // Role-based access guards
    const path = url.pathname;

    // owner-only: role management, audit log, trip creation/deletion
    const ownerOnly = [
      '/admin/settings/roles',
      '/admin/audit',
      '/admin/analytics',
      '/api/admin/analytics',
      '/api/admin/roles',
      '/api/admin/trips/create',
      '/api/admin/trips/delete',
      '/api/admin/trips/duplicate',
    ];
    // trip_lead cannot access trips management or most write actions
    const ownerOrOpsOnly = [
      '/admin/trips',
      '/api/admin/trips',
      // Creating/importing registrations is a payment-data action — owner/ops only.
      // (The bare /admin/registrations list stays viewable by trip_lead, scoped.)
      '/admin/registrations/new',
      '/admin/registrations/import',
      '/api/admin/registrations',
    ];

    if (ownerOnly.some(p => path.startsWith(p)) && adminUser.role !== 'owner') {
      if (path.startsWith('/api/admin/')) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      if (path.startsWith('/admin/analytics')) return redirect('/admin');
      return new Response('Access denied', { status: 403 });
    }
    if (ownerOrOpsOnly.some(p => path.startsWith(p)) && adminUser.role === 'trip_lead') {
      return new Response('Access denied', { status: 403 });
    }
  } else {
    locals.adminUser = null;
  }

  const response = await next();
  const privateRoute =
    url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/keystatic/') || url.pathname.startsWith('/profile/') ||
    url.pathname.startsWith('/login/') || url.pathname.startsWith('/unsubscribe/');
  if (!privateRoute) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
