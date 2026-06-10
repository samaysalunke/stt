import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { getDb } from '../../../lib/db';
import { createUserSession } from '../../../lib/session';
import { assignAutoUsername } from '../../../lib/usernames';

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = cookies.get('oauth_state')?.value;

  // Clear state cookie regardless
  cookies.delete('oauth_state', { path: '/' });

  if (!code || !state || state !== storedState) {
    return new Response('Invalid OAuth state', { status: 400 });
  }

  const clientId = import.meta.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
  const redirectUri = import.meta.env.USER_AUTH_REDIRECT_URI ?? process.env.USER_AUTH_REDIRECT_URI ?? '';

  // Exchange code for tokens
  let tokenData: any;
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    tokenData = await res.json();
  } catch {
    return new Response('Failed to exchange code', { status: 500 });
  }

  if (!tokenData.id_token) {
    return new Response('No id_token in response', { status: 500 });
  }

  // Decode id_token payload (base64url, no signature verification needed at this scale)
  let profile: { sub: string; email: string; name: string; picture: string };
  try {
    const payload = tokenData.id_token.split('.')[1];
    profile = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
  } catch {
    return new Response('Failed to decode id_token', { status: 500 });
  }

  const { sub: googleId, email, name: displayName, picture: avatarUrl } = profile;

  // Upsert user
  const db = getDb();
  let user = db.prepare('SELECT id FROM users WHERE googleId = ?').get(googleId) as { id: string } | undefined;

  if (user) {
    db.prepare(`
      UPDATE users SET displayName = ?, avatarUrl = ?, lastLoginAt = unixepoch()
      WHERE googleId = ?
    `).run(displayName, avatarUrl, googleId);
    // Backfill a username for any existing user that somehow lacks one
    // (assignAutoUsername is a no-op if one is already set).
    assignAutoUsername(user.id, displayName);
  } else {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO users (id, email, displayName, avatarUrl, googleId, lastLoginAt)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(id, email, displayName, avatarUrl, googleId);
    user = { id };
    // Auto-assign a username on first sign-in
    assignAutoUsername(id, displayName);
  }

  // Create session
  const token = createUserSession(user.id);
  const isProd = import.meta.env.PROD;

  cookies.set('user_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60,
    path: '/',
    secure: isProd,
  });

  return redirect('/profile');
};
