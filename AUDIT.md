# Seek the Thrill — Workflow & Codebase Audit

_Audited: 2026-06-07. Method: traced each end-to-end workflow through admin UI → API route → storage (YAML/SQLite/volume) → frontend render. Findings are grounded in the current code, not the plans._

Severity legend:
- 🔴 **Has to be fixed** — broken, incorrect, data/▶metric loss, or a leak.
- 🟡 **Should be improved** — correctness gaps, missing validation, dead fields, or explicitly-requested features that don't exist yet.
- 🟢 **Could be improved** — polish / nice-to-have.

---

## Workflows mapped

| Workflow | Path | State |
|---|---|---|
| Create / edit / import / duplicate / delete trip | admin → `trips/*` → YAML | ✅ Solid |
| Departures (dates/price/seats/status) | trip editor repeater → `batches[]` | ✅ Solid |
| Occupancy / room-sharing pricing | trip editor → `sharingOptions[]` | ✅ Solid |
| Book a trip (pick date + occupancy) | trip page → `/api/register` → SQLite | ✅ Solid (server-validated) |
| Payment screenshot upload | register form → `/api/upload` → volume | ✅ Works |
| Confirm / reject registration | admin → `/api/admin/update-registration` | ⚠️ see #1 |
| Revenue / payments metrics | dashboard + registrations | 🔴 see #1 |
| Photo albums (create/edit/publish/delete) | admin photo-vault → YAML | ✅ Works |
| Add / delete **photos** in album | `/api/admin/albums/add-photo` etc. | ✅ Works |
| Add / show **videos** | — | 🔴 see #2 — not supported |
| Album → trip photo strip | `linkedAlbumSlug` | ✅ Works |
| Testimonials (CRUD + display) | admin → YAML → home + trip page | ✅ Works |
| FAQ (CRUD + display) | admin → YAML → `/faq` | ✅ Works |
| Settings + legal overrides + IG grid | admin → `site-settings.yaml` | ✅ Works |
| Contact submit + resolve | `/api/contact` + admin | ✅ Works |
| Newsletter signup + unsubscribe | `/api/newsletter` + token page | ✅ Works |
| Broadcast to subscribers | `/api/admin/send-broadcast` | ✅ Works (needs SMTP) |
| Auth / middleware / rate-limit | `middleware.ts`, `rateLimit.ts` | ✅ Works |
| Image serving from volume | `/images/[...path]` | ✅ Works |
| Draft trip privacy + sitemap | trip detail + `sitemap.xml.ts` | 🔴 see #3 |

---

## 🔴 Has to be fixed

### 1. Revenue is permanently ₹0 — `amount_paid` is never written — ✅ FIXED (on confirm, `amount_paid` = trip advance; reversed on un-confirm)
**Where:** `src/lib/db.ts` (`amount_paid INTEGER DEFAULT 0`); no `INSERT`/`UPDATE` anywhere sets it (`/api/register.ts` doesn't, `/api/admin/update-registration.ts` doesn't).
**Impact:** Every money figure is dead and always shows ₹0 — dashboard "Payments collected", registrations "Revenue" stat, the per-registration "Amount Paid", and "Recent activity" amounts. The new `total_amount` (what's owed) IS captured, but `amount_paid` (what's actually been paid) never is.
**Fix options:** (a) on admin **confirm**, set `amount_paid = trip.paymentAmount` (the advance) — simplest, makes revenue = confirmed advances; or (b) add an editable "amount received" field in the registration detail drawer; or (c) set `amount_paid = advance` at registration when a screenshot + transaction ID are provided.

### 2. Videos cannot be added or shown — ❌ REMOVED / WON'T DO (2026-06-07, user decision — feature dropped, not building it)
**Where:** `saveImageFile` and `/api/admin/albums/add-photo.ts` accept images only (`ALLOWED_IMAGE_TYPES` = jpg/png/webp); album photo schema is `{ image, caption }`; the public gallery, album detail, and trip photo strip all render `<img>` only. The reference prototype's album detail had video tiles (play overlay) — that capability was never built.
**Impact:** No way to upload or display videos in albums, despite being a stated requirement.
**Decision (confirmed):** videos are **uploaded files** stored on the volume (not external embeds).
**What this requires:**
- **Storage/serving:** a new upload path that accepts video (`mp4`/`webm`/`mov`) with a sensible cap (e.g. 50–100 MB) — the current 10 MB image limit won't do. Videos must be served by a **range-request-aware** route (HTTP 206 / `Accept-Ranges`); the existing `/images/[...path]` reads the whole file into memory with `readFileSync` and is unsuitable for video — add a streaming route.
- **Volume sizing:** video is large; confirm the Railway volume has headroom and budget.
- **Schema:** album items become typed, e.g. `{ type: 'image'|'video', src, caption, poster? }` (with a back-compat read for existing `{ image, caption }`). A poster/thumbnail per video is recommended for the grid.
- **Admin:** the album editor's "add photo" form needs a video upload control (separate input or accept both).
- **Frontend:** album detail + photo-vault gallery render `<video controls preload="metadata" poster>` for video items; the trip photo strip should show the poster (or skip videos).
**Effort:** medium — touches upload lib, a new streaming route, album schema (+migration), album editor UI, and 2–3 frontend renderers.

