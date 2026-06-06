# v2 Redesign Plan

Reference prototype: `lovable-code/` — used for UI/UX intent only, not for copying code.
Stack stays the same: Astro + Tailwind + React islands. No new packages.

---

## Scope summary

7 files change + minor YAML updates. No routing changes. No backend changes.

| File | Change type | Size |
|---|---|---|
| `src/pages/about.astro` | Full rewrite | Large |
| `src/components/TripCard.astro` | Redesign | Medium |
| `src/pages/index.astro` | Section-by-section edits | Medium |
| `src/pages/trips/[slug].astro` | Add 2 new sections + heading copy | Medium |
| `src/components/Header.astro` | Desktop nav removal + bg color | Small |
| `src/pages/photo-vault/index.astro` | Simplify layout | Small |
| `src/styles/global.css` | Add keyframe + utility | Small |
| Trip YAML files (via admin) | `linkedAlbumSlug` field set through admin UI | Trivial |

`src/pages/trips/index.astro` — no direct changes needed. The TripCard redesign (section 4) automatically propagates to the trips listing page since it uses the same component.

---

## 1. `src/styles/global.css` — Add entrance animation

All hero entrance animations (logo, badge, headline, CTA) use CSS keyframes with staggered `animation-delay`. No JS, no library.

**`@keyframes` must be defined at root level — NOT inside `@layer`. Add before the `@layer base` block:**

```css
@keyframes stt-fade-up {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: none; }
}
```

**Then add the utility class inside `@layer utilities`:**

```css
/* Default: fully visible — safe for no-JS, unsupported browsers,
   and users who prefer reduced motion. Animation only applies
   when the user has not expressed a preference for reduced motion. */
.anim-fade-up {
  opacity: 1;
}

@media (prefers-reduced-motion: no-preference) {
  .anim-fade-up {
    opacity: 0;
    animation: stt-fade-up 0.7s ease forwards;
  }
}
```

Apply to hero elements inline with `style="animation-delay: Xs"`:
- Logo block: `0s`
- Badge pill: `0.1s`
- H1 headline: `0.15s`
- Subtext: `0.25s`
- Stats card: `0.35s`
- CTA button: `0.45s`
- Social proof row: `0.55s`

The existing `.reveal` class already handles scroll-triggered animations. No changes needed there.

---

## 2. `src/components/Header.astro` — Desktop nav removal + navy bg

**What changes:**

### Remove the desktop inline nav links
The prototype shows hamburger-only on all screen sizes. No inline `Trips / Our Story / FAQ` links on desktop.

In the current file, remove the entire `<nav class="hidden lg:flex ...">` block (the desktop nav with inline links + "Join a trip" pill). Keep the logo and the hamburger button. The right-side drawer already exists and has all links — that's the only nav.

### Change header background to navy
Currently: `background: rgba(255,255,255,0.92); backdrop-filter: blur(12px); border-bottom: ...`
Change to: `background: rgba(27,43,58,0.92); backdrop-filter: blur(12px);` (no border-bottom)

Logo text and hamburger icon color: change from navy to white.

The mobile drawer itself stays white — no change there.

**Net result:** ~15 lines removed, 3 color values changed.

---

## 3. `src/pages/index.astro` — Section-by-section edits

### 3a. Remove the Trust Bar section
Delete the entire `<!-- ── TRUST BAR ───... -->` section (the strip with "Small groups · Curated offbeat routes · For travellers"). It's between the hero and the upcoming trips section.

### 3b. Hero — add entrance animations
Add `class="anim-fade-up"` and `style="animation-delay: Xs"` to each hero element (logo img, badge pill, h1, subtext p, stats card div, CTA a, social proof div). Use the stagger values from section 1 above.

No structural changes to the hero markup.

### 3c. Upcoming Trips — heading copy + layout

Change the section heading:
```
<!-- before -->
<h2>Where we're going next</h2>

<!-- after -->
<h2>
  Where to, <span style="font-style: italic; color: var(--color-coral);">wanderer?</span>
</h2>
```

Change the font-size on this heading to `clamp(1.9rem, 8vw, 4rem)` so it runs large on desktop.

The sub-heading "Featured Trips" label sits below this, left-aligned, alongside a "See All →" link on the right. This already exists structurally; just update the heading above it.

### 3d. How It Works — layout change

