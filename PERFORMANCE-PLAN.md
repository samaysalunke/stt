# Performance Plan v2 — Seek the Thrill

> Supersedes the draft `PERFORMANCE-PLAN.md`. Every `file:line` below was re-verified against the working tree on 2026-08-29. Claims the draft got wrong are corrected inline and listed in the appendix.

## Implementation status (2026-08-29, branch `perf/edge-cache-chain`)

| Phase | Status |
|---|---|
| 0 — Measure | **Shipped.** `WebVitals.astro`, `PERF_TIMING=1` server + loader timing, `lighthouserc.json` + `npm run perf:lhci`. |
| 1 — Content cache | **Shipped.** `contentCache.ts`, `app_meta` table, loaders wrapped, `resolveBooking` memo, `card.departures`, seeded shuffle. Shipped without waiting for Phase 0 telemetry, by decision. |
| 2a — Attribution beacon | **Shipped.** `POST /api/attribution` + once-per-session beacon; middleware cookie block removed. |
| 2b — Cache-Control | **Shipped.** All four guards in `src/middleware.ts`; every branch verified against a live server. |
| 2c — Prerender | Cut by this plan. Not implemented. |
| 2d — Cloudflare dashboard | **Not code.** Checklist in `docs/cloudflare-cache-setup.md`; ordering constraints noted there. |
| 2e — Purge on write | **Shipped.** `cachePurge.ts` + all three seat-count paths, all content endpoints, missing IndexNow pings folded in. |
| 3a — Image headers | **Shipped.** `immutable` bug fixed, ETag/Last-Modified + 304, streaming, single stat, purge at the overwrite sites. |
| 3b / 3c / 3d, 4, 5 | **Not started.** When 3b happens it is Track A (Polish) + `ResponsiveImage.astro`, not the Track B variant pipeline. |

Three claims in this document were found to be wrong during implementation and are corrected inline below: the I4 caller list, the §3a overwrite-site table, and the §2e purge list. Each correction is marked with a blockquote.

## Context

`seekthethrill.in` is an Astro 5 SSR app (`astro.config.mjs:10` `output: 'server'`, `:26` `@astrojs/node` standalone) on Railway behind Cloudflare. Cloudflare currently does the apex→www redirect and nothing else — **no HTML caching, no image caching at the edge**. Every public request is a fresh SSR render on one Node process, and every render re-reads the content from disk.

The first draft of this plan was well-architected but built four steps on unverified premises. This version keeps the architecture (in-process cache → edge cache → images → assets → DB), fixes those four steps, and re-sizes the payoff against measurements rather than estimates.

**Intended outcome:** public HTML served from the Cloudflare edge on the overwhelming majority of requests; origin renders only on revalidation and costs materially less when it does; LCP and CLS improved on the three pages that matter (`/`, `/trips/`, `/trips/[slug]`) — with no user-visible behaviour change and no new staleness on anything involving seats or money.

### What is actually measured vs. estimated

Being explicit, because the draft was not:

| Fact | Status |
|---|---|
| Content corpus = **38 YAML files, 42,330 bytes, 13 trips** (`src/content/`) | **Measured** |
| `resolveBooking()` runs **4× per trip** on `/`, **3×** on `/trips/` | **Verified by call-site count** |
| `readSiteSettings()` runs **2–3× per page render** | **Verified by call-site count** |
| Zero caching in any content loader; zero `Cache-Control` on public HTML | **Verified** |
| Server render time, TTFB, LCP, bundle sizes | **Not measured — Phase 0 exists to measure them** |
| **Request volume** (pageviews/day, and the `/` : `/trips/` : `/trips/[slug]` split) | **Unknown — pull from GA4 before Phase 2** |

Request volume is the one input that decides how much Phase 2 is worth, and neither version of this plan had it. Edge caching improves TTFB for every visitor regardless, but the *origin-load* argument scales with traffic: at a few hundred pageviews/day the single Node process is not under pressure and Phase 2 is a latency play, not a capacity one. Pull the numbers from GA4 in Phase 0 and say which it is in the PR description.

The draft claimed the content layer was one of "two structural costs [that] dominate" and promised an order-of-magnitude cut from it. At 42KB of YAML that is not credible: parsing is single-digit milliseconds. **The order of magnitude comes from Phase 2 (edge caching removes the render entirely on a HIT).** Phase 1 is worth doing because it is cheap, low-risk, and cuts the cost of the renders that still happen — not because it is the headline.

---

## Correctness invariants

These are cross-cutting. Violating any one produces a user-visible bug, so they are stated once here and referenced from the phases.

**I1 — Never cache a response that carries `Set-Cookie`.** A shared cache would hand one visitor's cookie to everyone.

**I2 — Never cache a non-200.** `src/pages/photo-vault/[slug].astro:11` returns a bare `404` for an unpublished album; `trips/[slug].astro` does the same for unknown slugs. Caching those means publishing an album looks broken for the full TTL.

**I3 — Never cache a logged-in render.** `BaseLayout.astro:33` reads `Astro.locals.user` and `:136-138` passes it to `<Header>`, so HTML differs per visitor. Handled by a cookie-bypass rule at the edge *and* a `private, no-cache` header at the origin — belt and braces, because a rule misconfiguration would otherwise leak a header avatar.

**I4 — Anything that changes seat counts must purge.** `adjustBookingCount` (`src/lib/registrationWrite.ts:40-76`) writes `bookedSpots` / `currentBookings` via `writeTrip`. The public `/api/register.ts` does **not** touch seat counts, so every such write is admin-triggered and bounded in frequency — but it is the one staleness case that changes a sold-out badge and a live CTA.

> **Corrected during implementation (2026-08-29).** This section previously claimed `update-registration.ts:206,208` were the *only* callers, and that `api/admin/registrations/{create,import}.ts` "never move the counter at all". Both are wrong. `createRegistration` (`registrationWrite.ts:147`) calls `adjustBookingCount` at `:218` whenever a registration is created at status `confirmed`, and it is reached from `registrations/create.ts:82` and `registrations/import.ts:105`. There are **three** seat-count write paths, all three now purge, and the "worth a ticket" note that followed is moot. The two live calls in `update-registration.ts` are at `:204,206`, not `:206,208`.

