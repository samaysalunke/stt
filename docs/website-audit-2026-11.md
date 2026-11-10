# Website audit: visibility & conversion (November 2026)

**Site:** www.seekthethrill.in · **Scope:** where people drop off on the way to a booking, and what to change, for search visibility and conversion.

---

## 0. What this audit is based on (read first)

| Source | Status | What it means |
| --- | --- | --- |
| Google Analytics 4 (`G-S17TM9KJTG`) | **Not accessed.** No GA connector or credentials were available in this session. | Drop-off rates below are *predicted from the build*, not measured. Section 7 lists the exact GA4 reports needed to confirm each one. |
| Microsoft Clarity (`x2ms8bxixr`) | **Not accessed.** Same reason. | Section 7 lists the Clarity filters and recordings to pull. |
| Live site | **Not reachable.** The session's network policy blocks `seekthethrill.in`. | Pages were reviewed in a local copy of the code, with the clock set to 15 May 2026 so trips showed as bookable, at Pixel 7 phone size. |
| Codebase (`main` @ `2d7e8bb`) | Fully reviewed: funnel pages, checkout, tracking, SEO and structured data. | Every finding cites the file behind it. |

> Trip content in the repo is seed data. Live trips, prices and testimonials are managed in the admin panel and may differ. The findings are about page structure and flow, which are the same in production.

**The single most important finding:** the site cannot currently tell you where users drop off. The trip-view event never fires, and the checkout has no step events. **Fix measurement first (section 3).** Within about two weeks GA4 will then answer this question with real numbers.

---

## 1. The funnel as built

Most paying traffic arrives from **Instagram DMs straight onto a trip page**, in Instagram's in-app browser (see `docs/instagram-dm-attribution.md`). The homepage is a secondary entry point. The trip page is the real landing page.

```
Instagram DM / search / direct
        │
        ▼
 Trip page /trips/<slug>/        ← main landing page
   choose date → choose occupancy → "Save my spot"
        │
        ▼
 /book  Step 1 Review            (no data entered)
        │
        ▼
 /book  Step 2 Details           10 fields, 9 required   ← lead captured on submit
        │
        ▼
 /book  Step 3 Pay & Confirm     manual UPI / bank transfer
                                 + screenshot upload + 2 checkboxes
        │
        ▼
 "Under review": a person checks the transfer within 24h → confirmed
```

### Where users are most likely dropping off (ranked)

| # | Stage | Why we expect a leak | Evidence | Confirm with |
| --- | --- | --- | --- | --- |
| 1 | **Step 3 → paid** (manual UPI + screenshot) | The user must leave the site, open a UPI app, type or paste the UPI ID, pay, return, find the screenshot and upload it. On a phone, inside Instagram's browser, many people never return to the tab. There is no UPI deep link, no QR code and no payment gateway. "I'll pay later" sits right under the main button and gives an easy exit. | `BookingCheckout.tsx` lines 1040–1224 | Step-2 leads compared with paid registrations in admin (`/admin/registrations/unpaid-leads`). Clarity recordings on `/book` that end on step 3. |
| 2 | **Trip page → "Save my spot"** | On mobile the booking panel starts **about 3,200px down (3.8 screens)**. The sticky button only scrolls to it. Once there, the user has to choose a date *and* an occupancy before the button works. Until then it stays greyed out and does nothing when tapped. The WhatsApp float is **turned off** on trip pages (`hideWhatsApp={true}`), so a hesitant visitor has no quick way to ask a question. | `trips/[slug].astro` lines 321 and 699; `BookingPanel.tsx` line 426 | GA4: share of trip-page views that fire `select_batch`. Clarity: dead clicks and rage clicks on `#booking-panel-cta`, and scroll depth. |
| 3 | **Step 2 Details** | There are 9 required fields: emergency contact name and number, a free-text "Why do you want to join?", age, city and state. That is a lot to type on a phone before anything is committed. | `BookingCheckout.tsx` line 442 | Clarity: recordings on `/book` that stop on the form. Form abandonment once the step events in section 3 exist. |
| 4 | **Homepage → trip** | Above the fold there are no trips, prices or destinations, only the brand, a slogan and two stats. The first trip card starts at about 1,090px. The hero is a hot-linked Unsplash stock photo, which makes the main image (and so LCP) depend on a third-party server. | `index.astro` lines 81–201 | GA4: homepage bounce or engagement rate. Clarity: homepage scroll-depth heatmap. |
| 5 | **Instagram browser → another browser** | Someone browses in the DM and pays days later in Chrome. GA4 records this as two unrelated users. That is not a real leak, but it makes the funnel *look* broken. | `docs/instagram-dm-attribution.md` | Compare in-house `first_touch_json` on registrations with GA4 source/medium. |

