# SEO operations

The repository enforces publication, canonical, sitemap, metadata, schema, crawler, and
IndexNow controls. Everything below this line **cannot be done from code** — it needs
production environment access or third-party accounts. This is your checklist.

> **Step-by-step instructions for the config actions live in
> [`docs/seo-launch-runbook.md`](docs/seo-launch-runbook.md)** — click paths, exact values, and
> a verification command per step, plus the Cloudflare fonts Cache Rule this file predates.
> This page stays the standing policy and cadence.

## Already handled in code (no action needed)

- Canonical redirects: HTTP→HTTPS, apex→`www`, lowercase, and trailing slash are folded
  into one 308 hop in `src/middleware.ts`. **The canonical origin is
  `https://www.seekthethrill.in`** — everything below uses it, and so should you.
- Structured data: Organization/WebSite/Person, TouristTrip, Breadcrumb, and per-departure
  Event/Offer JSON-LD with absolute URLs.
- Sitemap (with `lastmod` on every URL), Atom feed, robots.txt (incl. AI crawlers), a
  generated `llms.txt` route carrying live inventory, `noindex` on private routes.
- Past trips keep an internal link and a sitemap entry via `/trips/past/` rather than being
  orphaned the day their last departure passes.
- IndexNow submission wiring (publish/update/delete for trips + albums). **Dormant until you
  set the key — see action 1.**

## Actions you must take

### 1. Activate IndexNow (one config step)
- Generate an IndexNow key (any 8–128 hex chars; e.g. a UUID without dashes).
- Set `INDEXNOW_KEY=<key>` in the production environment (Railway variables).
- Confirm `https://www.seekthethrill.in/<key>.txt` returns the key (the route auto-serves it).
- After that, admin publish/update/delete actions auto-submit changed URLs. No code change.
- Do **not** put the key in the repo — it is a production secret.

### 2. Search engine accounts (one-time)
- Verify `https://www.seekthethrill.in/` in Google Search Console and Bing Webmaster Tools —
  the **www** origin. A property on the apex measures a hostname that only 308s away.
- Submit `https://www.seekthethrill.in/sitemap.xml` in both. Monitor canonical/indexing errors.
- Pull the 28-day baseline before the newly-linked URLs are crawled; without it nothing
  afterwards can be attributed.
- In Bing Webmaster Tools, confirm the IndexNow key is recognized.

### 3. Post-deploy verification (manual checks)
- Confirm the production proxy (Railway) does not add a second redirect hop on top of the
  app's single 308 — test HTTP, `www`, no-slash, and mixed-case URLs each resolve in one hop.
- Run URL Inspection (GSC) on: homepage, trips listing, one trip, FAQ, one album.
- Validate TouristTrip, Event, Breadcrumb, and Organization JSON-LD against visible content
  using Google's Rich Results Test.
- Record mobile field CWV at p75: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1.
- Confirm the `/fonts/` Cache Rule is serving `cf-cache-status: HIT`. The fonts are
  self-hosted and the origin cannot set their TTL, so without that rule every visitor
  re-downloads them (`docs/cloudflare-cache-setup.md` §5b).

### 4. Do not
- Do not use Google's Indexing API for these travel pages (Event/booking pages are not
  eligible; misuse risks manual action).
- Do not buy links or mass-submit to directories (see cadence below).

## Search-intent workflow

Before creating a destination page, record: target intent, primary query, supporting queries, current ranking URL, top competing results, evidence of demand, unique first-hand material, owner, and review date. One canonical page owns each primary intent. Consolidate overlaps instead of producing doorway pages.

Prioritize Search Console queries that already receive impressions, followed by destinations with active inventory and genuine operating experience. Each destination hub should link to its trips, photos, relevant FAQs, and practical guides.

## Content and authority cadence

- Review active trip pages monthly and evergreen guides every six months.
- Update dates, availability, prices, transport, policies, and structured data together.
- Preserve useful completed trips as archived reports; redirect removed or consolidated content to the closest genuine replacement.
- Earn links through real accommodation, guide, tourism, contributor, and editorial relationships. Do not buy links or mass-submit directories.
- Claim business profiles only when their physical-location eligibility requirements are met.

## Monitoring

Track indexed canonical pages, exclusions, crawl/server errors, non-brand impressions, organic landing pages, bookings, referring domains, CWV, rich-result errors, and identifiable AI referrals weekly for eight weeks after launch, then monthly. Compare against pre-release baselines at 28, 56, and 90 days.
