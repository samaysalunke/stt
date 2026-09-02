# Cloudflare cache setup

Dashboard work for Phase 2d of `PERFORMANCE-PLAN.md`. The code side (Phases 0,
1, 2a, 2b, 2e, 3a) is deployed from the app; this is the half that lives in the
Cloudflare UI and has to be done by hand.

**The ordering below is load-bearing.** Two constraints, both of which cause
silent damage if ignored:

0. **`www` must be proxied by Cloudflare (orange cloud) or none of this does
   anything.** Verified 2026-08-29: the apex `seekthethrill.in` is proxied and
   301s to `www`, but the `www` record itself is **DNS-only** — it CNAMEs to
   `v9gprqct.up.railway.app` and every real pageview goes straight to Railway,
   bypassing the edge entirely. Check before starting:

   ```bash
   curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/ | grep -iE 'cf-ray|server'
   ```

   A proxied response carries `cf-ray` and `server: cloudflare`. If it says
   `server: railway-hikari` with no `cf-ray`, flip the `www` record to proxied
   in Cloudflare → DNS first. Encryption mode must be **Full** or **Full
   (strict)** before you do — on **Flexible** the flip produces an infinite
   redirect loop, because Cloudflare fetches the origin over HTTP and the app
   308s it back to HTTPS.
1. **2a must be deployed and verified before the HTML cache rule goes on.**
   Until the attribution beacon is live, HTML responses can still carry
   `Set-Cookie`, and — worse — the cookie-free responses repeat visitors get are
   exactly the ones the edge would keep and serve to first-time visitors, who
   would then never be attributed at all.
2. **3a must be deployed before the `/images/*` rule goes on.** Before that
   commit the image route sent `immutable` on URLs that get overwritten;
   caching those at the edge makes the bug permanent there too.

---

## 0. Before touching anything

Confirm the origin is already sending the right headers, or the rules below
have nothing to defer to.

**`-H 'Accept: text/html'` is not optional in any of these commands.** The
middleware gates both the cookie path and the cache-header path on the request
advertising `text/html` (`src/middleware.ts:150`, and `:116` on the pre-2a
code) **and** on `request.method === 'GET'`. A bare `curl -sI` fails both: it
sends `Accept: */*` and issues a HEAD, not a GET. It comes back clean no matter
what the origin is doing — it reads as a pass while telling you nothing.

Use `curl -s -D - -o /dev/null -H 'Accept: text/html'` for HTML. The image
checks below are fine as `curl -sI`; that route gates on neither.

```bash
curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/            | grep -iE 'cache-control|cdn-cache-control|set-cookie|vary'
curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/trips/      | grep -i cache-control
curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/profile     | grep -i cache-control   # expect: private, no-store
```

Expected on the two public pages:

```
cache-control: public, max-age=0, s-maxage=300
cdn-cache-control: public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400
vary: Accept-Encoding
```

and **no `set-cookie`**. If a `set-cookie` is present, stop — 2a has not taken
effect and turning caching on will lose attribution for new visitors.

## 1. Environment variables (Railway → service → Variables)

Purging is a no-op until both are set, so an admin edit would stay invisible
for the full five minutes.

| Variable | Value |
|---|---|
| `CF_ZONE_ID` | Cloudflare dashboard → the domain → Overview → right-hand sidebar |
| `CF_PURGE_TOKEN` | My Profile → API Tokens → Create Token → Custom → Permissions: **Zone → Cache Purge → Purge**, Zone Resources: this zone only |

Nothing else needs that token; scope it no wider.

## 2. Cache Rule — HTML

Caching → Cache Rules → Create rule.

- **Name:** `Public HTML`
- **Expression:**
  ```
  (http.host eq "www.seekthethrill.in" and (
     http.request.uri.path eq "/" or
     http.request.uri.path eq "/trips/" or
     http.request.uri.path eq "/about/" or
     http.request.uri.path eq "/faq/" or
     http.request.uri.path eq "/contact/" or
     http.request.uri.path eq "/custom-itineraries/" or
     http.request.uri.path eq "/privacy/" or
     http.request.uri.path eq "/terms/" or
     http.request.uri.path eq "/cancellation/" or
     (starts_with(http.request.uri.path, "/trips/") and not ends_with(http.request.uri.path, "/book")) or
     starts_with(http.request.uri.path, "/photo-vault/")
  ))
  ```