Currently: centered text with large step numbers.
Prototype: left-aligned, each step has a `border-top` rule above it, the step number is in a faint large display font.

Change the step cards from `text-center` to left-aligned. Add `border-t border-white/15` above each step — the section background is navy, so `var(--color-peach)` (light pink) would be near-invisible there; use `rgba(255,255,255,0.15)` instead. Large step number (`6xl`, `font-bold`, `opacity-20`) sits above the title, not centered.

### 3e. Testimonials — grid → horizontal snap-scroll carousel

Currently: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5`

Change to a horizontally scrolling snap container:
```html
<div class="flex gap-5 overflow-x-auto snap-x snap-mandatory pb-2
            [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4">
  <!-- each card -->
  <figure class="flex-shrink-0 basis-[84%] snap-start sm:basis-[55%] lg:basis-[28%] ...">
```

The card markup itself stays the same — just the outer wrapper changes from grid to flex+overflow. Each card uses `basis-[84%]` on mobile (one card dominates the viewport), `55%` on sm, `28%` on lg.

### 3f. Newsletter — add dark background image

Currently: plain blush background.
Change to: background image (use the existing Unsplash community/mountains photo already used in the hero, or `/api/uploads/...`), with a dark navy overlay:

```html
<section
  style="
    background-image: url('https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1920&q=80');
    background-size: cover;
    background-position: center;
    position: relative;
  "
>
  <div class="absolute inset-0" style="background: rgba(27,43,58,0.78);"></div>
  <div class="relative ...">
    <!-- existing form content, but text becomes white -->
  </div>
</section>
```

Text inside: heading and body text become `text-white`. Input border becomes `border-white/25`, input text becomes white with `placeholder:text-white/50`.

---

## 4. `src/components/TripCard.astro` — Redesign

This is a full rewrite of the card markup. The data props stay identical — nothing in `index.astro` or `trips/index.astro` needs to change.

### Key visual changes

**Image area:**
- Aspect ratio: `aspect-ratio: 16/9` → `aspect-ratio: 4/3`
- Border radius: `rounded-2xl` → `rounded-3xl`
- Overlay pill: remove the status badge (`UPCOMING` / `FILLING FAST` / `SOLD OUT`). Replace with a **duration pill** top-left: e.g. "7 Days". This is a simple `{duration}` render.
- The `+N more dates` badge top-right stays.

**Card body:**
- Remove the `{desc}` description paragraph entirely. Cleaner card, more visual.
- Remove the meta row (location + duration icons in a flex row).
- New top section: title (left, `text-2xl font-display`) + price (right, `text-2xl font-display text-coral`). Location sits below the title as a small line with a MapPin icon.
- Spots progress bar stays — it's useful information. Keep it.
- Bottom CTA button: becomes full-width rounded-full pill (`w-full`, `rounded-full`, `py-4`) with "View Details" text for open trips, "Sold out" for sold-out (disabled gray, no hover).
- Sold-out cards: remove `opacity-60 grayscale`. Instead just show the disabled gray button — the prototype doesn't dim the whole card.
- Remove the `aspect-ratio: 16/9` constraint reference; the new `4/3` ratio makes the image taller.

**Shadow:**
- Resting: `box-shadow: 0 4px 30px -12px rgba(27,43,58,0.18)`
- Hover: `box-shadow: 0 18px 50px -18px rgba(27,43,58,0.3)`, `-translate-y-0.5`

---

## 5. `src/pages/trips/[slug].astro` — 2 new sections + copy changes

The registration form, sidebar, mobile sticky bar, batch picker, and payment UI are all **already built** and match the prototype. No changes needed there.

### 5a. Section heading copy changes

Four headings change in the left column:

| Current | New |
|---|---|
| `Description` (or the trip's `shortDescription` used as-is) | "What this trip feels like" |
| `Highlights` | "Things you'll probably talk about later" |
| `Itinerary` | "The plan" |
| `What's included / What's not included` | "What's included" (keep the two-column included/excluded layout) |

These are `<h2>` text changes only. The layout and data rendering beneath each doesn't change.

### 5b. Add: Photos horizontal scroll strip

New section, inserted **between the Highlights block and the Itinerary block** (order: Description → Highlights → **Photos** → **Testimonials** → Itinerary → Included/Excluded → Meeting Point → Registration).

```html
<!-- Photos strip -->
<div>
  <h2 class="font-display text-3xl lg:text-4xl mb-2">Photos</h2>
  <p class="text-sm mb-4" style="color: var(--color-gray-text);">From the trail. No filters, no staging.</p>
  <div class="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2
              [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {tripPhotos.map((src) => (
      <img
        src={src}
        loading="lazy"
        class="h-64 w-[78%] flex-none snap-start rounded-2xl object-cover
               sm:h-72 sm:w-[55%] md:w-[40%]"
      />
    ))}
  </div>
</div>
```

**Data source — `linkedAlbumSlug` on the trip YAML (set via admin):**

The link lives on the **trip** side, not the album side. The admin trip editor (v2-admin-redesign.md §5) adds a `linkedAlbumSlug` dropdown. Once set, the trip YAML will contain:

```yaml
# src/content/trips/spiti-valley-adventure.yaml
linkedAlbumSlug: spiti-valley-2023   # ← set via admin dropdown
```

In the `[slug].astro` frontmatter:

```ts
import { listAlbums } from '../../lib/content';

const FALLBACK_PHOTOS = [
  'https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=900&q=80',
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=900&q=80',
  'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=900&q=80',
  'https://images.unsplash.com/photo-1454496522488-7a8e488e8606?w=900&q=80',
];

// trip.linkedAlbumSlug is set by the admin trip editor
const linkedAlbum = trip.linkedAlbumSlug
  ? listAlbums().find(a => a.slug === trip.linkedAlbumSlug && a.published)
  : null;
const tripPhotos: string[] = linkedAlbum?.photos?.length
  ? linkedAlbum.photos.slice(0, 5).map((p: any) => p.image).filter(Boolean)
  : FALLBACK_PHOTOS.slice(0, 5);
```

> **Sequencing dependency:** this code reads `trip.linkedAlbumSlug`, which will be `undefined` until the admin trip editor (v2-admin-redesign.md §5–7) is built and a trip is saved with a linked album. The photo strip will display fallback Unsplash images in the interim — this is expected and acceptable.

Do **not** add a `tripSlug` field to album YAMLs. The relationship is owned by the trip.

### 5c. Add: Per-trip testimonials carousel

New section, inserted **after the Photos strip**:

```html
<div>
  <h2 class="font-display text-3xl lg:text-4xl mb-2">What they said</h2>
  <p class="text-sm mb-4" style="color: var(--color-gray-text);">Real words. Zero editing.</p>
  <div class="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2
              [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
    {tripTestimonials.map((t) => (
      <figure class="relative flex-none basis-[85%] snap-start rounded-2xl p-5
                     sm:basis-[60%] md:basis-[45%]"
               style="background-color: var(--color-blush);">
        <span class="absolute right-4 top-3 font-display text-3xl opacity-20"
              style="color: var(--color-navy);">"</span>
        <blockquote class="text-sm leading-relaxed"
                    style="color: var(--color-navy);">{t.quote}</blockquote>
        <figcaption class="mt-5 flex items-center gap-3">
          <div class="w-10 h-10 rounded-full grid place-items-center font-display font-bold text-white"
               style="background-color: var(--color-coral);">{t.name[0]}</div>
          <div>
            <p class="text-sm font-medium" style="color: var(--color-navy);">{t.name}</p>
            <p class="text-xs" style="color: var(--color-gray-text);">{t.tripName ?? ''}</p>
          </div>
        </figcaption>
      </figure>
    ))}
  </div>
</div>
```

**Data source:** Testimonial YAMLs use a `tripName` field (e.g. `tripName: Spiti Valley Adventure`) which matches the trip's `title` field. Filter on that. Declare a single variable and use it in the template — don't declare two.

```ts
const allTestimonials = listTestimonials();
// tripName is already computed at the top of the page as trip.title || trip.name || slug
const tripTestimonials = (() => {
  const matched = allTestimonials.filter(t => t.tripName === tripName).slice(0, 4);
  return matched.length > 0 ? matched : allTestimonials.slice(0, 3);
})();
```

Use `{tripTestimonials.map(...)}` in the JSX below — not a separate `displayTestimonials` variable.

### 5d. Sidebar: "Advance to confirm spot" blush box

The current sidebar shows the full trip price and a CTA button. Add a blush box between the price and the CTA that surfaces the advance amount explicitly:

```html
<div class="rounded-xl p-4" style="background-color: var(--color-blush);">
  <p class="text-xs uppercase tracking-widest mb-1"
     style="color: var(--color-navy); opacity: 0.6;">Advance to confirm spot</p>
  <p class="font-display text-2xl" style="color: var(--color-coral);">
    ₹{paymentAmount.toLocaleString('en-IN')}
  </p>
  <p class="text-xs mt-1" style="color: var(--color-gray-text);">
    Pay now · Balance due before trip
  </p>
</div>
```

`paymentAmount` is already extracted from the trip YAML at the top of the page.

---

## 6. `src/pages/about.astro` — Full rewrite

The current about page is a generic multi-section travel company page (hero image, Our Story two-column, Mission & Values grid, stats counter, team photos, CTA). The prototype replaces all of this with a tight, personal editorial page.

### New structure (top to bottom)

**Before the sections below, pass `hideHeader={true}` to `BaseLayout`** — exactly as the homepage does. The about page uses its own minimal back-nav; the site-wide sticky header must not appear above it. The site footer remains (no `hideFooter` needed).

This is a deliberate UX choice: the about page is an editorial, focused read. There is intentionally no site-wide navigation — just a back arrow. Users on mobile hit back; on desktop the footer handles navigation. This is correct per the prototype.

**1. Top navigation bar** (no full header — just a back arrow + byline):
```html
<!-- Pass hideHeader={true} to BaseLayout -->
<BaseLayout title="Our story — Seek the Thrill" description="..." hideHeader={true}>

<header class="flex items-center justify-between max-w-2xl mx-auto px-5 pt-5">
  <a href="/" aria-label="Back"
     class="grid h-9 w-9 place-items-center rounded-full hover:bg-black/5 transition-colors"
     style="color: var(--color-navy);">
    <!-- inline arrow-left SVG -->
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
  </a>
  <span class="text-[11px] uppercase tracking-[0.25em]" style="color: rgba(27,43,58,0.55);">
    by <span class="font-display italic normal-case tracking-normal" style="color: var(--color-coral);">Zahra</span>
  </span>
  <div class="w-9"></div> <!-- right spacer to visually center the byline -->
</header>
```

**2. Full-width portrait photo of Zahra** with a floating card overlay:
```html
<section class="max-w-2xl mx-auto mt-6 px-5">
  <div class="relative">
    <img src="[zahra photo]" alt="Zahra" class="w-full rounded-sm object-cover aspect-[4/5]" />
    <!-- Floating card, absolutely positioned at bottom center -->
    <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 w-[88%] bg-white
                rounded-md px-5 py-4 text-center shadow-[0_10px_30px_-12px_rgba(15,23,42,0.25)]">
      <p class="font-display text-xl" style="color: var(--color-navy);">
        The Tour Industry is Broken.
      </p>
    </div>
  </div>
</section>
```

Photo: use a real photo of Zahra. If not available yet, use the existing `founderImg` URL as placeholder.

**3. Pull quote** (with top padding to clear the floating card's `-bottom-6` offset):
```html
<section class="max-w-2xl mx-auto px-8 pt-16 pb-6">
  <blockquote class="font-display text-[1.35rem] italic leading-snug" style="color: var(--color-navy);">
    "I spent years watching people travel thousands of miles just to see the same
    gift shops and eat at the same 'tourist-friendly' buffets."
  </blockquote>
</section>
```

**4. Body paragraphs** (Zahra's voice, first-person):
```html
<section class="max-w-2xl mx-auto px-8 pb-12 space-y-5 text-[15px] leading-relaxed"
         style="color: rgba(27,43,58,0.85);">
  <p>
    I started <span class="font-medium" style="color: var(--color-coral);">Seek the Thrill</span>
    because I was tired of the fluff. I wanted the dust of the mountain roads, the taste of a
    home-cooked meal in a village that isn't on Google Maps, and the silence of a valley at dawn.
  </p>
  <p>
    Travel should change you. It shouldn't just be a checklist of monuments. It should be about
    the people you meet and the stories that don't make it to the brochure.
  </p>
</section>
```

**5. Dark navy "How we do it differently" block:**
```html
<section style="background-color: var(--color-navy);" class="text-white">
  <div class="max-w-2xl mx-auto px-8 py-14">
    <h2 class="text-center font-display text-3xl leading-tight text-white">
      How we do it<br />differently
    </h2>
    <div class="mt-10 space-y-9 text-center">
      <!-- 3 principles, each: number (coral italic), title, description -->
      <!-- 01. Real People | 02. Hidden Spots | 03. Zero Fluff -->
    </div>
  </div>
</section>
```

**6. Signature section:**
```html
<section class="max-w-2xl mx-auto px-8 py-14 text-center">
  <p class="text-[15px] leading-relaxed" style="color: rgba(27,43,58,0.8);">
    If you're looking for a holiday, there are plenty of apps for that. If you're looking for
    a journey that sticks to your soul, come with us.
  </p>
  <p class="mt-10 text-[10px] uppercase tracking-[0.3em]" style="color: rgba(27,43,58,0.55);">
    With love &amp; grit,
  </p>
  <p class="mt-3 font-display text-5xl italic" style="color: var(--color-coral);">
    Zahra
  </p>
</section>
```

**7. CTA button:**
```html
<section class="max-w-2xl mx-auto px-5 pb-12">
  <a href="/trips/"
     class="flex w-full items-center justify-center gap-2 rounded-full px-6 py-4
            text-base font-medium text-white"
     style="background-color: var(--color-coral);
            box-shadow: 0 10px 30px -12px rgba(231,111,81,0.6);">
    Explore Zahra's Trips →
  </a>
</section>
```

**Remove:** `StatsCounter` import, all stats data, `values` array, `features` array, team member grid, the dark green stats section, the `founderImg` placeholder Unsplash URL. Close the `</BaseLayout>` tag after the CTA section.

**Keep:** `BaseLayout` wrapper with `hideHeader={true}`. Update SEO title to `"Our story — Seek the Thrill"` and description to `"I'm Zahra. I built Seek the Thrill because travel should change you."`

---

## 7. `src/pages/photo-vault/index.astro` — Simplify

### Remove the filter/search bar
Delete the entire `<!-- Filter Bar -->` section (search input + sort dropdown). The prototype has no filtering.

### Update the hero
Change from the current darkened full-width hero image to a simple text header:

```html
<section class="max-w-2xl mx-auto px-5 pt-10 pb-6">
  <h1 class="font-display text-[2.75rem] leading-[1.05]" style="color: var(--color-navy);">
    The Vault
  </h1>
  <p class="mt-2 font-display text-base italic" style="color: rgba(27,43,58,0.55);">
    Every memory, raw and unedited.
  </p>
</section>
```

### Change album card aspect ratio
Current album cards: likely `aspect-[16/9]` or `aspect-[4/3]`.
Change to `aspect-[5/6]` (taller, portrait-oriented). This makes the cards feel more like a physical photo album.

Update the grid to single-column centered (`max-w-2xl mx-auto`) vs the current wider grid.

---

## Implementation order

Build in this sequence to keep the site functional at every step:

1. `global.css` — add `@keyframes fade-up` and `.anim-fade-up` (no visual change until used)
2. `TripCard.astro` — self-contained, affects homepage + trips listing simultaneously
3. `index.astro` — section by section: remove trust bar → hero animations → heading copy → how-it-works layout → testimonials carousel → newsletter bg
4. `Header.astro` — remove desktop nav links, change bg to navy
5. `trips/[slug].astro` — heading copy → photos strip → testimonials → sidebar blush box
6. `about.astro` — full rewrite (isolated page)
7. `photo-vault/index.astro` — simplify (isolated page)

---

## What does NOT change (frontend plan scope)

- All Astro API routes (`/api/register`, `/api/newsletter`, `/api/contact`, etc.)
- Album YAML schema — no new fields on album files (the link is stored on the trip side)
- `Footer.astro` — already matches the prototype (4-column layout, newsletter inside footer, social links, same bottom row)
- `BatchPicker.tsx`, `DayAccordion.tsx`, `ItineraryAccordion.tsx` — React islands stay as-is
- Routing, SEO, sitemap
- Color tokens in `global.css` — already identical to the prototype's palette

> **Note:** Admin pages are redesigned separately in `v2-admin-redesign.md`. Trip YAML schema gains `linkedAlbumSlug` set via the admin trip editor — that is covered by the admin plan, not this one.

## What changes minimally outside the 7 main files

- **`src/content/trips/*.yaml`** — `linkedAlbumSlug` is added to each trip via the admin UI, not by hand-editing YAMLs. No manual file edits needed as part of this frontend plan.
