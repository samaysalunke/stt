# Production readiness — canonicalize on `www.seekthethrill.in`

## Context

Two live bugs on production, both verified by probing the running site, plus a
codebase-wide host mismatch. The original question — "why does Google sign-in bounce to
the home page?" — turned out to be a symptom of the host problem, not an OAuth bug.

**Verified production reality** (`curl`, 2026-08-27):

| Probe | Result |
|---|---|
| `https://www.seekthethrill.in/` | `200`, `server: railway-hikari` — **www is what actually serves** |
| `https://seekthethrill.in/` | `301 → https://www.seekthethrill.in/`, `server: cloudflare` |
| `https://seekthethrill.in/api/auth/google` | `301 → https://www.seekthethrill.in/` — **path stripped** |
| `https://www.seekthethrill.in/api/auth/google` | `302 → accounts.google.com`, `redirect_uri=https://www.seekthethrill.in/api/auth/callback` |
| Google authorize w/ **www** redirect_uri | `302` to sign-in — **accepted** |
| Google authorize w/ **apex** redirect_uri | `redirect_uri_mismatch` — apex is *not* registered |
| `https://www.seekthethrill.in/about` | `308 → https://localhost/about/` |
| `<link rel=canonical>` on `/about/` | `https://seekthethrill.in/about/` (apex — a redirecting URL) |
| `sitemap.xml`, `robots.txt` | all apex |

### Bug 1 (site-breaking) — every non-trailing-slash URL 308s to `https://localhost/`

`/about`, `/contact`, `/faq`, `/trips`, `/privacy`, and **every 404** redirect to
`https://localhost/...` and die. Only paths in the `nonIndexablePrefix` skip list
(`src/middleware.ts:84`, e.g. `/leaderboard`) escape.

Cause: the Astro node standalone adapter behind Railway builds `Astro.url` from the
internal socket, so `url.hostname` is `localhost`. `src/middleware.ts:78`
`const target = new URL(url)` inherits that host. Line 80's
`target.hostname === 'www.seekthethrill.in'` therefore never matches (which is why the
www→apex rule looks dead), line 81 flips `http:`→`https:`, lines 88-89 rewrite the path,
and line 92 `redirect(target.toString(), 308)` emits the internal host to the browser.

The middleware already reads the right header for CSRF —
`firstHeaderValue(request.headers.get('x-forwarded-host'))` at line 36 — it just never
uses it to build `target`.

### Bug 2 — Google sign-in from apex lands on the home page

Cloudflare's apex→www redirect rule **discards path and query**. So
`seekthethrill.in/api/auth/google` → `https://www.seekthethrill.in/` = home, clean URL,
no params. The OAuth flow is never entered. Starting from `www` the flow works.

Same rule silently breaks **email unsubscribe links**: `emailTemplates.ts:212,230` emit
`https://seekthethrill.in/unsubscribe?token=…`, which Cloudflare rewrites to the bare
home page — the token is destroyed and unsubscribe never records. That is a compliance
problem, not just a UX one.

### Bug 3 — the codebase declares apex; production serves www

`SITE_URL`, ~45 hardcoded `https://seekthethrill.in` strings, `canonical`/`og:url`,
`sitemap.xml`, `feed.xml`, `robots.txt`, JSON-LD `@id`s, and email links all name apex —
every one of them a URL that 301-strips. Search engines are being handed a canonical that
redirects to a different page than the one indexed.

**Decisions:** canonical host is **`www.seekthethrill.in`** (matches Cloudflare, Railway
`SITE_URL`, `USER_AUTH_REDIRECT_URI`, and Google Console today — code-only change, no
OAuth downtime). The user fixes the Cloudflare rule to preserve path + query.

---

## Manual step (user, in Cloudflare) — do this first

Edit the apex→www **Redirect Rule** so it preserves path and query. Target expression:

```
concat("https://www.seekthethrill.in", http.request.uri)
```

(`http.request.uri` includes path *and* query string; do **not** use
`http.request.uri.path` alone.) Status `301`, preserve query string on. Verify:

```
curl -sI "https://seekthethrill.in/api/auth/google" -o /dev/null \
  -w "%{http_code} %{redirect_url}\n"
# want: 301 https://www.seekthethrill.in/api/auth/google
```

This is required for apex links already in the wild (old emails, backlinks, the current
Google index). The code changes below stop the app from *emitting* apex links, but cannot
repair links that already exist.

---

## Code changes

### 1. New `src/lib/siteUrl.ts` — one source of truth

No such helper exists today (`src/lib/` has no site-url module), which is why the domain
got copy-pasted ~45 times. Add:

