# SEO — Implementation Plan & Best Practices

Engineering-facing companion to `SEO-OPERATIONS.md` (which covers launch/monitoring ops).
This file documents what the `feat(seo): improve search discoverability` commit (`c8472bf`)
put in place, the open fixes it left behind, and the conventions to keep following.

---

## 1. What the commit established

### Crawl & index control
- `public/robots.txt` — disallows `/keystatic/`, `/admin/`, `/api/`; same public-only
  policy explicitly extended to AI crawlers (OAI-SearchBot, ChatGPT-User, PerplexityBot,
  GPTBot, ClaudeBot). Sitemap declared.
- `src/middleware.ts` — sets `X-Robots-Tag: noindex, nofollow` response header on private
  routes (`/admin/`, `/api/`, `/keystatic/`, `/profile/`, `/login/`, `/unsubscribe/`).
  Defense in depth beyond robots.txt.
- `public/llms.txt` — canonical page map for LLM consumers.

### Canonicalization
- One canonical origin + path shape. Middleware (PROD only) 308-redirects
  `www.` → apex and `http:` → `https:`, and appends a trailing slash to extensionless
  page paths. Excluded prefixes: `/admin`, `/api`, `/keystatic`, `/profile`, `/login`,
  `/unsubscribe`, `/leaderboard`, `/u/`, and any `*/book`.
- `src/components/SEO.astro` — canonical URL normalized to the same trailing-slash shape;
  configurable `robots` and `imageAlt`; OG `locale` + `image:alt`; Twitter `image:alt`.

### Publication model (single source of truth for visibility)
- `src/lib/trips.ts` — `PublicationStatus = draft | published | archived | test`.
  - `tripPublicationStatus()` — explicit field, else `qa-test-*` slug ⇒ `test`, else `published`.
  - `isTripPublic()` — detail-page gate; `published`/`archived` (test only if `ALLOW_TEST_CONTENT=true`).
  - `isTripListable()` — listing/sitemap/feed gate; public **and** has an upcoming departure.
- `src/lib/albums.ts` — `isAlbumPublic()` (`published`/`archived`, legacy `published===true` fallback).
- `keystatic.config.tsx` — `publicationStatus` select on trips + albums; `seoTitle`,
  `seoDescription`, `imageAlt`/`socialImageAlt` fields. Old album `published` checkbox removed.
- Consumers switched to these helpers: `sitemap.xml.ts`, `feed.xml.ts`, `trips/index.astro`,
  `photo-vault/index.astro`, `trips/[slug].astro`.
- Unpublished/test trip detail now returns a real **404** (was a redirect).

### Discovery surfaces
- `src/pages/sitemap.xml.ts` — `isTripListable`/`isAlbumPublic` gating, `escapeXml` + slug
  `encodeURIComponent`, trailing slashes, `/cancellation/` added.
- `src/pages/feed.xml.ts` — new Atom feed of listable trips. Linked from `BaseLayout`.

### Structured data
- `BaseLayout.astro` — `@graph` with `WebSite` + `Organization` (+ founder `Person`,
  social `sameAs`, contactPoint).
- `trips/[slug].astro` — `@graph` of `BreadcrumbList` + per-departure `Event`/`Offer`.

### Performance / on-page
- Trip hero: CSS `background-image` → real `<img>` with `width/height/fetchpriority="high"/decoding`
  (proper LCP element). Gallery + hero `alt` text added.
