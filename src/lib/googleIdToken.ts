// Lightweight Google id_token claim verification.
//
// In the authorization-code flow the token arrives directly from Google's token
// endpoint over TLS, so we don't re-verify the RS256 signature here. We DO assert
// the security-relevant claims so a token minted for a different client/issuer, an
// expired token, or an unverified email can't be used to sign in. For full RS256
// signature checking, swap this for google-auth-library's verifyIdToken().

const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

export interface GoogleClaims {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  email_verified?: boolean | string;
  aud?: string;
  iss?: string;
  exp?: number;
}

/** Decode the JWT payload segment. Returns null on malformed input. */
export function decodeIdToken(idToken: string): GoogleClaims | null {
  try {
    const part = idToken.split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf-8')) as GoogleClaims;
  } catch {
    return null;
  }
}

/** True only when issuer, audience, expiry, and email_verified all check out. */
export function verifyGoogleClaims(claims: GoogleClaims | null, expectedAud: string): boolean {
  if (!claims || !claims.sub || !claims.email) return false;
  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) return false;
  if (!expectedAud || claims.aud !== expectedAud) return false;
  if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return false;
  if (claims.email_verified !== true && claims.email_verified !== 'true') return false;
  return true;
}
