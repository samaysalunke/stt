# SEO launch runbook

Four things that cannot be done from the repo. Everything else the audit raised is merged and
deployed; these need a browser and production access.

Do them in order. Step 1 is first because it is the only one that creates a baseline — do the
rest before it and you will have changed the site with nothing to measure the change against.

**The canonical origin is `https://www.seekthethrill.in` — with the `www`.** Middleware
308-redirects the apex to it (`src/middleware.ts`). Verifying, submitting, or testing the
apex measures a hostname that only redirects away. (`SEO-OPERATIONS.md` predates this and
says the opposite in places; this file is the current one.)

---

## 1. Search Console and Bing verification

**Why first:** the verification meta tags are absent from the checked-in settings, so it is
likely the properties were never verified — which would mean no indexing, coverage or Core Web
Vitals data has ever been collected, and no baseline exists. Everything below and every content
change after it is unmeasurable until this is done.

**Check whether it is already done** before doing anything — the live content directory may
differ from the repo:

```bash
curl -s https://www.seekthethrill.in/ | grep -E 'google-site-verification|msvalidate'
```

Two meta tags → already verified, skip to submitting the sitemap. Nothing → continue.

### Google

1. <https://search.google.com/search-console> → **Add property** → **URL prefix** (not Domain).
2. Enter `https://www.seekthethrill.in/` exactly, with the `www` and the trailing slash.
3. Choose the **HTML tag** method. Google shows:
   `<meta name="google-site-verification" content="AbC123..." />`
4. Copy **only the `content` value** — `AbC123...`, not the whole tag.
5. Go to `https://www.seekthethrill.in/admin/settings` → the **Site** section → paste it into
   **Google site verification**. Save.
6. Confirm it is live, then click **Verify** in Search Console:
   ```bash
   curl -s https://www.seekthethrill.in/ | grep google-site-verification
   ```

### Bing

1. <https://www.bing.com/webmasters> → **Add a site** → `https://www.seekthethrill.in/`.
   (Bing offers an "Import from Google Search Console" path — quicker, and it carries the
   verification across. Use it if offered and skip to step 4.)
2. Choose the **Meta tag** option: `<meta name="msvalidate.01" content="1A2B3C..." />`
3. Same admin field group — paste the `content` value into **Bing site verification**. Save.
4. Verify.

### Then, in both

- Submit the sitemap: `https://www.seekthethrill.in/sitemap.xml`
- **Pull the 28-day baseline now, before the recovered URLs get crawled.** Search Console →
  Performance → last 28 days → export. Note total impressions, clicks, and indexed page count.
  Without this export there is nothing to compare the archive and future content against.

---

## 2. Activate IndexNow

Already built and wired into 16 admin routes; dormant because the key is unset
(`src/lib/indexnow.ts` no-ops without it). Turning it on gives same-day Bing and Yandex
re-crawling on every publish, update and delete — worth more here than most sites because the
inventory changes weekly.

**No deploy and no code change.** The key file serves itself the moment the variable exists.

1. Generate a key — 8–128 hex characters:
   ```bash
   openssl rand -hex 16
   ```
2. Railway → the `stt` service → **Variables** → **New Variable**:
   `INDEXNOW_KEY` = the value from step 1. Railway restarts the service on save.
3. **Do not commit the key.** It is a production secret; `.env.example` keeps it blank
   deliberately.
4. Verify — this must return the key itself:
   ```bash
   curl -s https://www.seekthethrill.in/<key>.txt
   ```
   A 404 means the variable did not take effect; check for a typo and that the service
   restarted.
5. In Bing Webmaster Tools → **IndexNow**, confirm the key is recognised.
6. Smoke-test it: edit any trip in admin and save. Bing's IndexNow panel should show a
   submission within minutes.

---

## 3. Cloudflare Cache Rule for the fonts

The webfonts are self-hosted now, which removed a render-blocking request to
fonts.googleapis.com on every page. But they come from our origin with **no useful TTL**, and
no code can fix that: static files are served by the node adapter's handler, which runs before
`src/middleware.ts`, so they leave the origin as `public, max-age=0`. This Cache Rule is the
only edge TTL they get. Without it every visitor re-fetches ~90KB of fonts.