**I5 — Cached objects are read-only.** `adjustBookingCount` does `readTrip → mutate in place → writeTrip`, and `registrationWrite.ts:35-38` carries an explicit **ATOMICITY INVARIANT** comment requiring the whole function stay synchronous so the read-modify-write completes in one tick. Caching `readTrip` would hand it a shared object and put that documented invariant at the mercy of cache-eviction ordering — and a dev-mode deep-freeze (§1a) would throw on the mutation outright. See §1a.

---

## Phase 0 — Measure (do first, blocks nothing)

Nothing in Phases 1–5 is safe to size without this.

- **`src/components/WebVitals.astro`**, `client:idle`, using the `web-vitals` package. Report LCP/CLS/INP/TTFB to the existing GA4 via `gtag('event', metric.name, { value: Math.round(metric.value), metric_id: metric.id })`. Gate on `analyticsEnabled` exactly as `BaseLayout.astro:44` already computes it (PROD && !admin) — reuse that variable, do not re-derive.
- **Server-side timing.** Wrap `listTrips()` / `readSiteSettings()` and the full `await next()` in `src/middleware.ts:215` with `performance.now()` behind an `env` flag, and log to stdout. One deploy, a day of Railway logs, and Phase 1's real value stops being a guess.
- **Baseline capture** for the PR description: `dist/client/_astro` bundle sizes, `curl -w '%{time_starttransfer}\n' -o /dev/null -s` against `/`, `/trips/`, `/trips/<real-slug>` in production, and **GA4 pageviews/day with the per-page split** (see the volume note above).
- **Lighthouse: local only.** `npx @lhci/cli autorun` against `astro build && astro preview`, as an npm script. **Do not** scope CI into this phase — the repo has **zero** `.github/workflows`, so "wire it into CI" is greenfield work, not a tweak. Test runners that do exist: vitest (`vitest.config.ts`), a custom node runner (`tests/run.mjs`), and Playwright (`playwright.config.ts`, chromium, `webServer: npm run dev`). `npm run test` chains all three (`package.json:12`).

**Verify:** web-vitals events in GA4 Realtime after one deploy; `lhci autorun` produces a local report; server-timing lines in Railway logs.

**Rollback:** delete the island and the npm script.

---

## Phase 1 — In-process content caching

Cheap and low-risk. Cuts the cost of every origin render that survives Phase 2.

**Gate on Phase 0.** Splitting this by whether it needs justification:

- **§1c and §1d ship unconditionally.** Removing a redundant `resolveBooking` call and seeding an existing `random` parameter are strictly-better edits. §1c's `WeakMap` counts here too: it is keyed on object identity, holds no invalidation logic, and its entries die with the trip objects — so on its own it is a per-render memo with *zero* staleness surface.
- **§1a + §1b (the cache itself) ship only if Phase 0's server timing shows loader cost is a non-trivial share of render time.** If YAML parsing turns out to be ~2ms against a 40ms render, a cache with version counters, TTLs and an immutability contract is complexity bought for nothing. Do not skip this check because the draft asserted the cost was dominant — that assertion is what the 42KB measurement disproved.

### 1a. `src/lib/contentCache.ts` (new)

Two invalidation signals, not three. The draft proposed version + TTL + content-dir mtime, then noted in its own text that mtime is useless because `fs.writeFileSync` to an existing path does not change directory mtime. It is dead weight — drop it.

- **`getContentVersion(): number` / `bumpContentVersion(): void`** — a monotonic counter, the authoritative invalidator. Persist it in SQLite so it survives restarts; this needs a new one-row table (`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)`) added to the migrations in `src/lib/db.ts` — there is no existing key-value table to reuse. Call `bumpContentVersion()` inside the five writers themselves, not at their call sites: `writeTrip` (`trips.ts:101`), `writeTestimonial` (`testimonials.ts:31`), `writeFaq` (`faqs.ts:25`), `writeSettings` (`settings.ts:9`), `softDeleteTrip` (`tripDeletions.ts:19`), plus `writeAlbum` (`albums.ts:34`). Verified: **every** content write in `src/` funnels through these — including the booking path (I4), which is why hooking the writer rather than the endpoint matters.
- **`cachedRead<T>(key, loader): T`** — module `Map`, busted when the version changes **or** a 30s TTL elapses. The TTL is the backstop for out-of-band writes: `scripts/reconcile-booked.mjs --apply` rewrites trip YAML from outside the app process.
- **In dev only**, deep-freeze the cached value to surface accidental mutation immediately.

> The draft justified the TTL with Keystatic. **Keystatic is not mounted:** `astro.config.mjs:27` is `integrations: [react()]` only, there is no `src/pages/keystatic/[...params].astro`, and the `/keystatic` guards in `src/middleware.ts:105,151,228,238` are dead paths. `keystatic.config.tsx` and the deps exist but write nothing. If it is ever mounted it *would* bypass `src/lib` writers — note it as a future hazard, not a present one.

**I5 — `readTrip` is explicitly excluded from `cachedRead`.** `registrationWrite.ts:49-72` reads a trip, mutates the returned object, and writes it back. With a shared cached object, two concurrent bookings would read the same instance and one seat increment would be silently lost. Put this in a code comment at the exclusion, not just here.

*(The draft flagged `normalizeItineraryPhotos()` instead. That one is harmless — verified callable only from `api/admin/trips/{create,update,import}.ts`, never on a read path.)*

### 1b. Wrap the hot loaders — signatures unchanged

`listTrips()` (`trips.ts:10`), `listTestimonials()` (`testimonials.ts:3`), `listFaqs()` (`faqs.ts:3`), `readSiteSettings()` (`settings.ts:3`), `listDeletedSlugs()` (`tripDeletions.ts:6` — a `SELECT` re-prepared on every `listTrips`, `trips.ts:12`).

