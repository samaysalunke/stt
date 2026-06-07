# v2 Admin Redesign Plan

Reference designs: `uxpilot-admin/` files 11–20 ("Travel Dashboard 2" series).
Files 1–10 are an earlier iteration — ignore them.
Stack stays the same: Astro SSR + SQLite + YAML. No new packages.

---

## Why the admin needs to change

Two separate drivers:

**1. Functional — required by v2-redesign.md**
The frontend photo strip on trip detail pages needs albums linked to trips via a `linkedAlbumSlug` field on the trip YAML. That field has to be settable somewhere — the trip editor (`/admin/trips/[slug].astro`) gets a "Link photo album" dropdown for this. Without this, the photos strip always falls back to Unsplash placeholders.

**2. Visual — driven by UXPilot designs**
The current admin uses a dark-green theme (`#111D27`) with a horizontal scrolling tab bar — completely disconnected from the public-facing redesign's coral/navy/blush palette. The UXPilot designs align the admin with the same design system. Additionally, two genuinely useful screens exist in the designs (Dashboard overview, Settings) that have no current implementation.

---

## Scope summary

| File | Change type | Driver |
|---|---|---|
| `src/layouts/AdminLayout.astro` | Full rewrite | Visual |
| `src/pages/admin/login.astro` | Restyle | Visual |
| `src/pages/admin/index.astro` | Build dashboard (replaces redirect) | Visual |
| `src/pages/admin/trips/index.astro` | Restyle: table → card list | Visual |
| `src/pages/admin/trips/[slug].astro` | Restyle + album link field | Visual + Functional |
| `src/pages/admin/registrations.astro` | Restyle + add detail drawer | Visual |
| `src/pages/admin/photo-vault/index.astro` | Restyle: grid → collections | Visual |
| `src/pages/admin/photo-vault/new.astro` | Restyle: form → dropzone | Visual |
| `src/pages/admin/photo-vault/[slug].astro` | Restyle only (no new field — see §9) | Visual |
| `src/pages/admin/trips/new.astro` | Restyle (same layout as `trips/[slug].astro`) | Visual |
| `src/pages/admin/contacts.astro` | Restyle only | Visual |
| `src/pages/admin/newsletter.astro` | Restyle only | Visual |
| `src/pages/admin/settings.astro` | New page | Visual |
| `src/pages/admin/broadcast.astro` | Integrate into dashboard | Visual |

**API routes:** All existing `/api/admin/*` routes stay as-is, except one new route: `src/pages/api/admin/settings/update.ts` (see §12).

> **Atomic rename warning:** Changing the `AdminLayout` prop from `activeTab` to `page` (see §1) breaks every admin page simultaneously at the TypeScript level. When `AdminLayout.astro` is rewritten, all 12 admin pages (`trips/index`, `trips/[slug]`, `trips/new`, `registrations`, `photo-vault/*`, `contacts`, `newsletter`, `broadcast`, `login`, `settings`, `index`) must have their prop updated in the same commit. Do not land the layout change without updating all callers in one pass.

---

## Design system — shared across all admin pages

The UXPilot designs use the same tokens as the frontend. All admin pages adopt these:

**Colors** (same as `global.css` — no new CSS variables needed):
- Background: `#F5F5F3` (gray-soft)
- Card/surface: `#FFFFFF`
- Accent/active: `#E8725A` (coral)
- Primary text: `#1B2B3A` (navy)
- Borders/dividers: `#F5DDD7` (peach) at 20–30% opacity
- Muted text: `#1B2B3A` at 40–60% opacity

**Typography**: Fraunces (headings, numbers), DM Sans (body, labels) — already loaded via the public site's font stack. Admin pages inherit this via `<link>` in `AdminLayout`.

**Component shapes**:
- Cards: `rounded-[2rem]` to `rounded-[2.5rem]`
- Buttons/chips: `rounded-full` (pills) or `rounded-xl` (square-ish)
- Status badges: `rounded-full`, tiny (`text-[9px]`, `px-2.5 py-1`)
- Input fields: `rounded-2xl`, `border border-peach/20`
- KPI cards: `rounded-[2.5rem]`, icon in a `rounded-2xl` container