### 3. Draft / hidden trips are publicly reachable and in the sitemap — ✅ FIXED (draft trip + unpublished album detail pages redirect; sitemap filtered)
**Where:** `src/pages/trips/[slug].astro` renders **any** slug via `readTrip` with no `status === 'draft'` guard; `src/pages/sitemap.xml.ts` lists **every** trip YAML (including drafts and trips with no upcoming departures).
**Impact:** An unpublished/draft trip is viewable by anyone with the URL and is advertised to search engines. Trips you've "hidden" by lapsing dates still sit in the sitemap.
**Fix:** on the trip detail page, 404/redirect when `status === 'draft'` (and optionally when there are no upcoming departures); filter `sitemap.xml.ts` to live trips (`status !== 'draft' && tripHasUpcomingDates`).

---

## 🟡 Should be improved

### 4. Registration consent isn't stored or server-validated — ✅ FIXED (server rejects without both flags; `consent_at` stored)
**Where:** `trips/[slug].astro` marks the Terms + Cancellation checkboxes `required` (client only); `/api/register.ts` never checks or stores them.
**Impact:** No durable record that a traveller accepted the terms/cancellation policy for a paid booking, and a non-JS/tampered submit bypasses it. That's a legal/operational gap for bookings.
**Fix:** send the two flags, reject server-side if missing, and store them (e.g., `consent_at` timestamp column).

### 5. `whoShouldJoin` and `registrationDeadline` are collected but never used — ✅ FIXED (`registrationDeadline` removed; `whoShouldJoin` rendered on trip page)
**Where:** Both are in the trip editor (and persisted) but `whoShouldJoin` is **not rendered** on the trip page and `registrationDeadline` is **not shown or enforced** anywhere on the frontend.
**Impact:** Admin fills fields that do nothing — the same "dead control" confusion we just cleaned up for pricing.
**Decisions:**
- **`registrationDeadline` → REMOVE** (confirmed). Strip it from the New Trip + edit forms, from `create.ts`/`update.ts`, and from existing trip YAMLs (migrate-out, same approach as the retired pricing/date fields).
- **`whoShouldJoin`** — still open: either render it on the trip page or remove it too.

### 6. Orphaned image files on delete — ✅ FIXED for trip/album/photo deletes (registration-screenshot prune still deferred)
**Where:** `deleteTrip` / `deleteAlbum` / album `delete-photo` remove the YAML/record but not the underlying image files in `CONTENT_DIR/images/...`; registration screenshots in the uploads volume are never cleaned either.
**Impact:** The Railway volume accumulates orphaned files indefinitely.
**Fix:** delete associated images on trip/album/photo deletion; consider a periodic prune for unreferenced uploads.

### 7. Email is silent unless SMTP is configured — ✅ FIXED (admin banner warns when unconfigured; SMTP must still be set in prod)
**Where:** `src/lib/email.ts` falls back to a console "mock" when `SMTP_HOST/USER/PASS` aren't set. All registration confirmations, status emails, and broadcasts depend on these env vars.
**Impact:** If production env isn't configured, **travellers get no emails** and there's no in-app warning — it just silently no-ops.
**Fix:** confirm SMTP is set in production; optionally surface a banner in admin when email is unconfigured.

### 8. `bookedSpots` update is read-modify-write (race) — ✅ ADDRESSED (kept admin-editable counter; documented atomicity invariant — the write is already synchronous so concurrent confirms can't interleave; DB-derived count rejected as it would drop manual/offline seat edits)
**Where:** `/api/admin/update-registration.ts` reads the trip YAML, mutates the departure's `bookedSpots`, and writes it back.
**Impact:** Two confirmations processed simultaneously could lose an increment. Low risk at current scale, but real.
**Fix:** acceptable to defer; note it. A DB-derived count (count of confirmed regs per `batch_id`) would be race-free and is arguably a better source of truth than the YAML counter.

