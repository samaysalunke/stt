# Performance work — handoff checkpoint

Point a new session at this file. It is the state of `PERFORMANCE-PLAN.md`
implementation as of 2026-08-29.

## Checkpoint

- **Branch:** `perf/edge-cache-chain` (7 commits, branched from `main` at `077b0d8`)
- **Not pushed. No PR.** Working tree clean apart from the pre-existing untracked `public/mockups/`.
- **Scope agreed for this pass:** the plan's own priority chain `0 → 1 → 2a → 2b → 2e → 3a`. Phases 3b/3c/3d, 4 and 5 were deliberately left out.

Verify the checkpoint before continuing:

```bash
git log --oneline main..HEAD     # expect the 7 commits below
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

One item only, and it is optional:

- **Phase 0 baseline never captured.** `npm run perf:lhci` exists but was never run, so there is no "before" number for `/`, `/trips/`, `/trips/<slug>`. Worth running before deploying anything, since afterwards the baseline is gone.

Everything else pending is out of the agreed scope: Phase 3b (Track A + `ResponsiveImage.astro` when it happens — not the Track B variant pipeline), 3c self-hosted heroes, 3d R2, Phase 4 (fonts, dead code, countdown collapse, prefetch), Phase 5 (DB indexes, admin-session throttle).

---

# Your manual steps, in order

Nothing here is code. The ordering is load-bearing — two of these cause silent
damage if done out of sequence.

## 1. Capture the baseline first (optional, but one-way)

```bash
npm run build && npm run perf:lhci
```

Report lands in `test-reports/lighthouse/`. Once caching is on, the "before"
number cannot be recovered.

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

Deploy up to and including commit `7832aa5`, then:

```bash
curl -sI https://www.seekthethrill.in/ | grep -i set-cookie
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
curl -sI https://www.seekthethrill.in/       | grep -iE 'cache-control|vary'
curl -sI https://www.seekthethrill.in/profile | grep -i cache-control   # private, no-store
```

Expected on `/`:
```
cache-control: public, max-age=0, s-maxage=300
cdn-cache-control: public, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400
vary: Accept-Encoding
```

## 6. Cloudflare dashboard

Full detail with copy-pasteable expressions is in
**`docs/cloudflare-cache-setup.md`**. Summary:

1. **Cache Rule "Bypass logged-in"** — `http.cookie contains "user_session" or http.cookie contains "admin_token"` → Bypass cache. **Must sort above** the HTML rule.
2. **Cache Rule "Public HTML"** — host + the allow-listed paths → Eligible; **Edge TTL: "Use cache-control header if present, bypass cache if not"**; Browser TTL: Respect origin. Deferring to the origin header is what makes the app's four guards authoritative.
3. **Cache Rule assets** — `/_astro/*` → Eligible, Edge TTL 1 year. Safe unconditionally (content-hashed).
4. **Cache Rule images** — `/images/*` → Eligible, Edge TTL 1 year. **Second load-bearing constraint: only after 3a is live.** Check first:
   ```bash
   curl -sI https://www.seekthethrill.in/images/<a-trip>-featured.webp | grep -i cache-control
   ```
   Must say `max-age=86400, stale-while-revalidate=604800`. If it still says `immutable`, 3a is not deployed — adding this rule now makes the bug permanent at the edge.
5. **Zone settings:** Brotli on, HTTP/3 on, Early Hints on, Tiered Cache (Smart Tiering) on, **Rocket Loader OFF** (it reorders scripts and breaks island hydration).
6. **Pro plan and above only:** Polish = Lossy + WebP/AVIF, Mirage on. Polish converts and recompresses but does **not** resize — oversized images stay oversized in dimensions until Phase 3b.

## 7. Verify at the edge

```bash
# Twice each; second should be HIT
for p in / /trips/ /trips/monsoon-meghalaya/; do
  curl -sI "https://www.seekthethrill.in$p" | grep -iE 'cf-cache-status|cache-control|set-cookie'
done

# Logged in -> BYPASS, and the header avatar must still render
curl -sI -H 'Cookie: user_session=<real session>' https://www.seekthethrill.in/ | grep -i cf-cache-status
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