**Layout**:
- Top bar: fixed, `bg-white/80 backdrop-blur-md`, `border-b border-peach/20`
- Sidebar: drawer pattern (hidden by default, slides in from left, `w-72`)
- Overlay: `bg-navy/40 backdrop-blur-sm` behind open sidebar
- Page content: `pt-24 pb-12 px-6` (clears fixed header)

---

## 1. `src/layouts/AdminLayout.astro` — Full rewrite (foundation)

This is the most important change. Everything else depends on it. Do this first.

### Current
Dark green sticky top bar (`background: var(--color-primary-dark)`), horizontal scrolling nav with 6 tabs (Trips / Photo Vault / Registrations / Contacts / Newsletter / Broadcast), inline CSS for tab active states.

### New structure

**Top bar (fixed):**
```html
<header class="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md
               px-6 py-4 flex items-center justify-between border-b border-peach/20">
  <!-- Left: hamburger + page title -->
  <div class="flex items-center gap-3">
    <button id="menu-toggle" class="w-10 h-10 bg-navy/5 rounded-xl flex items-center
                                     justify-center text-navy">
      <!-- bars-staggered icon (3 lines of different lengths) -->
    </button>
    <div>
      <h1 class="font-display text-lg font-semibold leading-none">{title}</h1>
      <span class="text-[10px] font-semibold uppercase tracking-widest"
            style="color: var(--color-coral);">Admin Portal</span>
    </div>
  </div>
  <!-- Right: notification bell + avatar -->
  <div class="flex items-center gap-3">
    <div class="relative">
      <!-- bell icon -->
      <span class="absolute -top-1 -right-1 w-2 h-2 bg-coral rounded-full
                   border-2 border-white"></span>
    </div>
    <img src="/logo.jpg" class="w-8 h-8 rounded-full border border-peach" />
  </div>
</header>
```

**Sidebar drawer (slides in from left):**

Nav items (9 total):
```
Dashboard         → /admin/
Trip Management   → /admin/trips/
Registrations     → /admin/registrations/
Photo Vault       → /admin/photo-vault/
Newsletter        → /admin/newsletter/
Contacts          → /admin/contacts/
Broadcast         → /admin/broadcast/
Settings          → /admin/settings/
```

Active item: `bg-coral/10 text-coral font-semibold`, inactive: `text-navy/60`.

Bottom of sidebar: Zahra avatar + name + logout button (same as current, restyled).

**Props change:**
Current `activeTab` prop is a union string. Change to `page` prop (same concept, same values, add `'dashboard'` and `'settings'`).

```ts
interface Props {
  title: string;
  page: 'dashboard' | 'trips' | 'registrations' | 'photo-vault' |
        'newsletter' | 'contacts' | 'broadcast' | 'settings';
}
```

**Remove**: all inline `<style>` CSS for the old dark-green theme. The sidebar toggle JS moves inline to the layout.

---

## 2. `src/pages/admin/login.astro` — Restyle

### Current
Plain white form with dark-green button and logo image.

### New (matches UXPilot file 11)

Full-screen blush background (`bg-[#FDF0EC]`). Content centered in a card:

```
[compass icon in coral]
Admin Portal
"Welcome back, Zahra"

[email input]
[password input]
[remember me checkbox]
[Enter Dashboard — coral rounded-full button]

System status: "Secure Connection Verified" (small green dot + text)
Footer: help / support icon links
```

Key CSS changes:
- `body` background: `var(--color-blush)`
- Form card: `bg-white rounded-[2.5rem] shadow-sm border border-peach/20`
- Button: `bg-coral` → `bg-dark-coral` on hover, `rounded-full`, full width
- No structural or logic changes — same `action="/api/admin/login"` POST form

---

## 3. `src/pages/admin/index.astro` — New dashboard (replaces redirect)

### Current
Single line: `return Astro.redirect('/admin/trips');`