### 9. Registration form collects far less than the schema supports
**Where:** `registrations` table has dietary/medical/emergency-relationship/num_travelers/etc.; the public form collects only name/email/phone/gender/city/emergency/whyJoin + payment.
**Impact:** Not a bug (deliberate simple form), but the trip "max group size" is per-departure now while bookings are one-person rows — group bookings (`num_travelers`) aren't capturable. Worth a conscious decision.
**Decision (confirmed 2026-06-07):** ✅ KEEP the one-person-per-registration model intentionally. Groups simply register more than once. `num_travelers` stays unused. Not to be re-flagged.

---

## 🟢 Could be improved

- **Admin data tables not restyled to cards** (registrations/contacts/newsletter) — ✅ FIXED. All three converted from horizontal-scroll tables to responsive card layouts (mobile-friendly); all interactivity preserved (filters, detail expanders, status/resolve actions, CSV export).
- **Testimonial avatars** — ✅ FIXED. The keystatic schema already has a `photo` field; homepage + trip-page renders now show it when set (fallback to initials), so it's no longer dead.
- **Trip-level vs departure status vocab** — ✅ FIXED. Admin trips list quick-status dropdown + colour/label maps trimmed to the 3 real trip-level statuses (`booking-open / draft / sold-out`); legacy values still render via fallback.
- **`/api/uploads/[filename].ts` content-type** — ✅ FIXED. Maps by extension via a MIME table, defaulting to `application/octet-stream` instead of `image/jpeg`.
- **Stale plan docs** — ✅ FIXED. Moved to `docs/archive/` with a README marking them historical (superseded by the trip-model overhaul; code wins on conflict).
- **About-page copy** — ✅ FIXED. Editable from admin Settings → "About Page" (portrait, byline, caption, quote, body, 3 principles, closing, sign-off, CTA). Blank fields fall back to the built-in defaults, same pattern as the legal-page overrides.

---

## ✅ Verified healthy (don't touch)

- Trip lifecycle: create / edit / **import (YAML/JSON, dry-run)** / duplicate (resets booked) / delete; departures as the single source of truth; occupancy pricing; **booking tied to a departure with server-side validation** (rejects past/draft/sold-out/invalid date, derives total + date server-side).
- Past/draft/completed departures auto-hide; trips with no upcoming departures drop off listings; `upcomingBatches()` evaluated per request.
- Photo vault: album CRUD + publish toggle, add/delete photo, cover image; public gallery + album detail (masonry, lightbox); `linkedAlbumSlug` drives the trip photo strip with a stock fallback.
- Testimonials CRUD → homepage + per-trip carousels (filtered by trip name).
- FAQ CRUD → grouped `/faq`.
- Settings: contact/social, analytics, **legal-page overrides** (blank = built-in page), homepage Instagram images.
- Contact submit + admin resolve; newsletter signup + token unsubscribe; broadcast (batched, 50/chunk, logged); CSV export.
- Auth: middleware guards `/admin` + `/api/admin`; SHA-256 token cookie (httpOnly); rate limiting on register/upload/login (now correctly bypassable in tests only).
- Image serving from the volume (`/images/[...path]`, webp/gif/svg, traversal-guarded, long cache).
- Payment screenshot upload: type/size limited (jpg/png/pdf, 5 MB), UUID-named, served with path-traversal guard.
- **Test suite: 38/38 passing** (`node tests/run.mjs`).

---

## Suggested order of attack
1. **#1 revenue (`amount_paid`)** and **#3 draft/sitemap leak** — small, high-impact correctness fixes.
2. **#4 consent** — quick and legally meaningful.
3. **#2 video** — needs a scope decision (embed vs upload) before building.
4. **#5 dead fields**, **#6 orphan cleanup**, **#7 verify SMTP** — hygiene.
5. The 🟢 items as time permits.

---

# Appendix — SEO & Analytics (GA4 + Microsoft Clarity)

_Verified 2026-06-07. Baseline is solid: `SEO.astro` sets title, meta description, canonical, `robots: index,follow`, full Open Graph (incl. 1200×630 + `og-default.jpg`, which exists) and Twitter `summary_large_image`; `robots.txt` exists and blocks `/admin`, `/api`, `/keystatic`, points to the sitemap; GA4 + Clarity are installed and GA4 events are wired (`view_trip`, `begin_registration`, `submit_registration`, `select_batch`)._

