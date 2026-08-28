import { defineMiddleware } from 'astro:middleware';
import { getUserBySession } from './lib/session';
import { getAdminBySession } from './lib/admin-session';
import { getDb } from './lib/db';
import { SITE_HOST, SITE_ORIGIN } from './lib/siteUrl';
import { attributionCookieNames, attributionFromRequest, hasCampaignTouch } from './lib/attribution';

/** Hosts that only ever appear on the internal proxy hop, never in a browser. */
function isInternalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)(:\d+)?$/i.test(host);
}

const CSRF_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_CONTENT_TYPES = [
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
];

function firstHeaderValue(value: string | null): string | null {
  return value?.split(',')[0]?.trim() || null;
}

function originFrom(proto: string | null, host: string | null): string | null {
  if (!proto || !host) return null;
  try {
    return new URL(`${proto.replace(/:$/, '')}://${host}`).origin;
  } catch {
    return null;
  }
}

function configuredSiteOrigin(): string | null {
  return SITE_ORIGIN;
}

function allowedRequestOrigins(url: URL, request: Request): Set<string> {
  const forwardedProto = firstHeaderValue(request.headers.get('x-forwarded-proto'));
  const forwardedHost = firstHeaderValue(request.headers.get('x-forwarded-host'));
  const host = firstHeaderValue(request.headers.get('host'));
  const origins = [
    url.origin,
    configuredSiteOrigin(),
    originFrom(forwardedProto, forwardedHost),
    originFrom(forwardedProto, host),
  ].filter(Boolean) as string[];

  return new Set(origins);
}

function shouldCheckCsrf(request: Request): boolean {
  if (!CSRF_METHODS.has(request.method.toUpperCase())) return false;
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  return CSRF_CONTENT_TYPES.some((type) => contentType.startsWith(type));
}

function assertSameOriginPost(url: URL, request: Request): Response | null {
  if (!shouldCheckCsrf(request)) return null;

  const origin = request.headers.get('origin');
  if (!origin) return null;

  if (!allowedRequestOrigins(url, request).has(origin)) {
    return new Response('Cross-site POST form submissions are forbidden', {
      status: 403,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    });
  }

  return null;
}

export const onRequest = defineMiddleware(async ({ url, request, cookies, locals, redirect }, next) => {
  const csrfResponse = assertSameOriginPost(url, request);
  if (csrfResponse) return csrfResponse;

  // One canonical public origin and path shape, resolved in a SINGLE hop:
  // host (apex→www) + protocol (http→https) + lowercase + trailing slash are
  // all folded into one target before redirecting. Railway terminates TLS at
  // the edge and proxies to the container on http://localhost, so `url` here
  // carries the INTERNAL host — the browser-facing host/proto live in the
  // x-forwarded-* headers. Build the redirect target from those, or every
  // canonicalized URL 308s to https://localhost/… and dies.
  const fwdHost =
    firstHeaderValue(request.headers.get('x-forwarded-host')) ??
    firstHeaderValue(request.headers.get('host')) ??
    url.host;
  const fwdProto = (
    firstHeaderValue(request.headers.get('x-forwarded-proto')) ?? url.protocol
  ).replace(/:$/, '');
  const publicHost = isInternalHost(url.host) && isInternalHost(fwdHost) ? url.host : fwdHost;
  const externalRequest = !isInternalHost(publicHost);

  const target = new URL(url);
  target.host = publicHost;
  target.protocol = `${fwdProto}:`;
  // Compare against the URL as the browser actually sees it, not the internal one.
  const publicHref = target.href;

  if (import.meta.env.PROD && externalRequest && (request.method === 'GET' || request.method === 'HEAD')) {
    if (target.hostname === SITE_HOST.replace(/^www\./, '')) target.host = SITE_HOST;
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
  if (target.href !== publicHref) return redirect(target.toString(), 308);

  // Server-side first/latest-touch capture survives client navigation and is
  // available to every conversion API without trusting form-supplied values.
  const isPublicDocument = request.method === 'GET' &&
    (request.headers.get('accept') ?? '').includes('text/html') &&
    !url.pathname.startsWith('/admin') && !url.pathname.startsWith('/api');
  if (isPublicDocument) {
    const touch = attributionFromRequest(url, request);
    const cookieOptions = {
      path: '/', httpOnly: true, sameSite: 'lax' as const,
      secure: import.meta.env.PROD, maxAge: 60 * 60 * 24 * 90,
    };
    if (!cookies.get(attributionCookieNames.first)) {
      cookies.set(attributionCookieNames.first, JSON.stringify(touch), cookieOptions);
    }
    if (!cookies.get(attributionCookieNames.latest) || hasCampaignTouch(touch, SITE_ORIGIN)) {
      cookies.set(attributionCookieNames.latest, JSON.stringify(touch), cookieOptions);
    }
  }

  // Ensure DB is initialized on first request so schema migrations run early
  getDb();

  // ── User session (all routes) ──────────────────────────────────────────────
  const userToken = cookies.get('user_session')?.value;
  locals.user = userToken ? (getUserBySession(userToken) ?? null) : null;

  // ── Protect /profile ──────────────────────────────────────────────────────
  if (url.pathname.startsWith('/profile') && !locals.user) {
    return redirect(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
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
      '/admin/email-logs',
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
  const headers = new Headers(response.headers);

  // ── Baseline security headers (all routes) ─────────────────────────────────
  // Stop MIME sniffing (matters for same-origin user uploads) and trim referrer.
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (import.meta.env.PROD) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Admin/CMS must never be framed (clickjacking on privileged actions).
  const adminUi =
    url.pathname.startsWith('/admin') || url.pathname.startsWith('/keystatic') ||
    url.pathname.startsWith('/api/admin');
  if (adminUi) {
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Content-Security-Policy', "frame-ancestors 'none'");
  }

  // Keep private surfaces out of search indexes.
  const privateRoute =
    url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/keystatic/') || url.pathname === '/profile' || url.pathname.startsWith('/profile/') ||
    url.pathname.startsWith('/login/') || url.pathname.startsWith('/unsubscribe/');
  if (privateRoute) headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (url.pathname === '/profile' || url.pathname.startsWith('/profile/')) {
    headers.set('Cache-Control', 'private, no-store');
  }

  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