### New (matches UXPilot file 12)

Real dashboard page. Uses `AdminLayout` with `page="dashboard"`.

**Data to fetch at the top of the frontmatter:**
```ts
import { listTrips, listAlbums } from '../../lib/content';
import { db } from '../../lib/db';

const trips = listTrips().filter(t => t.status !== 'draft');
const regs = db.prepare(`
  SELECT * FROM registrations ORDER BY created_at DESC LIMIT 10
`).all();
const totalRevenue = db.prepare(`
  SELECT SUM(amount_paid) as total FROM registrations WHERE status = 'confirmed'
`).get();
// Column is `amount_paid` (INTEGER DEFAULT 0) — verified from db.ts schema.
const totalBookings = db.prepare(`SELECT COUNT(*) as count FROM registrations`).get();
const pendingCount = db.prepare(`
  SELECT COUNT(*) as count FROM registrations WHERE status = 'pending'
`).get();
```

**Page sections:**

**1. KPI cards (2-column grid):**
- Revenue: total confirmed payments in `₹X.XL` format
- Bookings: total count with % change placeholder

**2. Booking Growth chart:**
Bookings per day for the last 7 days. Use a simple inline `<canvas>` or a `<div>` with inline SVG bars — no external charting library. A 7-bar sparkline rendered server-side as SVG is enough. The UXPilot design uses Plotly but that's a 3MB CDN library for a simple bar chart — unnecessary. Use CSS-only bars:

```html
<div class="flex items-end gap-2 h-24">
  {weekData.map(d => (
    <div class="flex-1 rounded-t-lg bg-coral/80 transition-all"
         style={`height: ${(d.count / maxCount) * 100}%`}></div>
  ))}
</div>
```

**3. Quick Actions (horizontal scroll row):**
- New Trip → `/admin/trips/new/`
- Add Media → `/admin/photo-vault/new/`
- Broadcast → `/admin/broadcast/`

**4. Critical Alerts:**
Compute from data: trips with `bookedSpots >= totalSpots` (sold out), pending registrations older than 48h, registrations with status `pending` + trip departure within 7 days. Render as colored alert cards (red = overbooked, amber = pending action needed).

**5. Recent Activity (last 5 registrations):**
List with traveler name, trip name, amount, status badge.

---

## 4. `src/pages/admin/trips/index.astro` — Table → card list

### Current
Desktop-first HTML table with columns: Name / Status / Dates / Price / Bookings / Actions.

### New (matches UXPilot file 13)

**Keep all existing JS logic** (status update fetch, duplicate fetch, delete fetch). Only the HTML markup changes.

**Top additions:**
- Stats row: `Live` (coral bg) | `Upcoming` | `Drafts` (white cards with count)
- Search input: `rounded-2xl`, `border border-peach/20`, magnifying glass icon
- Filter chips: All Trips / Active / Drafts / Full — `rounded-full` pill buttons

**Trip cards (replace table rows):**

Each trip renders as a card (`rounded-[2rem]`, white bg, `border border-peach/20`):
- Top: cover image `h-32 object-cover` with status badge top-right (green=Active, amber=Full, gray=Draft)
- Body: trip name, date + booked/max counts, price
- Draft trips: dashed border, no image, "Continue Edit" + delete buttons
- Actions: edit icon button + ellipsis menu (duplicate / delete)

The `+` new trip button moves from a tab to a `rounded-xl bg-navy text-white` button in the top bar (right side), matching the UXPilot header pattern.

---

## 5. `src/pages/admin/trips/[slug].astro` — Restyle + album link field

### Visual changes
The 5-tab editor (Basics / Content / Itinerary / Logistics / Payment & Media) keeps its structure. Changes:
- Tab bar: `rounded-full` pill tabs instead of the current border-bottom style
- All input fields: `rounded-2xl border border-peach/20 focus:ring-coral/20`
- Section headings: `font-display font-semibold`
- Save buttons: `rounded-full bg-dark-coral text-white` (coral, not dark-green)
- The fixed bottom action bar (`Save Draft` / `Update Live Trip`) style updated