---

## 2. Conversion: findings and fixes

Priority: **P0** = this week, **P1** = this month, **P2** = next quarter. Impact and effort are estimates.

### Trip page (main landing page)

| Pri | Finding | Fix | Impact | Effort |
| --- | --- | --- | --- | --- |
| P0 | On mobile the price, dates and CTA are about 4 screens below the hero. Visitors arriving from a DM have to scroll past the description, highlights, photos and itinerary to find the booking panel. | On mobile, move the booking panel (or a compact "dates + price + CTA" block) **directly under the at-a-glance strip**. Keep the long content below it. | High | S |
| P0 | `Save my spot` is greyed out until a date **and** an occupancy are chosen. Taps on it do nothing and give no hint why. | Pre-select the soonest available date and the cheapest tier, as `/book` already does when the URL has no tier. Or have a tap on the disabled button scroll to and highlight the first missing choice. | High | S |
| P0 | There is no WhatsApp or "ask a question" option on the trip page (`hideWhatsApp={true}`). For a ₹25–35k purchase, a quick question is the most common reason to hesitate. | Restore the WhatsApp float on trip pages, or add a "Questions? Chat with Zahra" link under the CTA. Pre-fill the message with the trip name and date. Track clicks (section 3). | High | S |
| P1 | Testimonials on trip pages are global, not tied to the trip. There is no star rating anywhere. The seed testimonial names look like placeholders (Amit Verma, Priya Patel). | Show testimonials from *this* destination first, with the trip name and month. Collect reviews on Google Business Profile and show the count and rating. Link the photo vault albums from each trip page as real proof. | Med–High | M |
| P1 | "Advance is non-refundable" is the only reassurance near the price. Cancellation terms are behind a link. | Add a 3-line trust block next to the CTA: refund or transfer policy in plain words, "Women-friendly, X% solo travellers", and "Small group, max N". The women-booked count already exists (`womenBookedLabel`), so use it on the date list too. | Med | S |
| P2 | Scarcity labels ("Filling fast", "N spots left") only show after a date is chosen. | Show live spots-left on the hero date chips, which are visible on arrival. | Med | S |

### Checkout (`/trips/<slug>/book`)

| Pri | Finding | Fix | Impact | Effort |
| --- | --- | --- | --- | --- |
| P0 | Payment is a manual UPI or bank transfer plus a screenshot upload, then a wait of up to 24h for a person to confirm. | **Short term:** add a `upi://pay?pa=…&am=<advance>&tn=<trip>` deep link button ("Pay ₹X in your UPI app") and a QR code for desktop. That removes the copy-paste step. **Medium term:** a payment gateway (Razorpay or Cashfree) for the advance gives instant confirmation and removes the screenshot step and the manual review. | **Very high** | S / M |
| P0 | "I'll pay later" sits directly under the main button with similar visual weight. | Keep it, but make it a small text link. Have it start the existing unpaid-lead nudge (Telegram or WhatsApp) within an hour, not just show a message. | Med | S |
| P1 | Step 1 "Review" repeats what the user just chose on the trip page. It adds a tap and a page state with no new information. | Merge the review summary into the top of step 2 and go straight to details. | Med | S |
| P1 | Nine required fields before payment, including the emergency contact and a free-text essay. | Ask only for name, WhatsApp, email and age before payment. Collect the emergency contact, city/state and "why join" **after** payment (confirmation email or the profile page). The lead is still captured, because the step-2 submit creates the row. | High | M |
| P2 | The Google sign-in prompts after booking open OAuth inside Instagram's in-app browser. Google blocks that ("disallowed_useragent"). | Detect the Instagram or Facebook webview and show "Open in browser" instead of the Google button. | Low–Med | S |

