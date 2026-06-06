import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { rateLimit } from '../../../lib/rateLimit';

export const POST: APIRoute = async ({ request, redirect, cookies, clientAddress }) => {
  if (!rateLimit(`login:${clientAddress}`, 10, 60 * 60 * 1000)) {
    return redirect('/admin/login?error=1');
  }

  const body = await request.formData();
  const password = (body.get('password') ?? '').toString();

  const expected = (import.meta.env.ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD ?? '');
  if (!expected || password !== expected) {
    return redirect('/admin/login?error=1');
  }

  const token = crypto.createHash('sha256').update(expected).digest('hex');
  cookies.set('admin_token', token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });

  return redirect('/admin/');
};