## 🔴 Has to be fixed

### S1. Privacy policy contradicts the tracking actually in use — ✅ FIXED (privacy §7 now discloses GA4 + Clarity)
**Where:** `src/pages/privacy.astro` §7 states _"We use essential session cookies for admin authentication only… We do not use Google Analytics or similar tracking services."_ But `BaseLayout.astro` loads **GA4** (`G-S17TM9KJTG`) and **Microsoft Clarity** (`x2ms8bxixr`) on every page — both set cookies and track behaviour/session recordings.
**Impact:** A factually false privacy statement on a site taking payments and personal data — a real compliance/legal exposure (and Clarity does session replay, which is sensitive).
**Fix:** rewrite the cookies/privacy section to disclose GA4 + Clarity (what they collect, opt-out); add a cookie-consent notice (see S5).

### S2. Sitemap (and draft/unpublished leak) reads seed data, not live content — ✅ FIXED (sitemap built from listTrips/listAlbums, filtered to live)
**Where:** `src/pages/sitemap.xml.ts` reads `join(process.cwd(), 'src/content/trips')` / `…/albums` directly — **not** `CONTENT_DIR` (the Railway volume) and **not** `listTrips()`/`listAlbums()`.
**Impact:** In production, the sitemap reflects the **repo seed trips**, not the trips Zahra actually manages on the volume → wrong/missing URLs for search engines. It also lists **draft trips** and **unpublished albums** (compounds 🔴#3 — both trip detail and album detail render regardless of `status`/`published`).
**Fix:** build the sitemap from `listTrips()`/`listAlbums()` filtered to live items (`status !== 'draft' && tripHasUpcomingDates`; albums `published === true`); and 404/redirect draft trips + unpublished albums on their detail pages.

## 🟡 Should be improved

### S3. GA4 ID is hardcoded — the admin "Google Analytics ID" setting is dead — ✅ FIXED (BaseLayout reads `settings.googleAnalyticsId`)
**Where:** `BaseLayout.astro` hardcodes `G-S17TM9KJTG`, ignoring `settings.googleAnalyticsId` (which the Settings page exposes as an editable field).
**Impact:** Another no-effect admin control; the GA property can't be changed without a code edit.
**Fix:** read `settings.googleAnalyticsId` in `BaseLayout` and inject it (fall back to the constant, or render nothing when blank). Same call for Clarity if you want it admin-managed — otherwise remove the GA field from Settings to avoid the dead-control trap.

### S4. No structured data on trips or FAQ (missed rich results)
**Where:** Only `Organization` JSON-LD exists (in `BaseLayout`). Trip pages have no `Trip`/`Event`/`Product`+`Offer` schema; `/faq` has no `FAQPage` schema.
**Impact:** Foregoes eligible rich snippets (price, dates, FAQ accordions in search) — meaningful for a bookings site.
**Fix:** add `Event`/`Product` JSON-LD per trip (name, image, dates from the soonest departure, price/offer, availability) and `FAQPage` JSON-LD on `/faq`.

### S5. No cookie-consent mechanism
**Where:** GA4 + Clarity load unconditionally for every visitor; no consent banner, no Consent Mode.
**Impact:** Compliance risk (EU visitors / India DPDP direction); pairs with S1.
**Fix:** add a lightweight consent banner and gate GA4/Clarity behind acceptance (or GA Consent Mode v2).

### S6. Analytics fire in dev and on admin pages — ✅ FIXED (GA4/Clarity only inject in PROD and not on /admin)
**Where:** The GA4/Clarity snippets in `BaseLayout` have no `import.meta.env.PROD` guard and load on `/admin` too.
**Impact:** Local/preview traffic and admin sessions pollute analytics (and Clarity may record admin screens).
**Fix:** only inject in `PROD`, and skip on `/admin` routes.

## 🟢 Could be improved

- **Twitter handle mismatch** — `SEO.astro` uses `@seekthethrill`; Instagram is `@seekthethrill_`. Confirm the correct X/Twitter handle (or drop the tag).
- **Sitemap `lastmod`** — never emitted; adding it (trip/album file mtime) helps crawl freshness.
- **`robots.txt`** disallows `/uploads/` but uploads are served under `/api/uploads/` (already covered by `/api/`); harmless leftover.
- **Per-page OG images** — all pages fall back to `og-default.jpg`; trip/album shares would be richer using the trip cover / album cover as `image`.
