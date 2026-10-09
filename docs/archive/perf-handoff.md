# Performance work — handoff checkpoint

Point a new session at this file. It is the state of `PERFORMANCE-PLAN.md`
implementation as of 2026-08-29.

## Status: DEPLOYED AND VERIFIED — 2026-08-29

The code chain and the Cloudflare dashboard work are both done and verified in
production. What remains is listed under "Still outstanding" at the bottom; it is
all admin-login or GA4 work that cannot be done from a shell.

Deployment log:

| Step | State |
|---|---|
| Baseline captured (`main` + branch) | done — `docs/perf-baseline.md` |
| Branch pushed, PR #15 | **merged** into `main` via fast-forward |
| `CF_ZONE_ID` + `CF_PURGE_TOKEN` on Railway | set |
| 2a deployed alone and gated | done — no `Set-Cookie`, beacon live, `/api/attribution` 200 |
| Rest deployed (`acd2734`..`d57f38c`) | done — origin headers verified |
| `www` flipped to proxied | done — `cf-ray … BOM`, `server: cloudflare`, no 525, no loop |
| 4 Cache Rules | done — HIT on HTML/assets/images, bypass verified independently |
| Zone settings | see step 6 |

## Checkpoint

- **Branch:** `perf/edge-cache-chain` (9 commits, branched from `main` at `077b0d8`), merged to `main`.
- Working tree clean apart from the pre-existing untracked `public/mockups/`.
- **Scope agreed for this pass:** the plan's own priority chain `0 → 1 → 2a → 2b → 2e → 3a`. Phases 3b/3c/3d, 4 and 5 were deliberately left out.

Verify the checkpoint before continuing:

```bash
git log --oneline main..HEAD     # expect the commits below, plus this doc and the baseline
npm run build                    # green
npx vitest run                   # 262 pass
npm run test:api                 # 142 pass
```

## What shipped

| Phase | Commit | Contents |
|---|---|---|
| 0 Measure | `fd79556` | `src/components/WebVitals.astro` reports LCP/CLS/INP/TTFB to GA4, mounted in `BaseLayout` inside the **existing** `analyticsEnabled && gaId` gate. `PERF_TIMING=1` logs per-request render time (`src/middleware.ts`) and per-loader time (`src/lib/contentCache.ts`). `lighthouserc.json` + `npm run perf:lhci`. No CI wiring — repo has no workflows. |
| 1 Content cache | `4a130ae` | `src/lib/contentCache.ts`: version counter persisted in a new `app_meta` table + 30s TTL. Wrapped: `listTrips`, `listTestimonials`, `listFaqs`, `readSiteSettings`, `listDeletedSlugs`. `bumpContentVersion()` inside 6 writers + 3 deletes. `resolveBooking` WeakMap memo; `tripCardSummary` now returns `departures`; both listing pages seed the shuffle from the content version. Dev-only deep-freeze. |
| 2a Attribution | `7832aa5` | `POST /api/attribution` + once-per-session `sendBeacon` in `BaseLayout`. Middleware cookie block removed. `sameOriginLandingPath()` added to `src/lib/attribution.ts`. |
| 2b Cache headers | `acd2734` | `applyCacheHeaders()` in `src/middleware.ts`. Public HTML gets `s-maxage=300` + `CDN-Cache-Control`; `/book`, `/admin`, `/api`, `/login`, `/leaderboard`, `/u/*` get `private, no-store`; feeds get an hour. |
| 2e Purge | `dbd292d` | `src/lib/cachePurge.ts` mirroring `indexnow.ts`. Wired into 19 endpoints. Missing IndexNow pings folded in. |
| 3a Images | `b4cbbb4` | `immutable` bug fixed in `src/pages/images/[...path].ts`; weak ETag + `Last-Modified` + 304; streaming; one `stat` instead of four; purge at the 4 overwrite sites. |
| Docs | `b5e3864` | `docs/cloudflare-cache-setup.md` + corrections written back into `PERFORMANCE-PLAN.md`. |

### Invariants held (do not regress these)

