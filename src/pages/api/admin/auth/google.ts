import type { APIRoute } from 'astro';
import crypto from 'node:crypto';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, redirect }) => {
  const clientId = import.meta.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const redirectUri = import.meta.env.ADMIN_OAUTH_REDIRECT_URI
    ?? process.env.ADMIN_OAUTH_REDIRECT_URI
    ?? 'http://localhost:4321/api/admin/auth/callback';

  const state = crypto.randomUUID();
  cookies.set('admin_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
