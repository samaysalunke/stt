# SEO operations

The repository enforces publication, canonical, sitemap, metadata, schema, crawler, and
IndexNow controls. Everything below this line **cannot be done from code** — it needs
production environment access or third-party accounts. This is your checklist.

## Already handled in code (no action needed)

- Canonical redirects: HTTP→HTTPS, `www`→apex, lowercase, and trailing slash are folded
  into one 308 hop in `src/middleware.ts`.
- Structured data: Organization/WebSite/Person, Breadcrumb, and per-departure Event/Offer
  JSON-LD with absolute URLs.
- Sitemap, Atom feed, robots.txt (incl. AI crawlers), `llms.txt`, `noindex` on private routes.
- IndexNow submission wiring (publish/update/delete for trips + albums). **Dormant until you
  set the key — see action 1.**

## Actions you must take

### 1. Activate IndexNow (one config step)
- Generate an IndexNow key (any 8–128 hex chars; e.g. a UUID without dashes).
- Set `INDEXNOW_KEY=<key>` in the production environment (Railway variables).
- Confirm `https://seekthethrill.in/<key>.txt` returns the key (the route auto-serves it).
- After that, admin publish/update/delete actions auto-submit changed URLs. No code change.
- Do **not** put the key in the repo — it is a production secret.

### 2. Search engine accounts (one-time)
- Verify `https://seekthethrill.in/` in Google Search Console and Bing Webmaster Tools.
- Submit `https://seekthethrill.in/sitemap.xml` in both. Monitor canonical/indexing errors.
- In Bing Webmaster Tools, confirm the IndexNow key is recognized.

### 3. Post-deploy verification (manual checks)
- Confirm the production proxy (Railway) does not add a second redirect hop on top of the
  app's single 308 — test HTTP, `www`, no-slash, and mixed-case URLs each resolve in one hop.
- Run URL Inspection (GSC) on: homepage, trips listing, one trip, FAQ, one album.
- Validate Event, Breadcrumb, and Organization JSON-LD against visible content using
  Google's Rich Results Test.
- Record mobile field CWV at p75: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1.

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