```ts
// Canonical public origin. Railway sets SITE_URL; the fallback matches production.
const RAW = process.env.SITE_URL ?? 'https://www.seekthethrill.in';

/** Origin with no trailing slash, e.g. "https://www.seekthethrill.in". */
export const SITE_ORIGIN = new URL(RAW).origin;

/** Canonical hostname, e.g. "www.seekthethrill.in". */
export const SITE_HOST = new URL(RAW).host;

/** Absolutize a path against the canonical origin. */
export const siteUrl = (path: string): string => new URL(path, SITE_ORIGIN).href;
```

Reuse the existing `indexNowUrls` pattern (`src/lib/indexnow.ts:14`) rather than adding a
second absolutizer.

### 2. `src/middleware.ts` — fix the localhost 308 (Bug 1)

Build the canonical target from forwarded headers instead of the internal `url`. Reuse
the existing `firstHeaderValue` helper (line 13):

- Derive the public host: `x-forwarded-host` → `host` → `url.host`.
- Derive the public proto: `x-forwarded-proto` → `url.protocol`.
- Construct `target` from **those**, not from `new URL(url)` (line 78).
- Replace the hardcoded `www.seekthethrill.in` check at line 80 with `SITE_HOST` from the
  new helper, and flip the direction to **apex → www**.
- Guard the whole canonicalization block so it only runs when the resolved public host is
  a real external host — never `localhost`/`127.0.0.1` — so local dev and Railway health
  checks are untouched.
- Keep the single-hop design (host + proto + lowercase + trailing slash folded into one
  308) and the `nonIndexablePrefix` skip list as-is.

Also update `configuredSiteOrigin()` (line 26-32) to use `SITE_ORIGIN`.

### 3. De-hardcode the domain → `SITE_ORIGIN` / `siteUrl()`

Replace the literal in each of these with the helper:

- `src/components/SEO.astro:22` — `siteUrl` const (drives `canonical`, `og:url`,
  `og:image`, `twitter:image`). Can also read `Astro.site`, which `astro.config.mjs:9`
  already derives from `SITE_URL`.
- `src/layouts/BaseLayout.astro:46-67` — `siteId`, `orgId`, `founderId` JSON-LD `@id`s
  plus `url` / `logo`. **Note:** `@id` values are stable identifiers; changing them is a
  one-time re-keying of the entity graph. Acceptable and correct here, since the apex ids
  point at redirecting URLs.
- `src/pages/sitemap.xml.ts:4` and `src/pages/feed.xml.ts:4` — the `SITE` consts.
- `src/lib/indexnow.ts:8-9` — `SITE` and `HOST`.
- `src/lib/emailTemplates.ts:127,212,230` — CTA + **unsubscribe** links (Bug 2's
  compliance half).
- `src/pages/trips/[slug].astro:109-131`, `src/pages/photo-vault/[slug].astro:24-40`,
  `src/pages/faq.astro:23-24`, `src/pages/custom-itineraries.astro:29` — canonicals and
  breadcrumb JSON-LD.
- `src/pages/profile.astro:106-109,307-310` — public share URLs (also the visible
  `seekthethrill.in/u/…` label text).

`public/robots.txt` is static and cannot template — hardcode the www sitemap URL there.

### 4. OAuth hardening (`src/pages/api/auth/*`, `src/pages/api/admin/auth/*`)

- Derive `redirect_uri` from `SITE_ORIGIN`, keeping the env var as an override:
  `USER_AUTH_REDIRECT_URI ?? siteUrl('/api/auth/callback')`. Same for
  `ADMIN_OAUTH_REDIRECT_URI`. This deletes the
  `http://localhost:4321/api/admin/auth/callback` production fallback
  (`admin/auth/google.ts:10`, `admin/auth/callback.ts:30`) and the `''` fallback
  (`auth/google.ts:6`, `auth/callback.ts:22`).
- Replace the three bare error responses in `src/pages/api/auth/callback.ts` (lines 17,
  44, 50) with redirects, mirroring the admin flow
  (`admin/auth/callback.ts:23,44,47,53`): `/login?error=oauth_state` and
  `/login?error=oauth_token`. Wrap the DB upsert + `createUserSession` block (lines 56-90)
  in `try/catch` → `/login?error=oauth_server`, and `console.error` the cause so it
  reaches Railway logs.
- Add `export const prerender = false;` to `src/pages/api/auth/callback.ts` (the admin
  callback has it, the user one does not).
- Add `secure: import.meta.env.PROD` to the `oauth_state` (`auth/google.ts:9-14`) and
  `admin_oauth_state` (`admin/auth/google.ts:13-18`) cookies. Leave cookies host-only —
  do **not** set a `.seekthethrill.in` domain.
- `src/pages/login.astro`: read `Astro.url.searchParams.get('error')` and render a small
  notice above the button so a failure is never a silent bounce again.

### 5. `.env.example` — document reality