- **`readTrip` is NOT cached** (`src/lib/trips.ts`), with a comment saying why: it is the read half of `adjustBookingCount`'s read-modify-write. `tests/unit/contentCache.test.ts` asserts this statically, plus that `adjustBookingCount` contains no `await`.
- **`bumpContentVersion` is synchronous** — `adjustBookingCount` reaches it through `writeTrip` and must complete in one tick.
- Purging happens at **endpoints**, never inside `registrationWrite.ts`.
- Cached values are shared and read-only; the dev deep-freeze exists to catch violations.

### Three errors found in PERFORMANCE-PLAN.md (corrected in that file)

1. **I4 caller list.** The plan said `update-registration.ts` held the only calls to `adjustBookingCount`, and that `registrations/{create,import}.ts` "never move the counter". Wrong — `createRegistration` (`registrationWrite.ts:218`) calls it whenever a registration is created at `confirmed`. **Three** seat-count paths; all three now purge.
2. **§3a overwrite sites.** Four, not five. The founder portrait in `settings/update.ts` already uses `founder-${Date.now()}`, unique per upload.
3. Line drift: the `update-registration.ts` calls are at `:204,206`, not `:206,208`.

### Known pre-existing test failures — do not chase

`npm run test:e2e` → **105 pass / 13 fail**. All 13 fail identically on `main`; confirmed by stashing this branch and re-running. They are unrelated to this work:

- `coming-soon.spec.ts:27`
- `registration.spec.ts:122,136,142,148`
- `trip-description-editor.spec.ts:12`
- `ux-journeys.spec.ts:72,204,213,230,242,267,287`

Also pre-existing: two `tsc --noEmit` errors in `src/lib/safeMarkdown.ts:18` and `tests/e2e/admin-trip-priority.spec.ts:15`.

## Pending — code

Nothing. The last open item is now closed:

