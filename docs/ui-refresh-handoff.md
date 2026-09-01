# UI Refresh — Session Handoff

**Read this first in any new session working on the UI refresh.**
Full plan: `~/.claude/plans/cd-projects-stt-iridescent-thompson.md`.

## Where things stand

- **Branch:** `ui-refresh` (off `main`). `main` untouched. Do **not** work on `main`.
- **Working tree:** clean except two pre-existing untracked items unrelated to this
  work — `design.md.save`, `public/mockups/`. Leave them alone.
- **Suite state at handoff:** `build` clean · `test:unit` 300/300 · `test:api` 153/153 ·
  `test:e2e` 150/150 (118 functional + 32 visual). Everything green.
- **Phase 0 = done. Phase 1 = done. Currently parked at the Phase 1 review gate**
  (blocking) — awaiting the user's sign-off on visual direction before any further
  page migration. Do not start Phase 2/3 until the user answers the 3 gate questions
  (below).

## Commits on the branch (newest first)

| SHA | Summary |
|---|---|
| `e5208a2` | Phase 1 gate draft — homepage restyled onto primitives + tokens |
| `61b6a92` | Phase 1 — design tokens in global.css + 13 primitives + `/ui-kit` gallery |
| `6936cc7` | Phase 0 — visual-regression harness (`tests/e2e/visual.spec.ts`) + 32 baselines |
| `d05e5d0` | Phase 0 — slop metrics tooling + baselines (`scripts/slop-metrics.sh`, `docs/*-baseline.txt`) |
| `0e93d8b` | Repair 13 stale e2e specs so the suite was green before touching UI |

## The 3 open gate questions (user must answer before proceeding)

1. **Visual direction.** The homepage restyle is "keep the look, kill the slop" — near
   pixel-equivalent, just primitives + tokens instead of inline styles. If the user
   wants a real visual *refresh* (type proportions, button shape, spacing, colour
   shifts), tune the tokens/primitives **once** now, before pages consume them.
2. **Icons.** Currently a local zero-dependency `src/components/ui/Icon.astro` (12
   glyphs, name→paths map). Alternative from the plan: add `astro-icon` +
   `@iconify-json/lucide` (build-time, still zero runtime, but a dependency).
3. **Lighthouse baseline.** `npm run perf:lhci` was NOT captured in Phase 0 (deferred).
   Run it before Phase 2 or take first reading at end of Phase 2.

## What Phase 1 added (safe to build on)

**`src/styles/global.css`** — `@theme` extended, every existing token kept:
- `--text-display-{xs,sm,md,lg,xl}` (+ `--line-height`) → `text-display-*` utilities,
  Fraunces display scale. Replaces `text-[2.1rem] sm:text-[2.6rem] …` / `clamp()` one-offs.
- `--radius-card` (1.5rem = old `rounded-3xl`), `--radius-pill`
- `--shadow-media` (the old inline `0 4px 30px -12px rgba(27,43,58,.18)` on TripCard)
- `.u-overlay-scrim` + `.u-overlay-scrim-flat` utilities (in `@layer utilities`) —
  replace repeated inline hero/newsletter gradient overlays

**`src/components/ui/`** — plain-element Astro primitives. Conventions: typed `Props`,
accept `class?: string` + `...rest`, render `class:list={[base, className]}` on a real
semantic element, spread `...rest` so `id`/`name`/`data-*`/`aria-*` pass through. No
wrapper elements. No inline `style` inside a primitive.
- `Button.astro` — `href` → `<a>`, else `<button>`; `variant` primary|cta|outline|ghost;
  `size` sm|md|lg; `block`
- `Badge.astro` — ports old `src/components/Badge.astro` status/label maps verbatim
  (same `variant`+`value` API). Old file still exists; delete it during Phase 3.
- `Card.astro` + `CardMedia.astro` (`overlay` slot) + `CardBody.astro`
- `Field.astro` / `Input.astro` / `Select.astro` / `Textarea.astro` — Textarea prefills
  via `value` prop, NOT children (`<textarea>` content is raw text in HTML)
- `Section.astro` — `container-app` gutter + vertical rhythm + optional `title`/`intro`
  centered heading block; `tone` default|soft|blush|navy; `space` sm|md|lg
- `Stat.astro`, `Prose.astro` (wraps `.rich-text`), `Icon.astro`

**`src/pages/ui-kit.astro`** — primitive gallery at `/ui-kit` (dev only; 404s in prod).
Temporary — delete before merge.

**`src/pages/index.astro`** — restyled (the gate draft). Inline styles 28→1,
`var(--color-*)` in markup →0. Preserved verbatim: `#homepage-hero`,
`#featured-carousel`, `#featured-prev`/`#featured-next`, `#home-newsletter`,
`#home-newsletter-email`, `#home-nl-success`, `.reveal`, `.anim-fade-up` /
`.anim-delay-*`, all three `<script>` blocks, `TripCard`/`TestimonialCard` props.

## Slop metrics (run `bash scripts/slop-metrics.sh` any time)

| | public | admin |
|---|---|---|
| inline `style="` — Phase 0 baseline | 303 | 518 |
| inline `style="` — now (after homepage) | **276** | 518 |
| `var(--color` in markup — now | 402 | 651 |