- **Cache eligibility:** Eligible for cache
- **Edge TTL:** **Use cache-control header if present, bypass cache if not**
- **Browser TTL:** Respect origin

Deferring to the origin header is the whole point: it is what makes the
origin's four guards (200 only, no `Set-Cookie`, no session cookie,
allow-listed path) authoritative rather than advisory.

## 3. Cache Rule — bypass on session cookie

Same screen, and it must sort **BELOW** the HTML rule.

> Cloudflare Cache Rules evaluate top to bottom and **the last matching rule
> wins** for a conflicting setting. A logged-in request to `/` matches both this
> rule and the HTML rule, so whichever sits lower decides. Bypass must therefore
> be last. (An earlier version of this checklist said "above", which would have
> let the HTML rule override the bypass and make logged-in pages edge-cacheable
> — the exact leak this rule exists to prevent.)

- **Name:** `Bypass logged-in`
- **Expression:**
  ```
  http.cookie contains "user_session" or http.cookie contains "admin_token"
  ```
- **Cache eligibility:** Bypass cache

The origin also sends `private, no-cache` for these requests. Both layers are
deliberate — a logged-in render embeds the visitor in the header, and a
misconfigured rule would otherwise serve one person's avatar to everyone.

## 4. Cache Rule — build assets

- **Expression:** `starts_with(http.request.uri.path, "/_astro/")`
- **Cache eligibility:** Eligible; **Edge TTL: 1 year**

Safe unconditionally: these filenames are content-hashed by the build.

## 5. Cache Rule — images  ⚠️ only after 3a is deployed

- **Expression:** `starts_with(http.request.uri.path, "/images/")`
- **Cache eligibility:** Eligible; **Edge TTL: 1 year**

Verify 3a is live first:

```bash
curl -sI https://www.seekthethrill.in/images/<some-trip>-featured.webp | grep -i 'cache-control'
```

Must read `public, max-age=86400, stale-while-revalidate=604800` — **not**
`immutable`. If it still says `immutable`, 3a is not deployed; do not add this
rule yet.

## 5b. Cache Rule — self-hosted fonts

- **Expression:** `starts_with(http.request.uri.path, "/fonts/")`
- **Cache eligibility:** Eligible; **Edge TTL: 1 month**

The webfonts moved off fonts.googleapis.com and into `public/fonts/`. That
removed a render-blocking third-party stylesheet, but the files now come from
our origin — and the origin cannot set a useful TTL on them: static assets are
served by the node adapter's handler, which runs before `src/middleware.ts`, so
they leave the origin as `public, max-age=0`. This rule is the only thing giving
them an edge TTL.

**1 month, not 1 year, and not `immutable`.** These filenames are not
content-hashed, so a replaced face has to be able to propagate. If you do swap a
font file, purge `/fonts/*` — nothing purges it automatically.

```bash
curl -sI https://www.seekthethrill.in/fonts/manrope-latin.woff2 | grep -iE 'cf-cache-status|cache-control'
```

## 6. Zone settings

Speed → Optimization, and SSL/TLS → Edge Certificates:

| Setting | Value | Why |
|---|---|---|
| Brotli | On | |
| HTTP/3 (QUIC) | On | |
| Early Hints | On | |
| Tiered Cache (Smart Tiering) | On | Caching → Tiered Cache |
| **Rocket Loader** | **OFF** | It reorders scripts and breaks island hydration |

Pro plan and above only: Polish = **Lossy** with **WebP/AVIF** conversion, and
Mirage on. Polish is what delivers next-gen image formats without any origin
change — it recompresses and converts, but it does **not** resize, so an
oversized file stays oversized in dimensions. Per-viewport sizing needs either
Cloudflare Image Resizing (paid add-on) or the variant pipeline, both of which
are deferred out of this pass.

## 6b. Dashboard traps — read before creating any rule

Both of these cost real time on the first run-through (2026-08-29).

**The expression editor, not the builder.** "Create rule" opens a
Field / Operator / Value builder. Pasting a Wireshark expression into the
**Value** box does not parse it — Cloudflare wraps the whole thing as a literal
string and the Expression Preview reads:

```
(http.request.full_uri wildcard r#"starts_with(http.request.uri.path, "/images/")"#)
```

That matches nothing. The rule deploys, shows **Active**, and is completely
inert. Click **Edit expression** (top-right of the preview) first, then paste.
Correct state is the preview showing your own text with no `full_uri wildcard
r#"` wrapper — and the character count dropping.

Verify from the Cache Rules list rather than the editor: the **Match against**
column shows parsed conditions ("URI Path starts with /_astro/") for a good
rule, and the raw wrapped string for a broken one.

**The "may not apply to your traffic" dialog is a false positive** on rules 3,
4 and 5. Cloudflare tries to extract a hostname from the expression to check for
a proxied DNS record; those rules are path- or cookie-only, so there is nothing
to find. Choose **Ignore and deploy rule anyway**. Never "Create a new proxied
DNS record" — that adds a junk record. Rule 2 does not warn, because it carries
`http.host`.

## 7. Verify

Anonymous, twice each — the second should be a `HIT`:

```bash
for p in / /trips/ /trips/monsoon-meghalaya/; do
  curl -s -D - -o /dev/null -H 'Accept: text/html' "https://www.seekthethrill.in$p" | grep -iE 'cf-cache-status|cache-control|set-cookie'
done
```

Then the cases that must **not** be cached:

```bash
# Logged in -> BYPASS, private no-cache, header avatar still renders
curl -s -D - -o /dev/null -H 'Accept: text/html' -H 'Cookie: user_session=<a real session>' https://www.seekthethrill.in/ | grep -i cf-cache-status

# Unpublished album -> 404 and must not be cached; publish it, request again,
# and it must appear immediately rather than in five minutes.
curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/photo-vault/<unpublished-slug>/
```

**Reading `cf-cache-status` correctly.** Two things look like failures and are
not:

- **Intermittent `MISS` on a page that just returned `HIT`.** A Cloudflare POP
  has many machines, each with its own cache; consecutive requests land on
  different ones. Compare the `cf-ray` suffix — it differs. Repeat 5-8 times and
  look for a majority of `HIT` with a rising `age`, rather than expecting two
  requests to prove anything. Tiered Cache (step 6) reduces this.
- **`DYNAMIC` rather than `BYPASS`** on a logged-in request. The bypass rule is
  still doing the work; Cloudflare simply reports it this way here.

To prove the bypass rule fires **on its own**, rather than the origin's
`private, no-cache` masking an inert rule, send a cookie whose name merely
contains the substring:

```bash
curl -s -D - -o /dev/null -H 'Accept: text/html' -H 'Cookie: xuser_sessionx=1' \
  https://www.seekthethrill.in/ | grep -iE 'cf-cache-status|cache-control'
```

Cloudflare's `contains` matches the substring, but the origin parses a different
cookie name and so sends `public, max-age=0, s-maxage=300`. A cacheable response
that still does not cache proves the rule alone is responsible. (Verified
2026-08-29.) Note this also means the rule bypasses on any cookie *containing*
`user_session` — broader than intended, erring safe.

Behavioural checks:

- Confirm the registration that fills a test trip's last seat → `/` and
  `/trips/` show sold-out within seconds, not minutes. Repeat via
  admin → registrations → create with status `confirmed`, which is the second
  path that moves the counter.
- Edit a trip in admin → the change appears within seconds.
- Re-upload a trip's featured image → it changes in a browser that had the old
  one.

## 8. Also pull, for the PR description

GA4 → Reports → Engagement → Pages: **pageviews/day and the `/` : `/trips/` :
`/trips/<slug>` split**.

This is the one number the plan never had, and it decides how to describe the
work: edge caching improves TTFB for every visitor regardless, but the
origin-load argument only scales with traffic. At a few hundred pageviews a day
the single Node process was never under pressure, and Phase 2 is a latency win
rather than a capacity one. Say which it is rather than implying the other.

## Rollback

In order of preference:

1. Disable the `Public HTML` cache rule — instant, no deploy.
2. Purge everything: Caching → Configuration → Purge Everything.
3. Set `HTML_S_MAXAGE = 0` in `src/middleware.ts` and deploy.