### Functional change (driven by v2-redesign.md §5b)

In the **Payment & Media tab**, add a new field: **"Link photo album"**.

This renders as a `<select>` dropdown populated with all published albums:

```astro
---
import { listAlbums } from '../../../lib/content';
const allAlbums = listAlbums();
---

<label class="block text-xs font-semibold uppercase tracking-widest mb-1.5"
       style="color: var(--color-navy);">
  Link Photo Album
</label>
<p class="text-xs text-gray-400 mb-2">
  Photos from this album will appear in the trip's inline photo strip.
</p>
<select name="linkedAlbumSlug"
        class="w-full rounded-2xl border border-peach/20 px-4 py-3 text-sm
               focus:ring-2 focus:ring-coral/20 focus:outline-none bg-white">
  <option value="">— None (uses fallback photos) —</option>
  {allAlbums.filter(a => a.published).map(a => (
    <option value={a.slug}
            selected={trip.linkedAlbumSlug === a.slug}>
      {a.name}
    </option>
  ))}
</select>
```

**How this works end-to-end:**
- Admin selects an album → saves `linkedAlbumSlug: spiti-valley-2023` to the trip YAML via `update.ts`
- The trip detail page (`src/pages/trips/[slug].astro`) reads `trip.linkedAlbumSlug` and uses it to look up the album — the correct lookup code is in v2-redesign.md §5b

This is cleaner than an album-side `tripSlug` approach because: a trip editor naturally owns "which album do I use" rather than an album owning "which trip am I for". It also supports albums shared across multiple trips.

**Update the API route** `src/pages/api/admin/trips/update.ts` — **confirmed required, not optional.** This route uses an explicit field allowlist (it builds a `data` object field-by-field and `writeTrip(newSlug, data)` writes only that object). Add the line:

```ts
linkedAlbumSlug: sanitizeInput(body.get('linkedAlbumSlug')) || null,
```

to the `data` object (alongside the other fields, ~line 68). Also add the same line to `src/pages/api/admin/trips/create.ts` so new trips can set it too.

⚠️ Because every save rewrites the entire trip YAML from this `data` object, omitting this line means a previously-set album link gets **wiped on the next trip edit** — not just dropped on this save. The dropdown in the editor form (which submits `name="linkedAlbumSlug"`) and this route line are a matched pair; both are required.

---

## 6. `src/pages/admin/registrations.astro` — Restyle + detail drawer

### Current
Stats row + search + filter + grouped table with expandable inline rows. All logic is client-side JS with inline `fetch` calls to `/api/admin/update-registration`.

### New (matches UXPilot files 15 + 16)

**Keep all logic.** Only markup changes.

**Stats row** (matches current but restyled):
- Total / Pending / Confirmed / Rejected / Revenue as pill cards, same data

**Filter chips** replace the current `<select>` filter:
`All | Confirmed | Pending | Waitlist` — `rounded-full` pill buttons, active = navy bg

**Booking list** replaces the grouped table:

Each registration as a card:
```html
<div class="bg-white rounded-[2rem] p-4 flex items-center justify-between
            border border-peach/20">
  <div class="flex items-center gap-3">
    <div class="w-10 h-10 rounded-xl bg-gray-soft grid place-items-center
                font-display font-bold text-navy">
      {reg.fullName[0]}
    </div>
    <div>
      <h4 class="text-sm font-semibold">{reg.fullName}</h4>
      <p class="text-[10px] text-navy/40">{reg.tripName}</p>
    </div>
  </div>
  <div class="text-right">
    <p class="text-sm font-semibold">₹{reg.amount_paid}</p>
    <span class="status-badge">{reg.status}</span>
  </div>
</div>
```

**Detail drawer** (slide-in from right):
Clicking a registration card opens a right-side drawer (same pattern as the sidebar, but from the right) showing the full booking detail from UXPilot file 16:
- Traveler profile: avatar initial, name, email, phone, status badge
- Trip summary: trip image thumbnail, name, dates, batch
- Payment info: advance paid, balance status
- Internal notes textarea (existing functionality, restyled)
- Action buttons: Confirm / Reject / Mark Resolved