Baselines archived in `docs/slop-baseline.txt`, `docs/bundle-baseline.txt`,
`docs/testid-inventory.txt`.

## Gotchas discovered this session (do not re-learn the hard way)

1. **Early `return` in `.astro` frontmatter breaks this repo's compiler**
   (`Unterminated string literal` / `Expected ")"` from esbuild). `return
   Astro.redirect(...)` and `return new Response(...)` both fail. Guard pages with
   `Astro.response.status = 404` (a statement, no return) + conditional render.
   `ui-kit.astro` uses this pattern.
2. **Astro does not route `_`-prefixed files.** The gallery is `ui-kit.astro`, not
   `_ui.astro`.
3. **`<textarea><slot/></textarea>` renders `<slot />` literally** — textarea content
   is raw text. Primitive takes a `value` prop instead.
4. **e2e flake root cause: island hydration race.** `page.goto()` then immediate
   `click()` on an Astro island silently no-ops before React attaches handlers. Use
   `tests/e2e/helpers.ts` — `gotoHydrated` / `waitForHydration` / `clickHydrated`,
   which wait on `<astro-island>` dropping its `ssr` attribute. No fixed sleeps, no
   retry-clicking (double-submit risk on payment forms).
5. **13 e2e specs were already stale on `main`** before this work — repaired in
   `0e93d8b`. Causes: hydration race; State field became a searchable dropdown
   (`0a61a01`) but tests still `fill()`d it as text; two rich-text editors on the
   admin trip page → strict-mode locator violation; `#booking-panel-cta` reused for
   booking link + wishlist submit; Step-3 checkout rework (`469b10c`) removed
   "Register without paying" + the summary "Change" button → WF-3/registration specs
   rewritten to the current "I'll pay later" → lead-hold flow, "Change" nav test
   dropped (no surviving affordance).
6. **Dev server pileups.** Playwright's `reuseExistingServer: true` can grab a stale
   `astro dev` on :4321. If a run hangs on "Timed out waiting for webServer":
   `pkill -f 'astro dev'; lsof -ti:4321 | xargs kill -9`.
7. **Homepage 320px overflow** — a fixed `text-display-*` with `whitespace-nowrap` on
   "Where to, wanderer?" overflowed narrow viewports (original used fluid `clamp`).
   Fixed with `text-display-md sm:whitespace-nowrap sm:text-display-lg …`. Watch for
   this pattern when converting other fluid headings.

## Verification commands

```
npm run build                       # must stay clean; watch better-sqlite3 externalization
npm run test:unit                   # 300/300
npm run test:api                    # 153/153 — proves backend untouched
npm run test:e2e                    # 150/150 (functional + visual)
npx playwright test tests/e2e/visual.spec.ts                    # 32 snapshots
npx playwright test tests/e2e/visual.spec.ts --update-snapshots # after an INTENDED visual change (Phase 3)
bash scripts/slop-metrics.sh        # track the cleanup
npm run perf:lhci                   # Lighthouse (not yet baselined)
```

Visual snapshots are `*-chromium-darwin.png` — platform-specific. Regenerate on a
different OS/CI or they will all "fail". The harness stubs `images.unsplash.com` with
`public/logo.jpg` and freezes animations/fonts for determinism.

## Next phases (from the plan — do not start before the gate clears)

- **Phase 2** — shared chrome: `BaseLayout`, `Header` (has a ~90-rule
  `<style is:global>` — trim only 1:1 utility mappings), `Footer`,
  `LegalPageLayout`, `ProfileChrome`, `BackButton`, `PageLoader`. Zero testids here.
  Re-baseline snapshots once (chrome touches every page). DOM-stable.
- **Phase 3** — marketing/legal pages (index already done). Intended visual change;
  review diffs then `--update-snapshots`. Delete old `src/components/Badge.astro`.
- **Phase 4** — booking flow: `trips/index`, `trips/[slug]` (67 inline styles,
  densest file), `trips/[slug]/book`, `TripCard`, `TestimonialCard`. **All 24
  testids live here or in do-not-touch islands.** Hard gate: e2e unchanged + these
  routes' snapshots byte-identical.
- **Phase 5** — `profile`, `u/[username]` (already zero inline styles),
  `photo-vault/*` (GLightbox — verify selectors), `ProfileTripCard`.
- **Phase 6 (optional)** — admin. Needs a Playwright auth `storageState` fixture
  first (doesn't exist). Prune legacy `--color-primary*` / `--color-accent*` /
  `--color-gold` aliases from `global.css` only after `grep` shows zero refs.

## Hard constraints (unchanged from plan)

Do NOT touch: `src/pages/api/**`, `src/lib/**`, `src/middleware.ts`,
`keystatic.config.tsx`, `scripts/**` (except `slop-metrics.sh`), the SQLite DB,
`astro.config.mjs` server config, React island internals/props (`BookingPanel`,
`BookingCheckout`, `DayAccordion`, `ItineraryAccordion`, `TestimonialCarousel`,
`StatsCounter`, `DiscountCountdown`), any `fetch()` URL/payload, any form
`id`/`name`/`action`, any `data-testid`, any DOM id/class an inline `<script>` queries
or toggles.