- ~~**Phase 0 baseline never captured.**~~ Captured 2026-08-29 for both `main` @ `077b0d8` and this branch. Numbers, method and how to read them: **`docs/perf-baseline.md`**. Headline: origin TTFB 4-9x faster on the branch (Phase 1's content cache); LCP unchanged within noise; nothing local measures Phase 2.

Everything else pending is out of the agreed scope: Phase 3b (Track A + `ResponsiveImage.astro` when it happens — not the Track B variant pipeline), 3c self-hosted heroes, 3d R2, Phase 4 (fonts, dead code, countdown collapse, prefetch), Phase 5 (DB indexes, admin-session throttle).

---

# Still outstanding

Everything below this line under "Your manual steps" has been **done and
verified** except the following, which need an admin login or GA4 and so could
not be done from a shell:

1. **Behavioural purge tests (step 7).** Nothing has yet exercised
   `CF_PURGE_TOKEN` end to end. All five matter, and the image one most of all —
   with a 1-year edge TTL now live, a silently failing purge pins a replaced
   image effectively forever:
   - unpublished album → publish → must appear immediately, not in 5 minutes
   - fill a test trip's last seat by confirming a registration → `/` and
     `/trips/` show sold-out within seconds
   - **repeat via admin → registrations → create with status `confirmed`** —
     the second counter path, the one the plan originally missed
   - edit a trip in admin → visible within seconds
   - re-upload a trip's featured image → changes in a browser that had the old one

   If any takes the full five minutes, the purge is a no-op: check `CF_ZONE_ID`
   and `CF_PURGE_TOKEN` on Railway first.

2. **Attribution lead test (step 4).** Submit a lead from a fresh browser or
   private window and confirm the registration row has source/medium/landing
   path populated. The beacon fires once per session behind a `sessionStorage`
   flag (`stt_attr`), so a reload will not re-fire it. A 200 from
   `/api/attribution` only proves the endpoint accepts a POST.

3. **GA4 numbers (step 8)** — pageviews/day and the `/` : `/trips/` :
   `/trips/<slug>` split, to frame the work as a latency win rather than a
   capacity one. The baseline supports the latency reading:
   origin TTFB was already 10-30ms on `main`.

---

# Your manual steps, in order

Kept for the record and for the next environment. The ordering is load-bearing —
two of these cause silent damage if done out of sequence.

## 1. Capture the baseline first — DONE, skip

Already captured for both branches on 2026-08-29; see `docs/perf-baseline.md`.
Raw reports sit in `test-reports/lighthouse-main/` and
`test-reports/lighthouse-branch/`, which are gitignored — copy them out before
any clean if the numbers matter to you.

Re-running `npm run perf:lhci` now overwrites `test-reports/lighthouse/` with a
fresh branch run. Harmless, but it adds nothing.

## 2. Push and open the PR

```bash
git push -u origin perf/edge-cache-chain
```

## 3. Railway → service → Variables

| Variable | Where to get it |
|---|---|
| `CF_ZONE_ID` | Cloudflare dashboard → the domain → Overview → right sidebar |
| `CF_PURGE_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → Custom. Permissions: **Zone → Cache Purge → Purge**. Zone Resources: this zone only. |

Until both are set, **every purge is a silent no-op** and admin edits stay stale
for the full 5 minutes. Scope the token no wider — nothing else uses it.

## 4. Deploy 2a ALONE, and verify, before anything else

This is the first load-bearing ordering constraint.

Railway auto-deploys on pushes to `main` only, so "deploy 2a alone" means
fast-forwarding `main` to `7832aa5` and pushing that, then merging the rest as a
second push:

```bash
git checkout main && git merge --ff-only 7832aa5 && git push origin main
```

**`-H 'Accept: text/html'` is required in every check below.** The middleware
gates the cookie path and the cache-header path on the request advertising
`text/html` (`src/middleware.ts:150`; `:116` on the pre-2a code). A bare
`curl -sI` fails on two counts — it sends `Accept: */*` and issues a HEAD
rather than a GET, and the public-HTML branch requires both — so it returns
clean whatever the origin is doing. A false pass. Use
`curl -s -D - -o /dev/null -H 'Accept: text/html'`. The image checks are fine
as `curl -sI`; that route gates on neither.

Deploy up to and including commit `7832aa5`, then:

```bash
curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/ | grep -i set-cookie
```

**Must return nothing.** If a `set-cookie` is present, stop — the beacon is not
live, and turning caching on from here loses first-touch attribution for every
new visitor permanently.

Then submit a lead in a fresh browser and confirm attribution is recorded on the
registration row.

## 5. Deploy the rest

Commits `acd2734` through `b5e3864`. Then confirm the origin is emitting the
headers the edge rules will defer to:

```bash
curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/       | grep -iE 'cache-control|cdn-cache|vary'
curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/profile | grep -i cache-control   # private, no-store
```

Expected on `/`:
```
cache-control: public, max-age=0, s-maxage=300
cdn-cache-control: public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400
vary: Accept-Encoding
```

## 5b. PRECONDITION — `www` is not proxied

Verified 2026-08-29 and **not yet fixed**. The apex `seekthethrill.in` is
proxied by Cloudflare and 301s to `www`, but the `www` record is **DNS-only**:
it CNAMEs to `v9gprqct.up.railway.app`, so every real pageview goes straight to
Railway and never touches the edge.

```bash
curl -s -D - -o /dev/null -H 'Accept: text/html' https://www.seekthethrill.in/ | grep -iE 'cf-ray|server'
# proxied  -> server: cloudflare + cf-ray
# current  -> server: railway-hikari, no cf-ray
```

Until the `www` record is flipped to proxied, everything in step 6 is inert:
the origin emits correct cache headers that nothing caches, and every purge
clears a cache that holds nothing. Both are harmless no-ops, not errors — which
is exactly why this is easy to miss.

Encryption mode must be **Full** or **Full (strict)** before flipping (it is
currently **Full**). On **Flexible** the flip causes an infinite redirect loop.

## 6. Cloudflare dashboard

Full detail with copy-pasteable expressions is in
**`docs/cloudflare-cache-setup.md`**. Summary:

1. **Cache Rule "Bypass logged-in"** — `http.cookie contains "user_session" or http.cookie contains "admin_token"` → Bypass cache. **Must sort BELOW** the HTML rule — Cache Rules evaluate top to bottom and the last matching rule wins, so bypass has to be last to override the HTML rule for a logged-in request.
2. **Cache Rule "Public HTML"** — host + the allow-listed paths → Eligible; **Edge TTL: "Use cache-control header if present, bypass cache if not"**; Browser TTL: Respect origin. Deferring to the origin header is what makes the app's four guards authoritative.
3. **Cache Rule assets** — `/_astro/*` → Eligible, Edge TTL 1 year. Safe unconditionally (content-hashed).
4. **Cache Rule images** — `/images/*` → Eligible, Edge TTL 1 year. **Second load-bearing constraint: only after 3a is live.** Check first:
   ```bash
   curl -sI https://www.seekthethrill.in/images/<a-trip>-featured.webp | grep -i cache-control
   ```
   Must say `max-age=86400, stale-while-revalidate=604800`. If it still says `immutable`, 3a is not deployed — adding this rule now makes the bug permanent at the edge.
5. **Zone settings:** Brotli on, HTTP/3 on, Early Hints on, Tiered Cache (Smart Tiering) on, **Rocket Loader OFF** (it reorders scripts and breaks island hydration). Tiered Cache is worth the click specifically because a POP's machines each hold their own cache — without it, one machine's fetch does not warm the rest.
6. **The zone is on the `free` plan**, which prunes this list: `stale-while-revalidate` is Enterprise-only and is ignored (harmlessly — the code documents it as progressive enhancement at `src/middleware.ts:125-127`), and Polish/Mirage are unavailable. Everything load-bearing — Cache Rules, and the Edge TTL "respect origin" setting — is free-tier.
7. **Pro plan and above only:** Polish = Lossy + WebP/AVIF, Mirage on. Polish converts and recompresses but does **not** resize — oversized images stay oversized in dimensions until Phase 3b.

## 7. Verify at the edge

```bash
# Twice each; second should be HIT
for p in / /trips/ /trips/monsoon-meghalaya/; do
  curl -s -D - -o /dev/null -H 'Accept: text/html' "https://www.seekthethrill.in$p" | grep -iE 'cf-cache-status|cache-control|set-cookie'
done

# Logged in -> BYPASS, and the header avatar must still render
curl -s -D - -o /dev/null -H 'Accept: text/html' -H 'Cookie: user_session=<real session>' https://www.seekthethrill.in/ | grep -i cf-cache-status
```

Behavioural, and these are the ones that actually matter:

- **Unpublished album:** request it (404), publish it, request again → must appear **immediately**, not in 5 minutes.
- **Seat counts:** confirm the registration that fills a test trip's last seat → `/` and `/trips/` show sold-out within seconds. **Repeat via admin → registrations → create with status `confirmed`** — that is the second counter path, and the one the plan originally missed.
- **Trip edit** in admin → visible within seconds.
- **Image re-upload:** replace a trip's featured image → it changes in a browser that already had the old one. This is the 3a bug fix; test it explicitly.

## 8. Pull for the PR description

GA4 → Reports → Engagement → Pages: **pageviews/day and the `/` : `/trips/` : `/trips/<slug>` split.**

This is the one input the plan never had, and it decides how to describe the
work. Edge caching improves TTFB for every visitor regardless, but the
origin-load argument only scales with traffic — at a few hundred pageviews/day
the single Node process was never under pressure, making Phase 2 a latency win
rather than a capacity one. State which it is rather than implying the other.

## Rollback, in order of preference

1. Disable the "Public HTML" cache rule — instant, no deploy.
2. Cloudflare → Caching → Configuration → Purge Everything.
3. Set `HTML_S_MAXAGE = 0` in `src/middleware.ts` and deploy.

Per-phase: Phase 1 unwraps at the loaders (one line each); 3a is a header
revert; Phase 0 is deleting the island and the script.