`readSiteSettings()` is the biggest single win here and the draft undercounted it: it runs at `BaseLayout.astro:37`, **again** in `Footer.astro:5` (rendered by `BaseLayout.astro:146`), and **again** in most pages (`index.astro:17`, `trips/[slug].astro:38`, `about.astro:10`, `contact.astro:7`, `privacy.astro:7`, `terms.astro:7`, `cancellation.astro:8`, `profile.astro:34`, `trips/[slug]/book.astro:49`, `LegalPageLayout.astro:26`) — 2–3 full `existsSync` + `readFileSync` + `YAML.parse` per page.

`listFaqs()` (`faqs.ts:14`) and `resolveTripFaqs()` (`faqs.ts:61`) already sort fresh copies — safe to cache as-is, keep it that way.

### 1c. Memoize booking resolution

`resolveBooking(trip)` (`trips.ts:324`) and `tripCardSummary(trip)` (`trips.ts:396`, which itself calls `resolveBooking` at `:408`) are pure over the trip object. Add a module `WeakMap<object, ResolvedBooking>`.

Verified call counts — the draft said 2–3×, it is worse:

| Page | `resolveBooking` per trip | Sites |
|---|---|---|
| `/` | **4×** | `trips.ts:29` (ranking), `index.astro:11` (filter), `index.astro:113` (`card`), `index.astro:134` (`departures`) |
| `/trips/` | **3×** | `trips.ts:29`, `trips/index.astro:52`, `trips/index.astro:72` |

One of those is free to remove with no cache at all. `index.astro:134` is `departures={resolveBooking(trip).departures}`, inside the same `.map()` block where `const card = tripCardSummary(trip)` already exists (`:113`). `tripCardSummary` already holds the answer: it computes `const booking = resolveBooking(trip)` at `trips.ts:408` and simply doesn't return `departures`. Add `departures: ResolvedDeparture[]` to its return type (`trips.ts:396-407`) and `departures: booking.departures` to the returned object (`:436-445`), then `index.astro:134` becomes `departures={card.departures}`. Two lines in `trips.ts`, one in `index.astro`, one fewer full resolve per trip. Do that edit *and* the WeakMap; the memo then also covers the ranking pass at `trips.ts:29`.

(The exposed array is the same reference `resolveBooking` returns — read-only at every consumer, consistent with I5.)

**Staleness note for the code comment:** the WeakMap alone introduces none — its keys are the trip objects, which `listTrips()` re-creates every call. Staleness appears only *if §1b ships*, because then the same objects persist for the cache generation: `activeDepartureDiscount` / `upcomingBatches` depend on wall-clock, so a memoized value could then be up to `30s + s-maxage` stale — ~5.5 min once Phase 2 lands. Acceptable for a trips site, and the countdown UI is client-side anyway. Write the comment to say which of the two situations applies.

### 1d. Seed the shuffle

`sortTripsByPriority` (`trips.ts:51-54`) already takes an injectable `random`; both callers omit it (`index.astro:11`, `trips/index.astro:9`), only tests inject. Pass a mulberry32 seeded from `getContentVersion()`.

Honest framing: with edge caching in place the CDN would freeze *some* order anyway, so this is **not** a hard prerequisite for Phase 2 — it prevents different orders across Cloudflare PoPs and across each revalidation, which is a consistency win, not a correctness one. It is ~15 lines; do it.

**Verify:** instrument the loaders in dev — repeated `/` and `/trips/` loads produce one disk read per file per 30s. `npm run test` with a new fixed-seed determinism test for `sortTripsByPriority` (existing tests at `tests/unit/tripPriority.test.ts` already inject `random`). Confirm trip order is stable across refreshes and changes after an admin edit.

**Rollback:** the wrappers are one-line; unwrap them.

---

## Phase 2 — HTTP + Cloudflare HTML caching  ← the actual headline

**Sub-phase order is not cosmetic:** 2a must be deployed and confirmed in production *before* 2b's headers go out, and 2b before 2d's Cloudflare rules. Shipping 2b first means Cloudflare caches responses whose `Set-Cookie` behaviour has not yet been fixed, and new visitors silently stop receiving attribution cookies from that moment. Ship 2a alone, verify `curl -sI` on a cookie-less request shows no `set-cookie`, then continue.

### 2a. Remove `Set-Cookie` from cacheable HTML

**Correct the draft's premise first.** It claimed middleware "sets two attribution cookies on every public HTML GET". `src/middleware.ts:126,129` is guarded:

```js
if (!cookies.get(attributionCookieNames.first)) { … }
if (!cookies.get(attributionCookieNames.latest) || hasCampaignTouch(touch, SITE_ORIGIN)) { … }
```

`first` writes only when absent; `latest` writes when absent **or** on a campaign/off-site-referrer touch. A repeat organic visitor produces **zero** `Set-Cookie`.

The real hazard is the inverse of what the draft described, and it is worse: because repeat visitors produce cookie-free responses, **those are exactly the responses Cloudflare will cache** — and it will then serve them to first-time visitors, who consequently never receive attribution cookies at all. Silent, total first-touch attribution loss for new traffic. This is not optional cleanup; it is a prerequisite for turning caching on.

**Fix:** move first/latest-touch capture to a fire-once client beacon.