### Homepage

| Pri | Finding | Fix | Impact | Effort |
| --- | --- | --- | --- | --- |
| P1 | The fold has no trips, dates or prices. "Group trips for travellers. Offbeat spots, zero fluff." doesn't say *where* or *when*. | Replace the stats card with the next 2–3 departures (destination · dates · from ₹). Rewrite the subhead to name destinations, e.g. "Small-group trips to Meghalaya, Ladakh, Arunachal & more." | Med–High | S |
| P1 | The hero and newsletter backgrounds are Unsplash stock images loaded from `images.unsplash.com`. Stock imagery weakens trust for a "real trips" brand, and a third-party LCP image is slower and fragile. | Use a real trip photo, served from `/images/` through the existing variant pipeline. | Med | S |
| P2 | The "340+ adventurers" and "10+ destinations" stats are hard-coded. | Pull them from `src/lib/stats.ts` so they stay accurate. | Low | S |

---

## 3. Measurement fixes (P0, do these first)

The current GA4 setup sends `page_view`, `select_batch`, `wishlist_view`, `wishlist_join`, `submit_registration` and the Core Web Vitals events. These are the gaps:

1. **`view_trip` never fires (bug).** The inline script in `trips/[slug].astro` lines 325–329 is rendered into `<slot name="head" />`, which is BaseLayout.astro line 118. `gtag` isn't defined until about line 230. `typeof gtag !== 'undefined'` is therefore always false, and the event is silently skipped. A smaller problem in the same script: `trip_name` is JSON-encoded twice, so it would arrive with literal quote marks. **Fix:** run the call after the GA snippet (for example in a body script), or queue it with the standard stub, `window.dataLayer=window.dataLayer||[]; function gtag(){dataLayer.push(arguments);}`, so gtag.js picks it up when it loads. Pass `tripName` and `slug` raw, not through `JSON.stringify`.
2. **No checkout step events.** Add GA4 recommended e-commerce events so the funnel report works with no setup:
   - `view_item` on the trip page (replacing or alongside `view_trip`), with `item_id=slug` and `price=fromPrice`
   - `select_item`, or keep `select_batch`, for the date, and `select_tier` for occupancy
   - `begin_checkout` when `/book` step 1 renders
   - `add_shipping_info`, or a custom `submit_details`, at step 2 → 3. This is the lead.
   - `add_payment_info` when the screenshot upload succeeds
   - `purchase` when `submit_registration` fires with payment, with `value=advanceDue`, `currency=INR` and `transaction_id=registration id`
   - `pay_later_click`, `whatsapp_click` (with location: float, panel or checkout), `upi_copy` and `bank_copy`
3. **Mark key events in GA4:** `submit_details` (lead), `purchase`, `wishlist_join` and `whatsapp_click`.
4. **Clarity tags.** Call `clarity('set','page_type','trip'|'checkout'|…)`, `clarity('set','trip',slug)` and `clarity('set','checkout_step','1'|'2'|'3')`, and `clarity('event', …)` for the same milestones. This lets you filter recordings like "reached step 3 and did not purchase".
5. **Cross-browser identity.** Pass the registration id as GA4 `user_id` and Clarity `identify` once a lead exists. The Instagram-browser → Chrome journey then joins up.

---

## 4. Visibility (search and AI answers)

Technical SEO is **already strong**: canonical redirects, a sitemap with lastmod, TouristTrip, Event, Offer, Breadcrumb and FAQ JSON-LD, robots.txt allowing AI search crawlers, `llms.txt` and IndexNow wiring. The gaps are **content and off-site authority**, not tags.

