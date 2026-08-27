import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { getDb } from '../../../lib/db';
import { createUserSession } from '../../../lib/session';
import { assignAutoUsername } from '../../../lib/usernames';
import { decodeIdToken, verifyGoogleClaims } from '../../../lib/googleIdToken';
import { siteUrl } from '../../../lib/siteUrl';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = cookies.get('oauth_state')?.value;

  // Clear state cookie regardless
  cookies.delete('oauth_state', { path: '/' });

  if (!code || !state || state !== storedState) {
    return redirect('/login?error=oauth_state');
  }

  const clientId = import.meta.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
  const redirectUri =
    import.meta.env.USER_AUTH_REDIRECT_URI ??
    process.env.USER_AUTH_REDIRECT_URI ??
    siteUrl('/api/auth/callback');

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
  } catch (err) {
    console.error('[auth/callback] token exchange failed', err);
    return redirect('/login?error=oauth_token');
  }

  if (!tokenData.id_token) {
    console.error('[auth/callback] no id_token in token response', tokenData?.error ?? tokenData);
    return redirect('/login?error=oauth_token');
  }

  // Decode + verify id_token claims (issuer, audience, expiry, email_verified).
  const claims = decodeIdToken(tokenData.id_token);
  if (!verifyGoogleClaims(claims, clientId)) {
    return redirect('/login?error=oauth_token');
  }

  const { sub: googleId, email, picture: avatarUrl } = claims!;
  const displayName: string = claims!.name ?? '';

  let token: string;
  try {
    // Upsert user
    const db = getDb();
    let user = db.prepare('SELECT id FROM users WHERE googleId = ?').get(googleId) as { id: string } | undefined;

    if (user) {
      db.prepare(`
        UPDATE users SET
          displayName = CASE WHEN displayNameOverride = 1 THEN displayName ELSE ? END,
          avatarUrl = ?, lastLoginAt = unixepoch()
        WHERE googleId = ?
      `).run(displayName, avatarUrl, googleId);
      // Backfill a username for any existing user that somehow lacks one
      // (assignAutoUsername is a no-op if one is already set).
      assignAutoUsername(user.id, displayName);
    } else {
      // A row may already exist for this verified email — e.g. a "contact"
      // account created by a signed-out wishlist submission. Adopt it instead of
      // hitting the users.email UNIQUE constraint (which would throw and bounce
      // the user to /login?error=oauth_server, locking them out permanently).
      const byEmail = db
        .prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
        .get(email) as { id: string } | undefined;
      if (byEmail) {
        db.prepare(`
          UPDATE users SET
            googleId = ?, accountState = 'active',
            displayName = CASE WHEN displayNameOverride = 1 THEN displayName ELSE COALESCE(displayName, ?) END,
            avatarUrl = COALESCE(?, avatarUrl), lastLoginAt = unixepoch()
          WHERE id = ?
        `).run(googleId, displayName, avatarUrl, byEmail.id);
        user = { id: byEmail.id };
        assignAutoUsername(byEmail.id, displayName);
      } else {
        const id = crypto.randomUUID();
        db.prepare(`
          INSERT INTO users (id, email, displayName, avatarUrl, googleId, accountState, lastLoginAt)
          VALUES (?, ?, ?, ?, ?, 'active', unixepoch())
        `).run(id, email, displayName, avatarUrl, googleId);
        user = { id };
        // Auto-assign a username on first sign-in
        assignAutoUsername(id, displayName);
      }
    }

    // Create session
    token = createUserSession(user.id);
  } catch (err) {
    console.error('[auth/callback] failed to persist user/session', err);
    return redirect('/login?error=oauth_server');
  }

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
