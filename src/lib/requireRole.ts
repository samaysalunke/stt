import type { AdminUser } from './admin-session';

type Role = AdminUser['role'];

// Per-handler authorization guard. Middleware gates admin routes by path prefix
// (defense-in-depth), but every mutating endpoint must also assert role here so
// a path the allowlist misses can't be reached by a lower-privilege admin.
//
// Returns a 403 Response to return early, or null when the actor is allowed.
export function requireRole(
  locals: App.Locals,
  allowed: Role[],
): Response | null {
  const role = locals.adminUser?.role;
  if (!role) {
    return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!allowed.includes(role)) {
    return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}
