import { describe, expect, it } from 'vitest';
import { canonicalRedirect } from '../../src/lib/canonicalRedirect';

/**
 * The middleware's canonical redirect, pinned across the Astro 5 → 7 change in
 * how `url` is built. Astro 5 took the host from Host (or X-Forwarded-Host)
 * unconditionally. Astro 7 does so only when the host matches
 * `security.allowedDomains`, and otherwise falls back to localhost:<port>. The
 * redirect must come out the same either way.
 */
const ALLOWED = new Set(['www.seekthethrill.in', 'seekthethrill.in', 'stt-production-4ae5.up.railway.app']);
const PORT = 8080;

type Headers = Record<string, string>;

let serverPort = PORT;

function astro5Url(path: string, headers: Headers): URL {
  const proto = headers['x-forwarded-proto'] || 'http';
  const host = headers['x-forwarded-host'] ?? headers.host ?? 'localhost';
  return new URL(path, `${proto}://${host}`);
}

function astro7Url(path: string, headers: Headers): URL {
  const host = headers['x-forwarded-host'] ?? headers.host;
  const trusted = host && ALLOWED.has(host);
  const proto = /^https?$/.test(headers['x-forwarded-proto'] ?? '') ? headers['x-forwarded-proto'] : 'http';
  return new URL(path, trusted ? `${proto}://${host}` : `http://localhost:${serverPort}`);
}

function redirectFor(build: (path: string, h: Headers) => URL, path: string, headers: Headers, prod = true) {
  const url = build(path, headers);
  return canonicalRedirect(url, new Request(url, { headers }), prod);
}

/** Follow a redirect the way the edge would deliver it back to us. */
function followed(target: string, prod = true): string | null {
  const t = new URL(target);
  const headers = { host: t.host, 'x-forwarded-proto': t.protocol.replace(':', '') };
  return redirectFor(astro7Url, `${t.pathname}${t.search}`, headers, prod);
}

const CASES: Array<{ name: string; path: string; headers: Headers; prod?: boolean; port?: number; expected: string | null }> = [
  { name: 'allowed host, https, canonical path', path: '/trips/', headers: { host: 'www.seekthethrill.in', 'x-forwarded-proto': 'https' }, expected: null },
  { name: 'allowed host, https, wrong case and no slash', path: '/Trips', headers: { host: 'www.seekthethrill.in', 'x-forwarded-proto': 'https' }, expected: 'https://www.seekthethrill.in/trips/' },
  { name: 'allowed host, http', path: '/trips/', headers: { host: 'www.seekthethrill.in', 'x-forwarded-proto': 'http' }, expected: 'https://www.seekthethrill.in/trips/' },
  { name: 'apex host, https', path: '/trips/', headers: { host: 'seekthethrill.in', 'x-forwarded-proto': 'https' }, expected: 'https://www.seekthethrill.in/trips/' },
  { name: 'apex host, http, no slash — still one hop', path: '/trips', headers: { host: 'seekthethrill.in', 'x-forwarded-proto': 'http' }, expected: 'https://www.seekthethrill.in/trips/' },
  { name: 'railway service domain, https', path: '/trips/', headers: { host: 'stt-production-4ae5.up.railway.app', 'x-forwarded-proto': 'https' }, expected: null },
  { name: 'foreign host, https, canonical path', path: '/trips/', headers: { host: 'evil.example', 'x-forwarded-proto': 'https' }, expected: null },
  { name: 'foreign host, http — no internal port in the target', path: '/trips/', headers: { host: 'evil.example', 'x-forwarded-proto': 'http' }, expected: 'https://evil.example/trips/' },
  { name: 'foreign X-Forwarded-Host over an allowed Host', path: '/trips/', headers: { host: 'www.seekthethrill.in', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }, expected: null },
  { name: 'internal health check, no forwarded headers', path: '/trips/', headers: { host: `localhost:${PORT}` }, expected: null },
  { name: 'dev server keeps its port', path: '/Trips', headers: { host: 'localhost:4321' }, prod: false, port: 4321, expected: 'http://localhost:4321/trips/' },
  { name: 'non-indexable paths keep their shape', path: '/admin/login', headers: { host: 'www.seekthethrill.in', 'x-forwarded-proto': 'https' }, expected: null },
  { name: 'files keep their shape', path: '/Robots.TXT', headers: { host: 'www.seekthethrill.in', 'x-forwarded-proto': 'https' }, expected: null },
];

describe('canonical redirect', () => {
  for (const c of CASES) {
    it(c.name, () => {
      serverPort = c.port ?? PORT;
      const a7 = redirectFor(astro7Url, c.path, c.headers, c.prod);
      expect(a7).toBe(c.expected);
      // Astro 5 built `url` from Host for every request; the answer must not depend on which.
      expect(redirectFor(astro5Url, c.path, c.headers, c.prod)).toBe(a7);
      // One hop: following the redirect lands on a canonical URL, never a loop.
      if (a7) expect(followed(a7, c.prod ?? true)).toBeNull();
    });
  }

  it('never redirects a POST', () => {
    // A 308 replays the body at the new URL; form posts keep their own shape.
    const headers = { host: 'seekthethrill.in', 'x-forwarded-proto': 'http' };
    const url = astro7Url('/Trips', headers);
    expect(canonicalRedirect(url, new Request(url, { method: 'POST', headers }), true)).toBeNull();
  });
});
