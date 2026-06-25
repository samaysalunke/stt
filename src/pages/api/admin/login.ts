import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { rateLimit } from '../../../lib/rateLimit';
import { createAdminSession, assignRole, upsertAdminUser } from '../../../lib/admin-session';

// Constant-time string compare so login timing can't reveal the password.
// Hash both sides to a fixed length first (timingSafeEqual needs equal lengths).
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Password-based login is a fallback path used in tests and local dev.
// In production, remove ADMIN_PASSWORD from env to disable it entirely.
export const POST: APIRoute = async ({ request, redirect, cookies, clientAddress }) => {
  if (!rateLimit(`login:${clientAddress}`, 10, 60 * 60 * 1000)) {
    return redirect('/admin/login?error=1');
  }

  const body = await request.formData();
  const password = (body.get('password') ?? '').toString();

  const expected = (import.meta.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '');
  // No password configured ⇒ fallback login disabled (use Google OAuth in prod).
  if (!expected || !safeEqual(password, expected)) {
    return redirect('/admin/login?error=1');
  }

  // Ensure a test admin user exists in the DB (safe to call repeatedly)
  upsertAdminUser({
    id: 'password-admin',
    email: 'admin@local',
    displayName: 'Admin',
    googleId: 'password-admin-local',
  });
  assignRole({ userId: 'password-admin', role: 'owner' });

  const sessionToken = createAdminSession('password-admin', clientAddress);
  cookies.set('admin_token', sessionToken, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });

  return redirect('/admin/');
};