- `src/lib/_contentBase.ts` — uploads optimized to WebP via `sharp` (resize ≤1920,
  q82), except `/qr` images. *(Note: unrelated to SEO — see Fix #3.)*

---

## 2. Open fixes (carried from review of c8472bf)

1. ~~**Dead `eventStatus` ternary**~~ — DONE. `trips/[slug].astro` now emits a flat
   `eventStatus: 'https://schema.org/EventScheduled'`; sold-out stays in `offers.availability`.
2. ~~**Relative image URL in JSON-LD**~~ — DONE. `heroImgAbs` absolutizes against the canonical
   origin; `Event.image` uses it.
3. **Untangle the WebP pipeline** — STILL OPEN. The `sharp`/WebP upload change is image
   optimization, not SEO. Split into its own commit. Verify: existing `.jpg`/`.png` files are not
   orphaned, no hardcoded extension references break, and re-uploads overwrite cleanly.
4. ~~**Guard the middleware redirect by method**~~ — DONE. Path-shape redirect is now gated to
   `GET`/`HEAD`; host/protocol normalization applies to all methods (308 preserves the body).
5. **Feed title/summary consistency** — STILL OPEN. `feed.xml.ts` uses `trip.title || trip.name`
   while the rest uses the `tripName` helper; summary can come out empty. Reuse one source.
6. **Confirm no redirect chains** — VERIFY IN PROD. Host + protocol + case + trailing slash are
   now folded into a **single** 308 in middleware. Still confirm the Railway proxy doesn't add a
   second hop on top.

### IndexNow (SEO-OPERATIONS.md item 7) — DONE in code, needs a prod key
- `src/lib/indexnow.ts` — `submitToIndexNow(paths)`; no-op unless `PROD` + `INDEXNOW_KEY` set.
  `indexNowUrls()` (pure: absolutize + de-dupe) is unit-tested.
- `src/pages/[key].txt.ts` — serves the ownership key at `/<key>.txt`; 404s for any other value.
- Wired into admin create/update/delete for trips and albums (slug-change submits old + new URL).
- **To activate:** set `INDEXNOW_KEY` in production. Key file auto-serves; no other step.

---

## 3. Best practices to follow going forward

### Visibility
- Never gate visibility on ad-hoc fields in pages. Always route through
  `isTripPublic` / `isTripListable` / `isTripArchived` / `isAlbumPublic`.
  - `/trips/`, the homepage, and the feed show only **listable** trips.
  - `/trips/past/` shows **archived** ones. `isTripArchived` = public but not listable, which
    covers both an explicit `archived` status and a `published` trip whose every departure has
    passed. A past trip keeps an internal link and stays in the sitemap at priority `0.5` —
    dropping it from every discovery surface the day its last date passed is what orphaned
    four live URLs before.
  - Detail pages show anything public. Drafts and QA fixtures appear on no surface at all.
- Test/QA content stays out of all public surfaces. `qa-test-*` slugs auto-classify as `test`;
  surface them only with `ALLOW_TEST_CONTENT=true` in non-prod.
- Removed/unpublished content returns **404** (or 410 if permanently gone) — never a soft
  redirect to a listing, which reads as a soft-404 to crawlers.

### Canonical & URLs
- One origin: `https://seekthethrill.in`, lowercase, trailing slash on pages. Keep
  middleware, `SEO.astro` canonical, sitemap, and internal links all emitting that shape.
- Every internal link to a page uses the trailing-slash form to avoid a redirect hop.
- New private route prefixes must be added to **both** the middleware non-indexable list
  and the `X-Robots-Tag` private list (they are separate arrays — keep them in sync).

### Metadata
- Every page passes `title` + `description`. Prefer authored `seoTitle`/`seoDescription`
  (CMS) over generated fallbacks. Title ≤ ~60 chars, description ≤ ~155.
- Every meaningful `<img>` has real `alt`. Social/OG images pass `imageAlt`.
- OG/Twitter image URLs absolute; default OG image kept at 1200×630.

### Structured data
- All JSON-LD URLs (image, url, item, @id) **absolute**. No relative paths.
- Reuse stable `@id`s (`#organization`, `#website`, `#breadcrumb`) so nodes link instead of
  duplicate. Validate every type against visible page content (no schema for hidden data).
- Keep Event/Offer prices and availability in sync with the rendered departure data.

### Feeds & sitemap
- XML output always `escapeXml`'d; slugs `encodeURIComponent`'d.
- Sitemap lists only listable/public URLs with accurate `lastmod` from `contentLastmod`.
- New top-level public page ⇒ add it to the sitemap static list.

### Performance (Core Web Vitals)
- LCP image is a real `<img>` with explicit `width`/`height` + `fetchpriority="high"`;
  never a CSS background. Below-fold images `loading="lazy"`.
- Targets at p75 mobile: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1. Always set dimensions to
  reserve layout space (CLS).

### Crawlers
- Public-only policy applies equally to search and AI crawlers; keep robots.txt groups in sync
  with the middleware private list.
- Keep `llms.txt` pointing only at canonical, authoritative pages.

### Process
- Keep SEO changes scoped. Don't bundle unrelated pipeline/infra changes into an "SEO" commit —
  it blocks clean review, bisect, and revert.
- Any change touching visibility, canonical shape, or structured data ⇒ add/extend
  `tests/unit/seo.test.ts` (leak guards, robots, noindex header).

---

## 4. Backlog (not yet built — from SEO-OPERATIONS.md)

- Search Console + Bing Webmaster verification; submit sitemap.
- IndexNow on publish/update/redirect/delete events (after hosting a prod key); skip unchanged URLs.
- Destination hub pages owning one primary intent each (no doorway pages).
- Per-page CWV field monitoring and 28/56/90-day baseline comparison.