| Pri | Finding | Fix |
| --- | --- | --- |
| P0 | Ops items in `SEO-OPERATIONS.md` may still be open: IndexNow key, Search Console / Bing verification on the **www** origin, sitemap submission. | Check each one. Without Search Console there is no query data to plan content from. |
| P1 | There are no destination pages. The only indexable pages per destination are dated trip pages. When a departure passes, the page loses its offer and much of its value. | Create one evergreen hub per destination, e.g. `/destinations/meghalaya/`, covering best season, how to get there, what our trip covers, past trip photos and reports, FAQs, and the current departures. Point trip pages at the hub. This is the "one page owns each intent" rule already in `SEO-OPERATIONS.md`. |
| P1 | Trip names and slugs carry dates ("…-september-2025"). Each year starts a new URL with no ranking history. | Use stable, undated slugs per itinerary (`/trips/wayanad-getaway/`) with departures as dates inside the page. The slug-alias redirect system (`tripSlugAliases.ts`) already supports moving over. |
| P1 | There is no informational content. People search "Meghalaya group trip from Bangalore", "solo female trip Northeast India" and "Hornbill festival group tour". | Write 1–2 guides a month on high-intent topics, each linking to a hub and a trip. Prioritise the destinations that have live inventory. |
| P1 | There is no review signal: no Google Business Profile reviews and no `aggregateRating`. | Set up or claim a Google Business Profile and ask every returning traveller for a review. Once the reviews are real and shown on the page, add `AggregateRating` to Organization. |
| P2 | Image alt text is generated ("X group trip in Y — travel photo 3"). | Fine for accessibility. Add captions with place names to gallery photos for image search. |
| P2 | Homepage `<title>` is "Seek the Thrill — Offbeat Group Trips Across India". | Consider "Offbeat Group Trips in India for Solo Travellers \| Seek the Thrill" to match how people actually search. |

---

## 5. Roadmap

| When | Do | Expected effect |
| --- | --- | --- |
| **Week 1** | Fix `view_trip`; add the funnel events and key events; add Clarity tags; check Search Console | You can see the real drop-off |
| **Week 1–2** | UPI deep link and QR; pre-select date and tier; WhatsApp back on trip pages; move the panel up on mobile; demote "I'll pay later" | Biggest conversion lift for the least work |
| **Month 1** | Cut step 2 to 4 fields; merge step 1; homepage fold shows departures; real hero photo; trust block | Less form abandonment, better homepage click-through |
| **Month 2–3** | Payment gateway for the advance; destination hubs; undated slugs; Google reviews; 1–2 guides a month | Instant confirmation; organic traffic that doesn't depend on Instagram |

---

## 6. How to measure success

Set the baseline in GA4 the week after the section 3 events ship, then track weekly:

- trip view → `select_batch` rate
- `begin_checkout` → lead (`submit_details`) rate
- lead → `purchase` rate (the manual-UPI step; the gateway should move this most)
- WhatsApp clicks per trip view
- organic sessions and Search Console impressions for destination queries

---

## 7. Data to pull to confirm this audit

Share these exports, or connect GA4 / Clarity to a session, and the predictions above can be replaced with measured numbers.

**GA4, last 90 days**
1. Reports → Engagement → Pages and screens: views, engagement rate and average engagement time for `/`, `/trips/`, each `/trips/<slug>/` and `/trips/<slug>/book`.
2. Explore → Funnel: `page_view /trips/*` → `select_batch` → `page_view */book` → `submit_registration`. Make it open, split by device category and by session source/medium.
3. Acquisition → Traffic acquisition: sessions, engagement rate and `submit_registration` by source/medium, especially `instagram / dm`, organic and direct.
4. Landing page report: which pages people arrive on, and their bounce rate.
5. Events: counts for `select_batch`, `wishlist_join`, `submit_registration`, and LCP/INP/CLS by page.

**Clarity, last 30 days**
1. Dashboard: dead clicks, rage clicks, quick backs and excessive scrolling, by page.
2. Scroll heatmaps for the homepage and 2 top trip pages, on mobile.
3. Click heatmap for a trip page on mobile. Look for taps on the disabled "Save my spot".
4. 10–15 recordings filtered to URL contains `/book`, ending on that page. Note which step people leave on.
5. Filter Browser = Instagram (in-app) and compare it with Chrome on the same pages.

**From the admin panel**
- The number of step-2 leads compared with paid registrations per departure (`/admin/registrations/unpaid-leads`). This is the step-3 drop-off rate, and it is available today without GA.
