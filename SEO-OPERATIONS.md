# SEO operations

The repository enforces publication, canonical, sitemap, metadata, schema, and crawler controls. The remaining work requires production and third-party account access.

## Launch checklist

1. Verify `https://seekthethrill.in/` in Google Search Console and Bing Webmaster Tools.
2. Submit `https://seekthethrill.in/sitemap.xml` and monitor canonical/indexing errors.
3. Confirm the production proxy redirects HTTP, `www`, non-trailing-slash page URLs, and mixed-case URLs in one hop.
4. Run URL Inspection on the homepage, trips listing, one trip, FAQ, and one album.
5. Validate Event, Breadcrumb, Organization, and ImageGallery JSON-LD against visible content.
6. Record mobile field CWV targets: LCP <= 2.5s, INP <= 200ms, CLS <= 0.1 at p75.
7. Configure IndexNow only after creating and hosting a production key. Submit publish, update, redirect, and delete events; do not send unchanged URLs.
8. Do not use Google's Indexing API for these travel pages.

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