This replaces the current inline expandable table rows. All the same data and API calls, just a different presentation.

---

## 7. `src/pages/admin/photo-vault/index.astro` — Grid → collections

### Current
`auto-fill` CSS grid of album cards with cover image, name, location, photo count, Published/Draft badge, Edit/Delete links.

### New (matches UXPilot file 17)

**Collections section** (top): Same album cards but with a more prominent layout.
Each collection card shows:
- Cover image in `aspect-[16/9]` with overlay showing photo count
- Name, location, date below
- Published/Draft badge
- Edit link + Delete button (same as current)

**Filter chips below** (for future use): All Media / High Res / Videos / Unused — static for now (no filter logic), just renders the chips visually.

**Storage usage bar** (cosmetic):
Static bar showing `X photos across Y albums`. No real storage tracking.

**+ New Album button** moves to the top-bar right slot (same pattern as trips page).

---

## 8. `src/pages/admin/photo-vault/new.astro` — Form → dropzone style

### Current
Standard `<form>` with labeled inputs in a 2-column grid.

### New (matches UXPilot file 18)

Same fields, same POST action, different visual treatment:

**Upload dropzone** (top of form):
```html
<div class="border-2 border-dashed border-peach/60 rounded-[2rem] p-12 text-center
            cursor-pointer hover:border-coral/40 transition-colors"
     id="cover-dropzone">
  <svg><!-- cloud upload icon --></svg>
  <p class="font-display text-lg mt-3">Drop cover image here</p>
  <p class="text-sm text-navy/40 mt-1">or <span class="text-coral">choose file</span></p>
  <input type="file" class="hidden" id="cover-input" />
</div>
```

**Asset Details** section below: Name input, slug (auto-generated, same JS as current), location, date, description.

**Tags field** (new cosmetic addition — no backend): chip input for visual tagging. Since there's no tags feature in the schema, render it as a visual UI element only — placeholder for future use, not wired up.

No changes to the POST logic.

---

## 9. `src/pages/admin/photo-vault/[slug].astro` — Add `tripSlug` field

**NOTE**: Based on the analysis in section 5 above, the approach changes. Instead of adding `tripSlug` to albums, we add `linkedAlbumSlug` to trips (done in the trip editor). The album editor (`[slug].astro`) doesn't need a new field.

However, the album editor should still be restyled to match the new design system — same treatment as other admin pages (coral/navy palette, rounded cards, etc.). The structure of the album editor (name, location, photos list, upload new photo) stays the same.

---

## 10. `src/pages/admin/contacts.astro` — Restyle only

No logic changes. Same `contact_submissions` SQLite query.

Visual changes:
- Filter chips: All / New / Resolved (currently these exist, just restyle to pill buttons)
- Table → card list (same pattern as registrations)
- Expandable detail: keep current expand-row behavior, restyle the expanded area

---

## 11. `src/pages/admin/newsletter.astro` — Restyle only

No logic changes. Same `newsletter_subscribers` query.

Currently a plain table. New: card list with email, status badge, subscribed date. Export CSV button restyled. No structural changes.

---

## 12. `src/pages/admin/settings.astro` — New page

### Data
No backend needed for most settings. Read from `readSiteSettings()`. Write via a new API route `POST /api/admin/settings/update` that calls `writeSettings()` (update `site-settings.yaml`).

### Sections (matches UXPilot file 20)

**Profile**
- Display name (Zahra), role (Super Admin)
- "Edit Public Profile" links to `/about/` (just navigation, no form)

**Branding**
- Primary color swatch — shows `#E8725A` (read-only for now, not editable in v1)
- Site title input → saves to `site-settings.yaml` field `siteTitle`
- Instagram URL input → saves to `instagram` field (currently read on homepage)
- WhatsApp number input → saves to `whatsappLink` field (currently read on homepage)

**Notifications**
- Booking notification toggle (cosmetic, no backend — future feature)
- New contact form notification toggle (cosmetic)