Full steps, including the dashboard traps: **`docs/cloudflare-cache-setup.md` §5b**.

The short version — Caching → Cache Rules → Create rule:

- **Expression:** `starts_with(http.request.uri.path, "/fonts/")`
- **Cache eligibility:** Eligible
- **Edge TTL:** 1 month

**1 month, not 1 year, and never `immutable`** — these filenames are not content-hashed, so a
replaced font has to be able to propagate. If you ever swap a font file, purge `/fonts/*`
manually; nothing purges it automatically.

Verify (expect `cf-cache-status: HIT` on the second request):

```bash
curl -sI https://www.seekthethrill.in/fonts/manrope-latin.woff2 | grep -iE 'cf-cache-status|cache-control'
```

---

## 4. Replace the fallback hero image

`public/images/fallback-hero.jpg` is what a trip card and trip hero fall back to when the trip
has no cover image of its own. It currently ships as a copy of the OG brand card — a squarish
brand graphic, which reads poorly cropped to 4:3 on a card and full-bleed as a hero.

It replaced a hotlinked Unsplash URL, which was the real problem: that value flows into
`Event.image` in the JSON-LD, the OG image and the Twitter card, and a photo on a host we do
not control can vanish and break the rich result on our own page.

**The fix is swapping the file. No code change** — `FALLBACK_HERO` in `src/lib/images.ts`
already points at that exact path.

1. Pick a wide landscape photograph you own — one of Zahra's own trip photos. Roughly 1920×1080
   or wider, under ~300KB.
2. Save it as `public/images/fallback-hero.jpg` (exact filename), commit, push to `main`.
3. Check a trip that has no cover image; the card and hero should show the photo.

Better still: give the trips real cover images in admin, and the fallback stops mattering.

---

## After deploying — verification pass

Railway auto-deploys from `main` only. Once the deploy is through:

```bash
# One 308 and no second hop from Cloudflare — try each shape
curl -sIL http://seekthethrill.in/trips/  | grep -E 'HTTP/|location:'
curl -sIL https://seekthethrill.in/Trips  | grep -E 'HTTP/|location:'

# 16 URLs, every one with a lastmod
curl -s https://www.seekthethrill.in/sitemap.xml | grep -c '<url>'
curl -s https://www.seekthethrill.in/sitemap.xml | grep -c '<lastmod>'

# Current departures with real prices, all on www
curl -s https://www.seekthethrill.in/llms.txt | head -40

# No markdown syntax in any summary, none empty
curl -s https://www.seekthethrill.in/feed.xml | grep -o '<summary>[^<]*' | head

# The four recovered archive URLs still serve, the drafts still 404
curl -sI https://www.seekthethrill.in/trips/past/ | head -1
curl -sI https://www.seekthethrill.in/trips/kashmir-valleys-rivers-lakes/ | head -1
curl -sI https://www.seekthethrill.in/trips/offbeat-wayanad-getaway-september-2025/ | head -1  # expect 404
```

Then, in a browser:

- **Rich Results Test** (<https://search.google.com/test/rich-results>) on a trip page —
  `TouristTrip`, `Event`, `BreadcrumbList` and `FAQPage` should all be detected with no
  warnings about content not visible on the page.
- **URL Inspection** in Search Console on: home, `/trips/`, `/trips/past/`, one trip, `/faq/`.
- `npm run perf:lhci` against production for the font change. There is no local "before" left
  — the render-blocking Google Fonts request is already out of the tree — so production is the
  only honest measurement. Targets at p75 mobile: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1.

Over the following days, watch Search Console coverage pick up `/trips/past/` and the four
archive URLs that previously had no internal link at all.

---

## Still open after this

Tracked in `seo.md` §4, and none of it is config:

- **Destination hubs.** Nothing on the site answers a question someone asks *before* choosing an
  operator. This is the only item with no ceiling, and the one Search Console data from step 1
  should direct.
- **Per-trip `Review` markup** — blocked on the testimonial schema, which has no date field and
  no real trip relation. Not a config step.
- **Authored `seoTitle`/`seoDescription`** for the four trips still using generated metadata,
  starting with the two currently listable.
