import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { siteUrl } from '../../../lib/siteUrl';

export const prerender = false;

export const GET: APIRoute = async ({ cookies, redirect }) => {
  const clientId = import.meta.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const redirectUri =
    import.meta.env.USER_AUTH_REDIRECT_URI ??
    process.env.USER_AUTH_REDIRECT_URI ??
    siteUrl('/api/auth/callback');

  if (!clientId) {
    // Misconfigured environment — fail visibly instead of handing Google a broken URL.
    return redirect('/login?error=oauth_config');
  }

  const state = crypto.randomUUID();
  cookies.set('oauth_state', state, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });

  return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