Set `SITE_URL=https://www.seekthethrill.in`. Add the vars used in code but undocumented:
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `USER_AUTH_REDIRECT_URI`,
`ADMIN_OAUTH_REDIRECT_URI`, `ADMIN_OWNER_EMAIL`, `EMAIL_FROM`, `RESEND_API_KEY`,
`INDEXNOW_KEY`, `DATA_DIR`, `CONTENT_DIR`, `ENABLE_TEST_ENDPOINTS`. Delete the dead Turso
block (`src/lib/db.ts` uses `better-sqlite3`) and the Gmail-SMTP option
(`src/lib/emailTransport.ts:1-3`: Railway blocks all SMTP ports; Resend/443 only).

### 6. Cosmetic

- `tests/api/security.test.mjs:126,128` — swap the `stt-production-2707.up.railway.app`
  fixture for `www.seekthethrill.in`. **This is the only `stt-production` string in the
  repo**; no Railway host is hardcoded in `src/`.
- `app.js:1` — comment says "Hostinger Node.js hosting"; it's Railway.
- `src/pages/index.astro` — `href="/leaderboard"` is the one internal link missing a
  trailing slash (grep confirmed); add it so it stops taking a redirect hop.

---

## Files touched

`src/lib/siteUrl.ts` (new) · `src/middleware.ts` · `src/components/SEO.astro` ·
`src/layouts/BaseLayout.astro` · `src/pages/sitemap.xml.ts` · `src/pages/feed.xml.ts` ·
`src/lib/indexnow.ts` · `src/lib/emailTemplates.ts` · `src/pages/api/auth/{google,callback}.ts` ·
`src/pages/api/admin/auth/{google,callback}.ts` · `src/pages/login.astro` ·
`src/pages/{faq,custom-itineraries,profile,index}.astro` ·
`src/pages/trips/[slug].astro` · `src/pages/photo-vault/[slug].astro` ·
`public/robots.txt` · `.env.example` · `tests/api/security.test.mjs` · `app.js`

## Verification

**Local**
1. `npm run test:unit` — note `tests/unit/seo.test.ts:56-58` asserts apex IndexNow URLs
   and **must be updated to www** as part of the change.
2. `npm run test:api` (`tests/run.mjs`), then `npm run test:e2e`.
3. `npm run build && npm start`, then confirm the middleware fix does not fire locally:
   `curl -sI localhost:4321/about -o /dev/null -w "%{http_code} %{redirect_url}\n"`
   → a `308` to `http://localhost:4321/about/`, **never** to a bare `https://localhost/`.
4. Simulate the proxy:
   `curl -sI -H "X-Forwarded-Host: www.seekthethrill.in" -H "X-Forwarded-Proto: https" localhost:4321/about`
   → `308 → https://www.seekthethrill.in/about/`.
5. Simulate apex: same command with `X-Forwarded-Host: seekthethrill.in` →
   `308 → https://www.seekthethrill.in/about/`.

**Production, after the Cloudflare fix + redeploy**
6. `curl -sI https://www.seekthethrill.in/about -o /dev/null -w "%{http_code} %{redirect_url}\n"`
   → `308 https://www.seekthethrill.in/about/` (no `localhost`). Repeat for `/contact`,
   `/faq`, `/trips`, `/privacy`, and a 404 path.
7. `curl -sI https://seekthethrill.in/api/auth/google` → `301` preserving the path.
8. Sign in with Google from **both** apex and www → both land `/profile`; `user_session`
   cookie is `Secure; HttpOnly; SameSite=Lax`. Then `/admin/login` → `/admin/`.
9. `curl -s https://www.seekthethrill.in/about/ | grep canonical` → www.
   `curl -s https://www.seekthethrill.in/sitemap.xml | grep -oE 'https://[a-z.]*seekthethrill\.in' | sort -u`
   → www only.
10. Send a test newsletter; confirm the unsubscribe link is www and that clicking it
    actually flips `newsletter_subscribers.status` (the token survives the hop).
11. `GET /api/test/cleanup` and `/api/test/reg-by-email` → `404` (confirms
    `ENABLE_TEST_ENDPOINTS` is unset in prod; gate is `src/lib/testGuard.ts:11`).
12. Resubmit the sitemap in Google Search Console under the www property.

## Out of scope (flagged, not fixed here)

- **Railway Volume**: `src/lib/db.ts:4` (`DATA_DIR`) and Keystatic's local storage hold
  registrations, users, sessions, payments, and CMS YAML. Without a mounted volume these
  are wiped on every deploy. Also keep **replicas = 1** — `better-sqlite3` is
  single-process.
- **Email deliverability**: `emailTransport.ts:19` defaults `EMAIL_FROM` to Resend's
  sandbox `onboarding@resend.dev`, which only delivers to the account owner. Needs
  `seekthethrill.in` verified in Resend plus a real `EMAIL_FROM`.
- **Google Console**: once the Cloudflare rule preserves paths, consider adding the apex
  callback URIs back as a belt-and-braces alias. Not required for www to work.