**Account**
- Email display (from session/cookie — read only)
- Change password link (links to login page — out of scope for v1)

**Danger Zone**
- Sign Out button → same logout form as current (`POST /api/admin/logout`)

**API route needed:** `src/pages/api/admin/settings/update.ts`
```ts
export const POST = async ({ request, cookies }) => {
  // auth check
  const data = await request.json();
  const settings = readSiteSettings();
  const updated = { ...settings, ...pick(data, ['siteTitle', 'instagram', 'whatsappLink']) };
  writeSettings(updated); // need to add writeSettings() to lib/content.ts
  return json({ success: true });
};
```

This requires adding `writeSettings()` to `src/lib/content.ts` — a 5-line function mirroring `writeTrip()`.

---

## 13. `src/pages/admin/broadcast.astro` — Keep, restyle only

The broadcast page (send newsletter to all subscribers) is a useful standalone page. Keep it as its own route. Restyle to match the new design system. Add a link to it from the Dashboard's Quick Actions.

---

## What does NOT change

- All API routes under `/api/admin/*` — zero changes to backend logic
- SQLite schema — no new tables or columns
- Auth cookie / session mechanism
- `src/lib/content.ts` — only `writeSettings()` function needs adding (5 lines)
- The trip YAML schema for all existing fields — `linkedAlbumSlug` is an optional new field, undefined by default

---

## Implementation order

Build in this sequence — each step leaves the admin functional:

1. **`AdminLayout.astro` + all 12 admin page prop updates** — **do this in one commit**. The `activeTab` → `page` rename is a breaking change across every admin page. Updating the layout without updating all callers simultaneously will leave every untouched page broken at compile time. All 12 pages to update: `index`, `login`, `trips/index`, `trips/[slug]`, `trips/new`, `registrations`, `photo-vault/index`, `photo-vault/new`, `photo-vault/[slug]`, `contacts`, `newsletter`, `broadcast`.
2. **`login.astro`** — isolated, no dependencies.
3. **`settings.astro` + `writeSettings()` + `api/admin/settings/update.ts`** — isolated new page.
4. **`admin/index.astro`** — dashboard. Needs the layout done first.
5. **`trips/index.astro`** — restyle only.
6. **`trips/[slug].astro`** — open `update.ts` first and verify `linkedAlbumSlug` will persist (see §5 note). Then add the dropdown and restyle tabs.
7. **Frontend photo strip** — only now write the `linkedAlbumSlug` lookup in `src/pages/trips/[slug].astro` (v2-redesign.md §5b). Until this step, the strip shows fallback photos — expected.
8. **`registrations.astro`** — restyle + detail drawer.
9. **`photo-vault/index.astro`** + **`photo-vault/new.astro`** + **`photo-vault/[slug].astro`** — restyle.
10. **`contacts.astro`** + **`newsletter.astro`** + **`broadcast.astro`** — restyle (lowest priority).

### Cross-plan sequencing note

The full merged sequence across both redesign plans:
1. Admin plan steps 1–3 (layout foundation + settings)
2. Admin plan step 4 (dashboard)
3. Frontend plan steps 1–3 (CSS tokens, TripCard, homepage)
4. Frontend plan step 4 (Header)
5. Admin plan steps 5–7 (trip editor + `linkedAlbumSlug` wiring + frontend photo strip)
6. Frontend plan step 5 continues (testimonials carousel, sidebar blush box)
7. Frontend plan steps 6–7 (about page, photo-vault public page)
8. Admin plan steps 8–10 (registrations, photo-vault admin, low-priority pages)

### About page content — explicit out-of-scope note

The UXPilot Content Editor screen (file 19) shows an "About Us" tab implying the admin can edit the about page copy. The frontend plan hardcodes Zahra's paragraphs directly in `about.astro`. **These are not connected** — the Content Editor in admin is a separate initiative and is out of scope for this redesign. Do not wire them up. If Zahra expects to edit about page copy from the admin, this needs to be called out before that page is built.
