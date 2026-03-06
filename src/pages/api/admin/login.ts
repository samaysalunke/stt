import type { APIRoute } from 'astro';
import crypto from 'node:crypto';

export const POST: APIRoute = async ({ request, redirect, cookies }) => {
  const body = await request.formData();
  const password = (body.get('password') ?? '').toString();

  const expected = (import.meta.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '');
  if (!expected || password !== expected) {
    return redirect('/admin/login?error=1');
  }

  const token = crypto.createHash('sha256').update(expected).digest('hex');
  cookies.set('admin_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  });

  return redirect('/admin/registrations');
};
