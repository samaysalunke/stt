import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import {
  upsertAdminUser,
  getUserRoles,
  createAdminSession,
  getUserIdByGoogleId,
  assignRole,
  countOwners,
} from '../../../../lib/admin-session';
import { decodeIdToken, verifyGoogleClaims } from '../../../../lib/googleIdToken';

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect, clientAddress }) => {
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = cookies.get('admin_oauth_state')?.value;

  cookies.delete('admin_oauth_state', { path: '/' });

  if (!code || !state || state !== storedState) {
    return redirect('/admin/login?error=oauth');
  }

  const clientId     = import.meta.env.GOOGLE_CLIENT_ID     ?? process.env.GOOGLE_CLIENT_ID     ?? '';
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? '';
  const redirectUri  = import.meta.env.ADMIN_OAUTH_REDIRECT_URI
    ?? process.env.ADMIN_OAUTH_REDIRECT_URI
    ?? 'http://localhost:4321/api/admin/auth/callback';

  // Exchange code for tokens
  let idToken: string;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.id_token) return redirect('/admin/login?error=oauth');
    idToken = tokenData.id_token;
  } catch {
    return redirect('/admin/login?error=oauth');
  }

  // Decode + verify JWT claims (issuer, audience, expiry, email_verified).
  const claims = decodeIdToken(idToken);
  if (!verifyGoogleClaims(claims, clientId)) {
    return redirect('/admin/login?error=oauth');
  }
  const profile = { sub: claims!.sub, email: claims!.email, name: claims!.name, picture: claims!.picture };

  // Upsert user
  const userId = getUserIdByGoogleId(profile.sub) ?? crypto.randomUUID();
  upsertAdminUser({
    id: userId,
    email: profile.email,
    displayName: profile.name ?? null,
    avatarUrl: profile.picture ?? null,
    googleId: profile.sub,
  });

  // Auto-grant owner to ADMIN_OWNER_EMAIL on first login if no owners exist
  const ownerEmail = import.meta.env.ADMIN_OWNER_EMAIL ?? process.env.ADMIN_OWNER_EMAIL ?? '';
  if (ownerEmail && profile.email === ownerEmail && countOwners() === 0) {
    assignRole({ userId, role: 'owner' });
  }

  // Check role
  const roles = getUserRoles(userId);
  if (roles.length === 0) {
    return redirect('/admin/login?error=no_role');
  }

  const sessionToken = createAdminSession(userId, clientAddress);
  cookies.set('admin_token', sessionToken, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 8,
  });

  return redirect('/admin/');
};