- Small inline script in `BaseLayout` POSTs `document.referrer` + `location.search` to a new `POST /api/attribution`, which sets the httpOnly cookies. Uses `navigator.sendBeacon` with a `fetch(..., {keepalive:true})` fallback, and sets a `sessionStorage` flag on 200 so it fires once per session, not per pageview.
- The route: `Cache-Control: no-store`; rate-limited via the existing `src/lib/rateLimit.ts` (module-level `Map` at `:1` with a `.unref()`'d 10-min prune — the correct existing pattern; note the draft also cited `geocode.ts`, which actually caches in the SQLite `geocode_cache` table, `db.ts:193-200`, not a Map). JSON body, so it sits outside `shouldCheckCsrf`'s form-content-type check (`middleware.ts:51-55`) — validate and clamp fields explicitly.
- Keep the server-side `attributionFromRequest` parse as a fallback on routes that are never cacheable; the form POST handlers already read the cookie.
- **Documented trade-off:** a no-JS first visit loses first-touch attribution. Given the alternative is losing it for *all* new visitors once caching is on, this is strictly better.

### 2b. `Cache-Control` from middleware

In `src/middleware.ts`, after `const response = await next()` (`:215`) and on the cloned `headers` (`:216`).

A response is cacheable when **all** hold:

1. `GET`, `Accept` contains `text/html`
2. `response.status === 200` — **I2**
3. `!headers.has('set-cookie')` — **I1**
4. no `user_session` and no `admin_token` cookie on the request — **I3**
5. path is in the allow-list: `/`, `/trips/`, `/trips/[slug]/`, `/about/`, `/faq/`, `/contact/`, `/custom-itineraries/`, `/photo-vault/…`, `/privacy/`, `/terms/`, `/cancellation/`

Then:

```
Cache-Control:     public, max-age=0, s-maxage=300
CDN-Cache-Control: public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400
Vary:              Accept-Encoding
```

`s-maxage=300` is the guaranteed contract; SWR / `stale-if-error` are progressive enhancement (honoured on Business+, ignored gracefully below).

Otherwise:
- `user_session` present → `private, no-cache` (I3's second layer).
- `/trips/[slug]/book`, `/profile*`, `/admin*`, `/api/*`, `/login*`, `/leaderboard`, `/u/*` → `private, no-store`. Note only `/profile*` has this today (`middleware.ts:241-243`); the rest currently send **no** `Cache-Control` at all.
- `/feed.xml`, `/sitemap.xml` → `s-maxage=3600`.

`/photo-vault/*` is safe to allow-list: verified no auth gating on either public vault page — visibility is `isAlbumPublic` returning 404 (`photo-vault/[slug].astro:11`), which I2 handles.

### 2c. ~~Static-generate the "truly static" pages~~ — **cut**

The draft proposed `export const prerender = true` on `privacy`, `terms`, refund/cancellation, and `faq`. **None of these is static.** All read admin-editable content:

| Page | Reads |
|---|---|
| `src/pages/privacy.astro:13` | `settings.privacyPolicy` override |
| `src/pages/terms.astro:10` | `settings.termsAndConditions` |
| `src/pages/cancellation.astro:13` | `settings.cancellationPolicy` |
| `src/pages/faq.astro:7` | `listFaqs()` |

Prerendering freezes them at build time — an admin editing the privacy policy in Settings would see nothing change until a redeploy. That is a functional regression traded for a benefit 2b already delivers.

It also drags in a prerequisite the draft acknowledged: middleware does not run for prerendered routes, so their TTL would have to come from a separate Cloudflare rule, *and* `BaseLayout` would need the header user-menu converted to a `client:only` island first, because a prerendered page bakes the logged-out header.

**Decision: drop the phase.** These pages get their TTL from 2b like everything else, and stay purgeable. The only genuinely data-free pages are `404.astro` and `thank-you.astro`, and prerendering two pages is not worth the `client:only` refactor. (For reference: 51 files currently declare `export const prerender`, **all `false`**. Nothing is prerendered today.)

### 2d. Cloudflare configuration (dashboard)

- **Cache Rule — HTML.** Match `http.host eq "www.seekthethrill.in"` and the allow-listed paths → *Eligible for cache*; **Edge TTL: "Use cache-control header if present, bypass cache if not"**; **Browser TTL: Respect origin**. Deferring to the origin header is what makes 2b's I1–I3 guards authoritative.
- **Bypass on cookie.** `http.cookie contains "user_session" or http.cookie contains "admin_token"` → *Bypass cache*. I3, first layer.
- **Cache Rule — assets.** `/_astro/*` → *Eligible*, Edge TTL 1 year (content-hashed, genuinely immutable).
- **Cache Rule — images.** `/images/*` → *Eligible*, Edge TTL 1 year — **only after §3a lands.** Turning this on first would make the `immutable` bug (§3a) permanent at the edge as well as in browsers.
- **Zone settings:** Brotli on, HTTP/3 on, Early Hints on, Tiered Cache (Smart Tiering) on, **Rocket Loader OFF** (it reorders scripts and breaks island hydration).
- **Pro+ only:** Polish = Lossy + WebP/AVIF, Mirage.

### 2e. Purge on write — `src/lib/cachePurge.ts` (new)

`purgeUrls(paths: string[])` → `POST https://api.cloudflare.com/client/v4/zones/{CF_ZONE_ID}/purge_cache`, `Authorization: Bearer {CF_PURGE_TOKEN}`. Best-effort, never throws — mirror `src/lib/indexnow.ts` exactly (`:28` env no-op, `:40-42` bare-catch swallow). New env `CF_ZONE_ID`, `CF_PURGE_TOKEN` (scoped token: Zone → Cache Purge → Purge only), added to `.env.example`.

Call sites, in priority order:

1. **All three seat-count paths (**I4**) — see the correction under I4.** `src/pages/api/admin/update-registration.ts` (beside both `adjustBookingCount` calls, `:204`/`:206`), plus `registrations/create.ts:82` and `registrations/import.ts:105`, which reach the counter through `createRegistration`. Without a purge, confirming the booking that fills a trip leaves "N spots left" and a live CTA on `/` and `/trips/` for up to five minutes. Purge `/`, `/trips/`, `/trips/<slug>/`. Hook the endpoints rather than `registrationWrite.ts` itself — `adjustBookingCount` must stay synchronous per its ATOMICITY INVARIANT (`registrationWrite.ts:35-38`), and `purgeUrls` is an async fetch.
2. Beside every existing `submitToIndexNow(...)`: `api/admin/trips/{create,update,delete}.ts`, `api/admin/albums/{create,update,delete}.ts`.
3. New calls in `api/admin/{testimonials,faqs}/{create,update,delete}.ts` and `api/admin/settings/update.ts` — these change `/` and every `/trips/*`, so purge the list plus each slug.
4. The five `saveImageFile` overwrite sites — see §3a.

Worth folding in while you are there: `submitToIndexNow` is itself missing from `api/admin/trips/{duplicate,import,priority}.ts` and all the testimonials/faqs/settings endpoints.

`Cache-Tag` purge (one tag, one call) is cleaner but **Enterprise-only**; at 13 trips, URL purge is entirely adequate.

**Verify:** `curl -sI https://www.seekthethrill.in/` twice → `cf-cache-status: HIT`, correct `cache-control`, **no `set-cookie`**. With a `user_session` cookie → `BYPASS`. Request an unpublished album URL, publish it, request again → visible immediately, not after 5 min (I2). Book a seat on a nearly-full trip → listing updates within seconds (I4). Edit a trip in admin → new content within seconds.

**Rollback:** set `s-maxage=0` in middleware (instant, no deploy needed if the CF rule is disabled instead), or disable the Cache Rule.

---

## Phase 3 — Image delivery

### 3a. Fix the `immutable` bug, then add validators

**This is a correctness fix, not an optimisation, and the draft missed it.**

`src/pages/images/[...path].ts:54` sends `Cache-Control: public, max-age=31536000, immutable` on paths that are **not** content-addressed. `saveImageFile` (`_contentBase.ts:46`) uses a UUID filename *only* when `namePart` is absent. Four call sites pass a deterministic `namePart`:

| Call site | Filename |
|---|---|
| `api/admin/trips/create.ts:44` | `${slug}-featured` |
| `api/admin/trips/update.ts:52` | `${newSlug}-featured` |
| `api/admin/albums/create.ts:22` | `${slug}-cover` |
| `api/admin/albums/update.ts:46` | `${slug}-cover` |

> **Corrected during implementation (2026-08-29).** This table previously listed `api/admin/settings/update.ts:57` (the founder image) as a fifth overwrite site. It is not one: that call passes `` `founder-${Date.now()}` ``, which is unique per upload, and the code carries a comment saying exactly that. Four sites, not five.

So **re-uploading a trip's featured image or an album cover overwrites the same URL**, and `immutable` tells every browser that already has it never to revalidate — for a year. There is no purge that fixes a browser cache. Today this only affects browsers; §2d's `/images/*` edge rule would extend it to Cloudflare.

**Fix (chosen approach — least churn, no URL changes):**

```
Cache-Control:     public, max-age=86400, stale-while-revalidate=604800
CDN-Cache-Control: public, max-age=31536000, immutable
```

plus `purgeUrls([imageUrl])` at the five overwrite call sites. Browsers revalidate daily and get a cheap `304`; Cloudflare holds a year and is purged explicitly on overwrite.

*Alternative if you would rather be strictly correct than minimal:* append a short content hash to `namePart` filenames and keep `immutable` everywhere. Cleaner, but it changes URLs already stored in YAML and needs a backfill. Not recommended for this volume.

**Then the actual optimisation:**
- Weak `ETag` from `statSync` `size` + `mtimeMs`, plus `Last-Modified`; honour `If-None-Match` / `If-Modified-Since` → `304`. (Required for the daily revalidation above to be cheap.)
- Stream instead of buffering: `new Response(Readable.toWeb(fs.createReadStream(filePath)))` replaces `readFileSync` at `:49`.
- Collapse the redundant syscalls: the route currently runs `existsSync` + `statSync` up to four times (`:32`, `:43`) — one `statSync` in a `try` gives existence, file-ness, size and mtime together.
- Leave the traversal guards (`:26`, `:37-41`) untouched.

### 3b. Next-gen formats + responsive sizes — pick one track

**Track A (preferred): Cloudflare does it.** Polish (Pro+) auto-serves AVIF/WebP and recompresses with zero origin change. It does **not** resize — a 1920px file in a 400px slot stays 1920px in dimensions. For true per-viewport sizing, add Cloudflare Image Resizing and point `ResponsiveImage.astro` at `/cdn-cgi/image/width=480,format=auto/<url>` srcsets.

Without Resizing, Polish alone recovers most of the bytes. Current surfaces are only modestly oversized — card covers are already resized to ≤1920 by `sharp` at `_contentBase.ts:55` — the real offender is itinerary photos at up to 1920px in a ~700px column. "Properly size images" will keep failing on those until Resizing or Track B lands.

**Track B (no Cloudflare image spend): variant pipeline.** Generate `[480, 800, 1200, 1920]` in WebP inline inside `saveImageFile`/`saveImageFileWithMeta`; keep 1920 WebP as canonical. **Generate AVIF out-of-band only** — AVIF encode is seconds per image and would stall admin uploads. Persist the widths manifest into the YAML beside `width`/`height`. Backfill with `scripts/generate-image-variants.mjs` (pattern: `scripts/reconcile-booked.mjs`). Multiplies the volume footprint ~4–8× — confirm headroom or pair with §3d.

**Shared — `src/components/ResponsiveImage.astro`:** `<picture>` with AVIF/WebP `<source srcset>` + `<img>` fallback; `width`/`height` always set (CLS); `loading` / `fetchpriority` / `sizes` props. Adopt at `TripCard.astro:68`, `trips/[slug].astro:247` (detail-page LCP element — `fetchpriority="high"` + preload) and `:500`, `about.astro:63`. For itinerary photos, `DayAccordion.tsx:96` is React: precompute the `srcset`/`sizes` strings in `trips/[slug].astro` and pass as props; the GLightbox anchor `href` keeps pointing at full size.

### 3c. Self-host the Unsplash heroes

Hot-links today: `index.astro:33` (**site LCP element**), `contact.astro:14`→`:30`, `custom-itineraries.astro:5`→`:67`, plus `aboutDefaults.ts:2`, `TripCard.astro:49` (default cover), `trips/[slug].astro:44,52-55`, `trips/[slug]/book.astro:88`.

- Download into `public/images/`. Removes a third-party connection from the critical path, lets the edge cache them, and makes a `preload` possible.
- **Correction to the draft:** it described `index.astro:218` as a duplicate of the hero to be "collapsed". It is not — `:218` is the **newsletter section's** CSS `background-image`, a different section entirely. The waste is real but different: it reuses the same Unsplash photo ID with a **different URL** (`&auto=format&fit=crop&q=80` vs `&q=80`), so the browser downloads a ~1920px asset twice. Fix by unifying the URL, not by removing a section.
- `<link rel="preload" as="image" fetchpriority="high" imagesrcset="…">` for the homepage and detail heroes, via `BaseLayout`'s head slot.
- If any Unsplash URL stays remote short-term, add `<link rel="preconnect" href="https://images.unsplash.com" crossorigin>` and use `w=`/`dpr=` params in a srcset.

### 3d. (Follow-up PR) uploads → Cloudflare R2

Railway Volume + Node file-serving is a single load point and a migration risk. Move `CONTENT_DIR/images` to R2 (S3 API, no egress fees, already behind this CDN). `saveImageFile` writes to R2; `/images/[...path]` becomes a redirect to the bucket's custom domain, or is deleted. Keep `public/images` as seed fallback. Not a blocker for 3a–3c.

**Verify:** `curl -sI` an image twice → `304`; `cf-cache-status: HIT`. Re-upload a trip's featured image → the new one appears in a browser that had the old one (this is the bug fix — test it explicitly). DevTools on `/trips/<slug>` → right-sized AVIF/WebP. Homepage hero same-origin, preloaded, `fetchpriority=high`. CLS unchanged.

---

## Phase 4 — Frontend assets & JS

### 4a. Fonts — on the LCP path

`BaseLayout.astro:86-91`: two preconnects plus a render-blocking Google stylesheet requesting **6 Fraunces faces** (400/600/700/900 + italic 400/700) and **5 DM Sans faces**. Fraunces renders the hero H1.

- Self-host `woff2` in `public/fonts/`; drop the preconnects and the Google `<link rel="stylesheet">`.
- **The lever for a variable font is subsetting, not dropping weights** — one variable file already contains every weight. Subset to the Latin `unicode-range` (`pyftsubset`, or Fontsource's Latin subset): Fraunces variable goes from ~100KB+ to ~30–40KB. If subsetting tooling is unwanted, ship static instances instead (Fraunces 400/600/700; drop 900 and the italics — confirm against a `font-weight` grep of `src/styles/global.css:31-33` and components first).
- `@font-face` with `font-display: swap`; `<link rel="preload" as="font" type="font/woff2" crossorigin>` for the two above-the-fold faces only.

### 4b. Drop dead weight

- Remove `lucide-react` (`package.json:37`) — zero imports in `src/`.
- Remove `@astrojs/sitemap` (`package.json:23`) — not registered in `astro.config.mjs:27`. **Keep `src/pages/sitemap.xml.ts`**, which is live, hand-rolled, and referenced by `public/robots.txt:30`. Remove the dependency, not the sitemap.
- Delete `src/components/{TestimonialCarousel,StatsCounter,ItineraryAccordion}.tsx` — verified unreferenced. **Do not confuse** with `TestimonialCard.astro` and `DayAccordion.tsx`, which are the live equivalents.
- Delete `public/sw.js` — a real cache-first service worker that is **never registered** (zero `serviceWorker` matches anywhere). Phase 2 provides the caching; there is no offline goal.

### 4c. Collapse the countdown React roots

`DiscountCountdown` is `client:load` at `TripCard.astro:141` — once per discounted card, so N independent React roots on `/` and `/trips/`. It is **also** `client:load` twice on the detail page (`trips/[slug].astro:306`, `:625`), which the draft missed.

Rewrite as a single `is:inline` vanilla script that ticks every `[data-discount-ends-at]` from one `setInterval`. Removes N hydrations from the two busiest pages and 2 from the detail page. `BookingPanel` stays React `client:load`; `BookingCheckout` is `/book`-only.

### 4d. Third-party scripts off the main thread (experiment)

GA4 + Clarity are `is:inline` in `<head>` (`BaseLayout.astro:103-125`), Clarity's synchronously. Note the Clarity ID is hardcoded at `:46`, so it fires on every prod public page regardless of settings. Move both to `@astrojs/partytown`. Clarity occasionally misbehaves under Partytown — A/B it, keep GA at minimum, revert Clarity to main-thread `async` if it breaks.

### 4e. Navigation prefetch

`prefetch` is not configured today. Set `prefetch: { defaultStrategy: 'hover' }` in `astro.config.mjs` and add `data-astro-prefetch` to trip-card links. Use `hover`/`tap`, **not** `viewport` — many cards means a prefetch storm. Makes `PageLoader.astro` rarely visible; keep it as fallback.

### 4f. Cheap rendering wins

- **`TripCard.astro:68` has `loading="lazy"` on every card, including above-the-fold.** On `/trips/` the first card is the likely LCP element and lazy-loading defers its request past layout. Add an index/priority prop so the first 3 cards get `loading="eager" fetchpriority="high"`. The draft's §4f only said "audit"; this is the concrete instance and it is on a targeted page's LCP path.
- Add `decoding="async"` alongside (currently absent on the card image).
- `content-visibility: auto` + `contain-intrinsic-size` on offscreen sections of the long detail page (`trips/[slug].astro` — accommodation gallery, itinerary days, FAQ, testimonials). Pure CSS.
- Audit remaining `<img>`s in `about.astro`, testimonials, avatars for `loading="lazy"` + `decoding="async"`.

### 4g. Hydration audit

Usage is already conservative — verified 7 directives total. Keep `DayAccordion` at `client:visible` (`trips/[slug].astro:524`); `WebVitals` is `client:idle`. Nothing else needs downgrading once 4c lands.

**Verify:** bundle diff vs the Phase 0 baseline — the React chunk should disappear from pages whose only island was the countdown. No FOUT flash. Fonts preloaded. Fewer main-thread long tasks in a Lighthouse trace. `npm run test` + `npx playwright test` green (countdown, booking, checkout).

---

## Phase 5 — Database & middleware

### 5a. Indexes — `src/lib/db.ts`, beside the existing migrations (`:147–410`, 12 indexes today)

```sql
CREATE INDEX IF NOT EXISTS idx_registrations_status    ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_registrations_trip_slug ON registrations(trip_slug);
CREATE INDEX IF NOT EXISTS idx_users_email             ON users(email);
CREATE INDEX IF NOT EXISTS idx_lbcache_kms             ON leaderboard_cache(kmsFromHome DESC);
CREATE INDEX IF NOT EXISTS idx_lbcache_days            ON leaderboard_cache(daysOutdoors DESC);
CREATE INDEX IF NOT EXISTS idx_lbcache_dests           ON leaderboard_cache(destinationsCount DESC);
```

Verified gaps: `registrations(status)` and `registrations(trip_slug)` do not exist (the column is added at `db.ts:152`, never indexed). `leaderboard_cache` (`db.ts:201-213`) has only its `userId` PK, while `leaderboard.astro:39,49,51` and `u/[username].astro:27` do ranked scans over those three columns.

**`users(email)` is an addition the draft missed:** `stats.ts:70` runs `SELECT … FROM users WHERE email = ?` and `users` has **no** email index at all (only `users_username_unique` on `username`, `db.ts:147`).

Then normalise the `src/lib/stats.ts` queries — **lines 70, 85 and 111** (the draft cited 69-72/109-113) — which all filter on bare `email = ?`. The only registrations email index is the expression index `registrations_email_lower ON registrations(lower(trim(email)))` (`db.ts:155`), and SQLite will not use it unless the query uses the identical expression.

### 5b. Throttle the admin session write

`src/lib/admin-session.ts:49-50` runs `UPDATE admin_sessions SET lastActivityAt` inside `getAdminBySession`, unconditionally, on every admin request. No throttle, no dirty check. Write only when the stored value is >60s stale. (Constants for context: `SESSION_TTL` 8h at `:4`, `IDLE_TIMEOUT` 2h at `:5` — the throttle must stay well under the idle timeout.)

### 5c. Move the migration run off the request path

`src/middleware.ts:135` calls `getDb()` on **every** request — including the images route — purely so migrations run early. They only need to run once: call `getDb()` in the server entry or `scripts/seed-content.js` and let middleware assume an initialised DB. The `Database` handle is already module-cached (`db.ts:11-21`), so this is cheap today; it is a clarity fix more than a speed one.

### 5d. (Optional) session micro-cache

`getUserBySession(token)` (`middleware.ts:139`) JOINs on every request that carries a session cookie. A `Map<token,{user,expires}>` with 30–60s TTL in `src/lib/session.ts`, cleared on logout, would remove it. **Only do this if Phase 0's timing shows it matters** — it is sub-millisecond on local SQLite.

**Verify:** `EXPLAIN QUERY PLAN` on the leaderboard and profile-stats queries shows `USING INDEX`, not `SCAN`. Admin clickthrough → ≤1 `lastActivityAt` write per minute per session. `npm run test`.

---

## Rollout, risk, rollback

| Phase | Effort | Risk | Rollback | Payoff |
|---|---|---|---|---|
| 0 Measure | S | none | delete island + script | **Enables honest sizing of 1 and 5d** |
| 1c/1d Call dedup + WeakMap memo + seeded shuffle | S | low | revert three edits | Free; ships regardless |
| 1a/1b Content cache | M | low — pure functions, single write choke point, `readTrip` excluded | unwrap the loaders | Cuts origin render cost; **gated on Phase 0 timing** |
| 2 Edge HTML cache + purge | M–L | **medium — I1–I4 are the whole risk surface** | `s-maxage=0`, or disable the CF rule (no deploy) | **The order-of-magnitude win** |
| 3a Image cache-header fix | S | low | revert the header | **Fixes a live bug**; unblocks 2d's image rule |
| 3b–3c Formats, sizes, self-hosted heroes | L | medium — upload path, backfill, storage | Track A yes; Track B harder | Large LCP + bandwidth cut |
| 4 Fonts / dead code / countdown / prefetch | M | low | yes | LCP + bytes + INP |
| 5 DB + middleware | S | low | drop the indexes | Steadier tail latency |

**Order:** `0 → 1 → 2a → 2b → 2d/2e → 3a` first. Two hard constraints inside that chain: **2a before 2b/2d** (§2), and **3a before 2d's `/images/*` rule** (§3a) — everything else in the chain is preference. Then 3b–3c and 4 in parallel. 5 anytime.

One PR per phase, each with before/after Lighthouse and TTFB in the description.

---

## Global verification

1. **Local:** `npm run build && npm run preview`; `lhci autorun` on `/`, `/trips/`, `/trips/<slug>` against the Phase 0 baseline. Targets: LCP < 2.5s, CLS < 0.1, TBT < 200ms.
2. **Edge, anonymous:** `curl -sI` each of the three pages twice → correct `cache-control`, `cf-cache-status: HIT` on repeat, **no `set-cookie`**.
3. **Edge, authenticated:** same with a `user_session` cookie → `BYPASS`, `private, no-cache`, and the header avatar renders (I3).
4. **I2:** request an unpublished album, publish it, request again → immediate, not 5 minutes.
5. **I4:** in admin, confirm the registration that fills a test trip's last seat → `/` and `/trips/` show sold-out within seconds.
6. **I5 — static check, not a runtime test.** The invariant is unobservable at runtime by design (Node is single-threaded and `adjustBookingCount` is deliberately synchronous), so a passing behavioural test would prove nothing. Instead assert in review: `readTrip` does not appear in any `cachedRead` call, and `adjustBookingCount` contains no `await`. Worth a one-line unit test that imports `contentCache` and fails if `readTrip` is registered.
7. **3a bug fix:** re-upload a trip's featured image; a browser that cached the old one shows the new one.
8. `npm run test` (vitest + `tests/run.mjs` + Playwright) green — booking, checkout, countdown, admin auth.
9. **GA4 Realtime:** web-vitals events flowing. At 24–48h: Cloudflare cache-hit ratio (target >80% HTML, >95% assets), origin request-volume drop, GA4 Web Vitals trend.

---

## Open decisions

| Question | Default if unanswered | Impact |
|---|---|---|
| **Cloudflare plan tier?** | Assume Free — plan uses only URL purge + `s-maxage`, both of which work there | Free lacks Polish and reliable SWR; `Cache-Tag` purge is Enterprise-only |
| **Pay for Cloudflare Image Resizing?** | No → Track A with Polish only, itinerary photos stay oversized | Yes → responsive srcset with ~zero origin code |
| **Is JS-dependent attribution acceptable?** | **Yes** — §2a shows the alternative is losing attribution for *all* new visitors once caching is on | No-JS first visits lose first-touch |
| **R2 now or later?** | Later (§3d), not a blocker | Removes the Node file-serving hot path |

## Non-goals

- **No `@astrojs/cloudflare` / Workers.** `better-sqlite3` is a native module and is externalised (`astro.config.mjs:18,23`). Stay on the Node adapter + Railway.
- **No Redis/Memcached.** Single Node process; a module-level `Map` matches the existing pattern (`rateLimit.ts:1`).
- **No client-side router / View Transitions.** Out of scope; `PageLoader` stays, reduced by prefetch.
- **No `Vary: Cookie` on HTML.** It collapses hit rate. The cookie-bypass Cache Rule is the correct mechanism.
- **No prerendering.** See §2c.

## Key files

- **New:** `src/lib/contentCache.ts`, `src/lib/cachePurge.ts`, `src/components/ResponsiveImage.astro`, `src/components/WebVitals.astro`, `src/pages/api/attribution.ts`, `scripts/generate-image-variants.mjs` (Track B only)
- **Content loaders:** `src/lib/{trips,testimonials,faqs,settings,tripDeletions,albums}.ts`
- **Headers / caching / auth:** `src/middleware.ts`
- **Booking writes (I4/I5):** `src/lib/registrationWrite.ts`
- **Images:** `src/pages/images/[...path].ts`, `src/lib/_contentBase.ts`
- **Head / assets / config:** `src/layouts/BaseLayout.astro`, `src/components/Footer.astro`, `src/styles/global.css`, `astro.config.mjs`, `package.json`
- **Purge + IndexNow hooks:** `src/pages/api/admin/{trips,albums,testimonials,faqs}/*`, `src/pages/api/admin/settings/update.ts`
- **Countdown:** `src/components/DiscountCountdown.tsx`, `src/components/TripCard.astro`, `src/pages/trips/[slug].astro`
- **DB:** `src/lib/{db,admin-session,session,stats}.ts`
- **Pattern reference:** `src/lib/indexnow.ts` (best-effort external call), `src/lib/rateLimit.ts` (module Map)
- **New env:** `CF_ZONE_ID`, `CF_PURGE_TOKEN` (+ `.env.example`)

---

## Appendix — corrections to the first draft

| Draft claim | Reality |
|---|---|
| Keystatic writes YAML directly, justifying the TTL | **Not mounted.** `astro.config.mjs:27` = `[react()]`; no keystatic route. Real out-of-band writer is `scripts/reconcile-booked.mjs`. |
| `privacy`/`terms`/`cancellation`/`faq` are "truly static", prerender them | All four read admin-editable content. Prerendering is a regression. Phase cut. |
| Purge on admin trip/album edits | Missed the seat-counter paths. (This v2 entry was itself wrong — there are three such paths, not one. See the correction under I4.) |
| `normalizeItineraryPhotos` is the mutation hazard | It is write-path-only. The real hazard is `adjustBookingCount`'s read-modify-write, which has a documented ATOMICITY INVARIANT (`registrationWrite.ts:35-38`). |
| Attribution cookies set on every public HTML GET | Guarded (`middleware.ts:126,129`); repeat visitors get none. The hazard is inverted — see §2a. |
| Content layer is a dominant cost; order-of-magnitude win | 42KB corpus. Single-digit ms. The order of magnitude is Phase 2's. |
| `resolveBooking` 2–3× per trip | 4× on `/`, 3× on `/trips/`. |
| `readSiteSettings` once per page via BaseLayout | 2–3× — BaseLayout + Footer + most pages. |
| `index.astro:218` is a duplicate hero to collapse | It is the newsletter section's background. Same photo, different URL → two downloads. |
| `TripCard.astro:66` is the image | `:66` is the wrapper div; the `<img>` is `:68`. |
| `geocode.ts:6` is a module-Map precedent | It caches in SQLite (`db.ts:193-200`). Only `rateLimit.ts:1` is. |
| Remove `@astrojs/sitemap` | Correct, but `src/pages/sitemap.xml.ts` is live and hand-rolled — keep it. |
| `stats.ts:69-72,109-113` | Actual lines are `70`, `85`, `111`. And `users` needs an email index too. |
| Countdown is per-card only | Also `client:load` at `trips/[slug].astro:306,625`. |
| Phase 0 is "S", optionally wire up CI | No CI exists at all. Scope to local `lhci` to keep it "S". |
| *(absent)* | `images/[...path].ts:54` sends `immutable` on non-content-addressed paths — a live bug. See §3a. |
| *(absent)* | Cacheable-response predicate must exclude non-200s (I2). |
| *(absent)* | `TripCard.astro:68` lazy-loads above-the-fold cards. |
| *(absent)* | Request volume was never established, yet it decides whether Phase 2 is a capacity win or only a latency win. |
| *(absent)* | 2a is a hard prerequisite of 2b/2d — shipping out of order silently drops attribution for new visitors. |
