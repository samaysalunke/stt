# Per-departure itinerary variants

## Context

Today a trip is one YAML file in `src/content/trips/*.yaml` holding exactly one
itinerary, one set of inclusions, one duration — and a `batches[]` array of
departures that may vary only in date, price, capacity, discount and status.

That breaks down for a trip like **Monsoon Meghalaya**, which today has four
departures (`meghalaya-jun-2026`, `-aug-2026`, `-sep1-2026`, `-sep2-2026`) all
sharing one 7-day itinerary. In reality those departures differ slightly — a
different route, a different homestay, a shifted inclusion list. Winter
Meghalaya is a genuinely different product and stays a separate trip; three
monsoon departures are *not*, and splitting them would put three near-identical
"Monsoon Meghalaya" cards in front of travellers. That is the confusion we are
explicitly avoiding.

**Outcome:** one trip, one slug, one public page. The existing departure
selector becomes the single control — picking a date updates the price (as it
does now) *and* the itinerary, inclusions and trip summary.

### Decisions taken

| Question | Decision |
|---|---|
| Model | **Named variants.** The trip holds a list of named variants; each departure points at one. Departures sharing a variant stay in sync — fix a typo once. |
| Fallback | A departure with **no `variantId` inherits the trip-level base**, so all 17 existing trips work with zero migration. |
| What can vary | Itinerary days · included/excluded · occupancy tier **labels** · duration / meeting point / highlights |
| Public UX | **One date selector drives everything.** No second date picker. |

### Why this shape

`src/lib/trips.ts` already has exactly one read-side normalization boundary,
`resolveBooking()` (`trips.ts:455`), and it *already* implements "batch
overrides trip default" for pricing — `resolveOffers()` (`trips.ts:376`) falls
back `batch.offers[]` → `trip.sharingOptions[]` → `trip.pricePerPerson`.
`parseEditorBooking()` (`tripEditor.ts:161`) is the matching write boundary.
This extends a pattern already in place.

Bookings need **no schema change**: `registrations` already pins
`trip_slug` + `batch_id` + `tier_id` (`db.ts:102,109,153`). A traveller's
variant is fully determined by their `batch_id`, so **do not denormalize it onto
the registration row** — a copy would go stale the moment a departure is
reassigned.

---

## Data model

Sparse overrides. **A key absent from a variant inherits the trip-level base.**

```yaml
# src/content/trips/monsoon-meghalaya.yaml
itinerary: [...]        # ← base / default, unchanged
included: [...]
notIncluded: [...]
duration: 7 Days, 6 Nights
meetingPoint: Guwahati airport
highlights: [...]
occupancyCatalog:       # ← stays TRIP-LEVEL, owns the tier id space
  - { id: triple, label: Triple Sharing }
  - { id: double, label: Double Sharing }

itineraryVariants:                    # ← NEW, optional, usually absent
  - id: living-root-route             # frozen at creation; rename ≠ re-key
    label: Living Root Route
    itinerary: [...]                  # omit ⇒ inherit base
    included: [...]                   # omit ⇒ inherit base
    occupancyOverrides:               # display-only relabel
      - { tierId: double, label: Double Sharing — Riverside Homestay }

batches:
  - id: meghalaya-jun-2026            # no variantId ⇒ base
  - id: meghalaya-aug-2026
    variantId: living-root-route      # ← NEW
  - id: meghalaya-sep1-2026
    variantId: living-root-route      # ← shares the same variant
```

**Sparseness is decided by key *presence*, not truthiness** —
`Object.prototype.hasOwnProperty.call(v, 'included')`, so `included: []`
legitimately means "nothing included on this variant". For strings
(`duration`, `meetingPoint`) override only when the trimmed value is non-empty,
because the existing editor writes `null` for blank fields and an accidental
`duration: null` must not blank the at-a-glance strip.

**`occupancyCatalog` stays trip-level.** `registrations.tier_id` and
`adjustBookingCount()` (`registrationWrite.ts:42`) depend on tier ids being
stable and trip-global. A variant may override only `label` / `helperText`,
never introduce an id. This is already sufficient for "different
accommodations", because a departure can *already* offer a subset of the
catalog — `sahyadri-monsoon-retreat` does exactly this today
(`sahyadri-jul2-2026` offers `dorm` only; `jul1`/`jul3` offer `dorm` + `double`).
Per-day accommodation lives in the itinerary's `stay` field.

---

## Constraints discovered in the code — these drive the design

1. **`sanitizeInput()` truncates at 5000 chars** (`utils.ts:27-30`), and
   `update.ts:26-27` / `create.ts:23-24` pass `occupancyCatalog_json` and
   `departures_json` through it. Today's largest `departures_json` is ~1.1 KB,
   so this is not yet a live bug — but a single variant carrying a full
   itinerary is ~2.1 KB, so two or three variants blow the cap immediately and
   `JSON.parse` then fails with a misleading `invalid-departures`.
   `itinerary_json` already correctly uses `.toString()`. **The new field must
   never go through `sanitizeInput`, and the other two should move off it in the
   same change.**
2. **`GLightbox` binds the document-wide selector `[data-glightbox]`**
   (`DayAccordion.tsx:39`). Two mounted accordions = two instances both binding
   every photo link. **Only ever mount one accordion.**
3. **`DayAccordion` is `client:visible`** (`[slug].astro:552`) while the panel is
   `client:load` — on desktop a user can pick a date before the itinerary island
   has ever hydrated, so a plain `addEventListener` subscriber misses the event
   permanently. Needs a latch, not just an event.
4. **Tailwind display utilities tie with `[hidden]`** (equal specificity). A
   variant wrapper that also carries `grid`/`flex` will not hide. Wrappers must
   be bare.
5. **`/trips/<slug>/` is edge-cached** for 300s (`middleware.ts:101-105`). One
   HTML document serves everyone, so switching must be client-side and must not
   touch the query string (that would fragment the cache key). A hash is safe.
6. **No `ViewTransitions`/`ClientRouter`** anywhere — inline scripts run once per
   document, no re-init hazard.
7. **`update.ts:29-31` blocks the save on *any* parse error.** So an unknown
   `variantId` must **never** produce an error — otherwise deleting a variant
   would make the very save that deletes it impossible.

---

## 1. Read path — `src/lib/trips.ts` + two new pure modules

### `src/lib/itinerary.ts` (new — pure, no `fs`; the header should say why)

Move `[slug].astro:146-159` in verbatim, including `photos.slice(0,3)` and the
B/L/D expansion, so the zero-variant render is byte-identical.

```ts
export interface ItineraryDayPhoto { image: string; width: number | null; height: number | null }
export interface ItineraryDay {
  day: number; title: string; description: string;
  stay: string; meals: string[]; transport: string; note: string;
  photos: ItineraryDayPhoto[];
}
/** Accepts both the current (day/title/description) and legacy
 *  (dayNumber/dayTitle/activities + B/L/D booleans) shapes. */
export function normalizeItineraryDays(raw: unknown): ItineraryDay[];
```

`DayAccordion.tsx` switches to `import type { ItineraryDay }` from here (type-only,
erased at build — the module staying `fs`-free is what makes that safe).
`normalizeItineraryPhotos()` (`trips.ts:195`, the admin **write** path) stays
where it is; it mutates in place for YAML hygiene. Do not merge the two.

### `src/lib/departureSelection.ts` (new — pure, no `fs`)

```ts
export const DEPARTURE_CHANGE_EVENT = 'stt:departure-change';
export const BASE_VARIANT_ID = '__base';

export interface DepartureSelection {
  departureId: string | null;
  variantId: string | null;   // null ⇒ base
  variantLabel: string;       // '' when base
  dateLabel: string;
}
export function publishDepartureSelection(sel: DepartureSelection): void;
export function readDepartureSelection(): DepartureSelection;
export function subscribeDepartureSelection(fn: (s: DepartureSelection) => void): () => void;

/** THE single definition of "what is selected on first paint".
 *  Extracted verbatim from BookingPanel.tsx:81-82. */
export function initialDepartureId(deps: Array<{ id: string; comingSoon?: boolean }>): string;
```

The latch is **`document.documentElement.dataset`**, not a module variable: it
is shared by construction, readable by the plain inline script (which is not in
the module graph at all), pre-populated by the *server* render, and visible in
devtools. A module-scoped cache would depend on Vite emitting one shared chunk —
an invisible invariant a future `client:only` could break silently.

`initialDepartureId()` being one exported function used by **both** the server
render and `BookingPanel`'s `useState` initializer is what stops server HTML and
hydrated client from drifting.

### Extensions to the existing resolver

```ts
export interface ResolvedVariantContent {
  id: string;            // BASE_VARIANT_ID for the base entry
  label: string;         // '' for base
  itinerary: ItineraryDay[];
  included: string[]; excluded: string[]; highlights: string[];
  duration: string; meetingPoint: string;   // '' when unset
}
interface ResolvedDeparture { /* …existing… */
  variantId: string | null;   // never dangling
  variantLabel: string;
}
interface ResolvedBooking  { /* …existing… */
  /** Always contains BASE_VARIANT_ID, plus only ids an upcoming departure
   *  references. `Object.keys(content).length === 1` is the no-variants test. */
  content: Record<string, ResolvedVariantContent>;
}
```

- **Dangling ids collapse to base, they do not create keys.** Build a `defined`
  map from `trip.itineraryVariants`, skipping entries with no `id`, a duplicate
  `id`, or `id === BASE_VARIANT_ID`. A batch whose `variantId` is not in it
  resolves to `null`. This guarantees `content[d.variantId ?? BASE]` is never
  `undefined` on the render side, and matches the file's existing
  tolerate-garbage-silently posture.
- **`excluded` aliasing at both levels.** Base: `trip.excluded ?? trip.notIncluded ?? []`
  (today's rule, `[slug].astro:162`). Variant: `v.notIncluded ?? v.excluded`.
  The resolved field is always named `excluded`.
- **`occupancyOverrides` does not go in `content`** — it is a booking concern.
  Add `variantCatalog(base, variant)` merging by id (unknown ids ignored, base
  order preserved) and call it inside the `rawDepartures.map()` before
  `resolveOffers(b, trip, catalogForThisBatch)`. `ResolvedBooking.occupancyCatalog`
  stays the *base* catalog, which admin/import callers rely on. Because
  `ResolvedOffer` already carries `label`/`helperText` per departure and
  BookingPanel's occupancy block is already reactive to the selected date
  (`BookingPanel.tsx:258,291`), **variant tier labels work with zero client changes.**
- **Memo unchanged.** Append one sentence to `trips.ts:436-452`: `content` is
  filtered by which departures are upcoming, so it inherits the same staleness
  window; a variant can linger in the map for one cache generation after its
  last departure passes, and nothing renders it.
- **Cost accepted.** `content` is built on all four listing passes that want no
  itinerary — ~8 day objects × 17 trips of array mapping per cache generation.
  A separate `resolveTripContent()` with its own WeakMap was considered and
  rejected: the "only referenced variants" filter needs the departure list, so
  it would duplicate `upcomingBatches()` plus the dangling-id reconciliation,
  and the page would make two calls that must agree. One boundary beats two.

---

## 2. Public page — `src/pages/trips/[slug].astro`

**When `Object.keys(content).length === 1` (all 17 trips today) nothing changes** —
identical markup, identical JS, zero extra bytes.

When variants exist, a **hybrid**, because the two halves have opposite constraints:

### Itinerary → event + latch, exactly one mounted accordion

New island `src/components/ItineraryVariants.tsx` (`client:visible`), holding all
variants' days as a prop and rendering one accordion:

```tsx
const [variantId, setVariantId] = useState(initialVariantId);
useEffect(() => {
  const now = readDepartureSelection();          // late-join: panel may have
  if (now.departureId) setVariantId(now.variantId ?? BASE_VARIANT_ID);  // published already
  return subscribeDepartureSelection((s) => setVariantId(s.variantId ?? BASE_VARIANT_ID));
}, []);
const active = variants[variantId] ?? variants[BASE_VARIANT_ID];
return <DayAccordion key={variantId} itinerary={active.itinerary} tripName={tripName} />;
```

`key={variantId}` remounts, which resets `openDay` to day 1 and re-runs the
glightbox effect — the existing cleanup at `DayAccordion.tsx:41-45` already does
the right thing. **`DayAccordion` itself needs no change** beyond adopting the
shared types. Constraint 2 is satisfied because only one is ever mounted;
constraint 3 by the latch read on mount.

`BookingPanel` publishes from an **effect keyed on `departureId`**, not from the
click handler — so mount and bfcache restore also publish and the latch can never
disagree with React state.

Render the wrapper only when variants exist, so variant-less trips keep shipping
today's plain `<DayAccordion client:visible />`.

### Everything else → server-render all, toggle with one inline script

At-a-glance duration, meeting point, included/excluded, highlights and the
sidebar duration each render one **bare** `<div data-variant-block="<id>">` per
content key (constraint 4 — the grid/flex class goes on a child), all but the
initial one carrying `hidden`. One `is:inline` script, rendered only when
variants exist, listens for `DEPARTURE_CHANGE_EVENT` and applies
`el.hidden = el.dataset.variantBlock !== active`, guarded by a
`dataset.sttVariantApplied` check so the panel's mount-publish is a no-op and
there is no flash. It then dispatches `stt:variant-applied`.

Deliberately dumb rule: if a variant has no block for a section (its `included`
was empty so the section was skipped for it), nothing shows — the correct
outcome, no special-casing. This page already uses exactly this
inline-script-plus-`data-testid` idiom for the accommodation gallery
(`[slug].astro:745-760`).

| | no-JS / crawler | added hydration | late-hydration safe |
|---|---|---|---|
| inclusions / glance / highlights | initial variant visible, rest `hidden` | **none** | yes — script runs at parse |
| itinerary | initial variant server-rendered by the island's SSR pass | one thin wrapper | yes — latch read on mount |

### Three fixes this forces

- **`departuresForPanel` (`[slug].astro:132-140`) rebuilds coming-soon departures
  as an explicit object literal** — add `variantId` and `variantLabel`, or a
  coming-soon departure silently falls back to base while its date is selected.
- **The highlights collapse script (`[slug].astro:450-473`)** grabs
  `[data-highlights-list]` once and measures `scrollHeight`; a `hidden` element
  measures 0, so "Read more" never appears. Query
  `[data-highlights-list]:not([hidden])` at call time and re-run `check()` on
  `stt:variant-applied`.
- **The smooth-scroll handler is bound to `#sticky-cta` only** (`[slug].astro:798-801`).
  Generalise it to `a[href="#booking-panel"]` so the new "change dates" links reuse it.

### What the visitor sees

Rendered above the accordion inside `aria-live="polite"`:
- **Before a date is picked** (the common multi-departure case): *"Plans differ
  by date. Showing the standard plan — **choose your dates** to see the exact
  itinerary."*
- **After**: *"Showing the plan for **21–27 Jun** · **Living Root Route**"* with a
  **Change dates** link. Built with the existing `formatDepartureRange()`
  (`departureSummary.ts:10`).
- The same line repeats once above the inclusions block (plain Astro, filled by
  the inline script).
- **Reverse cue for mobile**, where the panel sits *below* the itinerary: when
  `hasItineraryVariants`, `BookingPanel` renders one line under the date list —
  *"The plan and what's included updated for these dates ↑"* → `#trip-itinerary`.
  A cross-reference, not a second selector.

### JSON-LD

`[slug].astro:198-201` carries an explicit invariant — the TouristTrip
`itinerary` describes only days *visible on the page*. So emit exactly one
ItemList: **the variant actually in the initial HTML**. That is base in every
multi-departure case, and the single departure's variant on a one-departure trip —
tying it to the initial render rather than unconditionally to base is the only
choice that keeps the invariant true in both cases. `schema.org/TouristTrip` has
a single `itinerary` property; N nodes with distinct `@id`s on one URL would
fragment the entity for no upside.

Two `Event` corrections, both factual: `location` must come from the departure's
variant `meetingPoint` (today it is `trip.meetingPoint` for every departure,
`[slug].astro:189-194`), and `name` gains the variant label so two genuinely
different routes are distinguishable.

---

## 3. Write path — `src/lib/tripEditor.ts` + admin API

```ts
export interface EditorVariantOccupancyOverride { tierId: string; label?: string; helperText?: string }
export interface EditorVariant {
  id: string; label: string;
  duration?: string; meetingPoint?: string;
  highlights?: string[]; included?: string[]; notIncluded?: string[];
  occupancyOverrides?: EditorVariantOccupancyOverride[];
  itinerary?: any[];
}

// extracted from parseEditorBooking:184-190 so routes can get tier ids first
export function parseOccupancyCatalog(json: string): { occupancyCatalog: EditorTier[]; errors: [] };
export function parseItineraryVariants(json: unknown, validTierIds?: Iterable<string>):
  { itineraryVariants: EditorVariant[]; errors: EditorBookingError[] };
// third param DEFAULTED so existing callers and tests compile untouched
export function parseEditorBooking(catalogJson, departuresJson, validVariantIds: Iterable<string> = []);
```

Sanitization, mirroring `parseGallery`/`parseTripFaqs`: `id = slugify(id || label)`,
dropped with `invalid-variant-id` if still empty; `label` trimmed to 200, falling
back to `id`; **duplicate ids keep the first and drop the rest** (never
auto-rename — a rename would orphan the `batches[].variantId` pointing at it);
each overridable key emitted only when present *and* non-empty; cap at 12
variants; fixed key emission order so repeated saves give stable YAML diffs.

`occupancyOverrides` entries whose `tierId ∉ validTierIds` are dropped —
mirroring the offer filter at `tripEditor.ts:197,213-218`. Built with an
**explicit three-key literal, never a spread**, so no hand-crafted payload can
smuggle `price`/`cap`/`booked` into a variant.

New error codes: `invalid-variants`, `invalid-variant-id`,
`duplicate-variant-id`, `too-many-variants`; `EditorBookingError` gains
`variantIndex?`.

**There is deliberately no `unknown-variant` error** (constraint 7). An unknown
`variantId` is silently omitted from the batch, which *is* the "absent ⇒ base"
semantics, exactly as unknown `tierId`s are already dropped:

```ts
...(variantId && variantIds.has(variantId) ? { variantId } : {}),
```
Conditional spread rather than `variantId: null`, so YAML for the ~15
variant-less trips stays clean.

### Route wiring (identical in `update.ts` and `create.ts`)

```ts
// NOT sanitizeInput — it truncates at 5000 chars (utils.ts:27-30)
const catalogJson    = body.get('occupancyCatalog_json')?.toString() ?? '[]';
const departuresJson = body.get('departures_json')?.toString() ?? '[]';
const variantsJson   = body.has('itineraryVariants_json')        // back-compat guard,
  ? (body.get('itineraryVariants_json')?.toString() ?? '[]')     // mirroring the FAQ
  : JSON.stringify(existing.itineraryVariants ?? []);            // guard at update.ts:65-67

const { occupancyCatalog: preCatalog } = parseOccupancyCatalog(catalogJson);
const { itineraryVariants, errors: variantErrors } =
  parseItineraryVariants(variantsJson, preCatalog.map(c => c.id));
if (variantErrors.some(e => e.code === 'invalid-variants'))
  return redirect(`/admin/trips/${oldSlug}?error=invalid-variants`);
for (const v of itineraryVariants) if (v.itinerary) normalizeItineraryPhotos(v.itinerary);

const { occupancyCatalog, batches, errors } =
  parseEditorBooking(catalogJson, departuresJson, itineraryVariants.map(v => v.id));
```

Add the `invalid-variants` banner to `new.astro`'s `FORM_ERRORS` (`:32-35`) and
`[slug].astro` (`:58`, which today handles only `incomplete-departure`).

### Every whitelist — miss one and data is silently destroyed

| # | Location | Change | If skipped |
|---|---|---|---|
| 1 | `api/admin/trips/update.ts:77-107` `data` literal | add `itineraryVariants` | **first save of any trip deletes every variant** |
| 2 | `api/admin/trips/create.ts:68-98` `data` literal | add `itineraryVariants` | trips created with variants lose them at birth |
| 3 | `tripEditor.ts:225-235` batch literal | conditional `variantId` spread | **every departure's assignment dropped on every save** — the quietest of them |
| 4 | `tripEditor.ts:11-19` `EditorDeparture` | add `variantId: string` (`''` = base) | field never reaches the editor |
| 5 | `tripEditor.ts:115-123` `editableBooking` projection | `variantId: String(b?.variantId ?? '')` | editor shows every departure as Base, then writes that lie |
| 6 | `tripEditor.ts:78-127` `editableBooking` return | add `editorVariants: EditorVariant[]` | editor has no initial state (additive — the 3 existing consumers destructure only what they use) |
| 7 | `trips.ts:480-509` `resolveBookingUncached` | emit `variantId`/`variantLabel` | public side can't resolve content |
| 8 | `[slug].astro:132-140` coming-soon literal | add `variantId`/`variantLabel` | coming-soon dates silently show base |
| 9 | `api/admin/trips/import.ts:84` | loop `normalizeItineraryPhotos` over `data.itineraryVariants[].itinerary` | **imported YAML smuggles arbitrary external image URLs** — the hole that function exists to close |
| 10 | `api/admin/trips/duplicate.ts:33-49` | no code change (`...source`/`...b` carry it) — **add a regression test**, since it survives only by accident of the spread | a future narrowing breaks it invisibly |
| 11 | `registrationsView.ts:11-24` + `:335-365` | add `variantId`/`variantLabel` | §5 has nothing to render |
| 12 | `adminTripOptions.ts:14-19` + `:42-55` | append variant to the departure label | admin can't tell which itinerary they're booking someone onto |
| 13 | both admin pages | pass `variantId` through the departures component | forgetting `new.astro` = new trips silently can't carry variants |

Verified as needing **no** change: `collectImageUrls` (`_contentBase.ts:97-106`,
fully recursive, so `deleteTrip` already reclaims variant photos) and
`adjustBookingCount` (`registrationWrite.ts:42-77`, mutates parsed YAML in place).

**Fix alongside:** `excluded` and `coverImage` are live on disk
(`monsoon-meghalaya.yaml` uses `excluded`) and read by the public page, but are
absent from the `update.ts` write list — destroyed on the next admin save. A
pre-existing bug that will bite during this work.

---

## 4. Admin UI

### Extract first, as a provably-no-op commit

The duplicated block is not merely duplicated, it is **singleton-shaped**:
`container` is captured at module scope and `#itin-count`, `#add-day-btn`,
`#expand-all-btn`, `#itinerary_json` are page-global ids. Variants need more
than one day-list model on one page, so every one of those has to become scoped —
and doing that surgery twice in two 800-line files that must stay identical is
how they drift. (They differ **only in comments** today; nothing tests `new.astro`.)

The pattern already exists in-repo: `TripGalleryEditor.astro` takes
`editorId` + `fieldName`, finds everything via `root.querySelector('[data-…]')`,
and is already instantiated **twice on one page** (`[slug].astro:312,316`).
`TripFaqEditor.astro` likewise owns a whole tab panel plus its hidden inputs.

Create `src/components/admin/TripItineraryEditor.astro` and
`TripDeparturesEditor.astro` the same way, plus a shared `createDayList()`
controller and one exported `readEditorDay()` holding the dual-shape `??` chain
(today duplicated at `[slug].astro:418-427` and `new.astro:389-397` — variants
would make it four copies). The per-day `.day-*` classes stay untouched; they are
already card-scoped, so `admin-trip-form.css:177-334` needs no change.

Both editors go in **one** commit: §4's departure `<select>` is driven by state
owned by the *itinerary* tab, and written twice that cross-tab wiring diverges on
exactly the bug that matters.

**Acceptance check:** open an existing trip, save untouched, `git diff` on its
YAML is empty but for `updatedAt`. Repeat for a legacy `sharingOptions`-only trip.

### Itinerary tab

Zero-variant trips see one ghost affordance at the end of the toolbar
(`+ Add itinerary variant`) and nothing else — pixel-identical to today.

Once a variant exists, a chip row: `[ Base itinerary ] [ Living Root Route · 2 deps ✎ ✕ ] [ + Add variant ]`.
The live `· N deps` count means an admin sees blast radius *before* clicking ✕.

Below it, an override strip — one row per overridable key, each a two-state
segmented control `Inherit from base` / `Override`. **A key is serialized if and
only if its toggle reads Override.** That is the whole sparseness contract, made
visible rather than inferred. `Inherit → Override` seeds the editor with a deep
clone of the current base value (the realistic case is "same trip, two days
swapped"); `Override → Inherit` confirms before discarding.

The occupancy row is labelled *"Rename how a tier is shown on this variant.
Prices, caps and tier IDs stay trip-level"* and offers only `label`/`helperText` —
there is no price input anywhere in the variant editor.

One container, one `createDayList`, committed on switch
(`commitActivePane()` runs on every chip click and on submit). Guard switching
while a day-photo upload is in flight, or it resolves into a detached card.

**Deleting a referenced variant does not block** — it confirms
(*"2 departures use this. Deleting puts them back on the base itinerary."*), then
resets those `variantId`s. This matches what the server does anyway (§3 drops
unknown ids), so the client never shows something the save won't honour.

Variant `id` is **frozen at creation** and shown in small mono text on the chip,
so it is obvious that rename ≠ re-key.

### Departures tab

A fourth control in `renderDepartures()`'s `head.innerHTML`
(`[slug].astro:839-848`), rendered only when variants exist: a `.dep-variant`
select of `Base itinerary` + each variant. A `variantId` that no longer exists
renders as a visible `⚠ … (removed)` option rather than silently snapping to
Base. New-departure literals (`[slug].astro:919`, `new.astro:772`) gain
`variantId: ''`.

**Cross-tab sync** via two idempotent events on the shared `<form id="trip-form">`,
so neither component imports the other: `trip-variants:changed`
(itinerary → departures, to refresh options and reconcile stale ids) and
`trip-departures:changed` (departures → itinerary, for the `· N deps` badges).
Both dispatch once on init, so whichever mounts second still gets the other's
state.

### Leave the day-shape wart alone

The editor reads both day shapes but always writes
`dayNumber/dayTitle/activities/…` while YAML on disk uses `day/title/description/…`.
There is no user-visible symptom (`normalizeItineraryDays` handles both), and a
migration rewrites every trip's itinerary on its next save with git as the only
undo — that belongs in its own commit with `git diff` as the review surface.
**But contain it:** one `readEditorDay()` helper, and variant days written with
exactly the same 10 keys as base days, so the eventual migration walks both
through one function.

---

## 5. Admin registrations

Show the variant where a wrong one would be *noticed* or *created*, nowhere else:
a `.dep-variant-chip` beside the existing status chip on each departure article
(`admin/registrations/[slug].astro:209-213`); a trip-level line
(`Itineraries: Base (3 departures) · Living Root Route (2)`) when ≥2 are in play;
and the variant appended to the departure label in `adminTripOptions.ts`, which
feeds `/admin/registrations/new` and `/import`. `RegistrationCard` gets nothing —
the variant is a property of the header directly above it, and repeating it per
row is noise.

---

## Risks worth naming

- **Reassigning a variant changes the plan under people who already booked.**
  Bookings resolve live through `batch_id`, so a traveller's itinerary can change
  silently. Mitigation this pass: warn in the editor when the departure has
  confirmed registrations — that count is already computed
  (`admin/trips/index.astro:12-16`). A per-booking content snapshot is the fuller
  fix and is deliberately **out of scope**.
- **If a variant editor ever writes `[]`/`null` for an unchanged key, inheritance
  silently dies.** The override toggles exist precisely to prevent this; state it
  in the `parseItineraryVariants` JSDoc.
- **No outbound channel carries itinerary content** — emails
  (`emailTemplates.ts`), Telegram (`telegram.ts`) and Zoho invoices
  (`zohoBooks.ts`) only send `trip_name` + `trip_date`. Nothing to update. Worth
  knowing before anyone goes looking.
- **A peer session is working on departure margins** (`departure_costs`, keyed on
  the same `(trip_slug, batch_id)` pair). No functional overlap, but
  `src/lib/tripEditor.ts` is a shared touchpoint — coordinate before editing it.

---

## Sequencing

Each commit is independently shippable; risk concentrates in D and F.

| | Commit | Acceptance |
|---|---|---|
| **0** | Write this plan to `docs/itinerary-variants-plan.md` (repo convention — `docs/` already holds `admin-registrations-rework-plan.md` etc.) | — |
| **A** | `itinerary.ts` + `departureSelection.ts`; `[slug].astro`, `DayAccordion`, `BookingPanel` switch to them | pure refactor, **zero** behaviour change |
| **B** | Extract `TripItineraryEditor` + `TripDeparturesEditor` | save an untouched trip ⇒ `git diff` empty but for `updatedAt` |
| **C** | `tripEditor.ts` data boundary + all unit tests | pure, no UI, fully testable in isolation |
| **D** | Write paths: `update.ts`, `create.ts`, `import.ts`, the `sanitizeInput` fix, error banners | server round-trips a hand-written `itineraryVariants_json` |
| **E** | `trips.ts` variant resolution + `resolveBooking` tests | server-only; page still ignores `content` |
| **F** | Public page: static blocks + inline toggler, then `ItineraryVariants`, then JSON-LD | E2E below |
| **G** | Admin variant UI (chips, override strip, departure select, event bus) | manual check below |
| **H** | `registrationsView.ts`, `adminTripOptions.ts`, `registrations/[slug].astro` | — |

D before G is deliberate: the server must persist and round-trip a hand-written
payload before any UI exists to produce one.

---

## Verification

**1. Unit — `npm run test:unit`**

`tests/unit/tripEditor.test.ts`:
- Sparse keys survive *exactly* — assert `Object.keys(out[0]).sort()`, not
  `toMatchObject`, so a stray `duration: null` fails the test.
- `expect('duration' in out[0]).toBe(false)` for an absent key; `{included: []}`,
  `{itinerary: []}`, `{duration: '  '}` all collapse to inherit.
- Duplicate ids: first kept, second dropped with `duplicate-variant-id`.
- `occupancyOverrides` filtered against the catalog; an override carrying
  `price`/`cap`/`booked` yields exactly `{tierId, label}` (the tier-id-space invariant).
- Malformed JSON ⇒ `[]` + `invalid-variants`, no throw. >12 ⇒ `too-many-variants`.
- `parseEditorBooking`: valid `variantId` kept; absent ⇒
  `expect('variantId' in batches[0]).toBe(false)`; **unknown ⇒ key absent AND
  `errors` gains nothing** (this is the test that guarantees a deleted variant
  doesn't block the save that deletes it); two-arg call still compiles and drops
  all variant ids.

New `describe('editor round-trip')` — the tests that actually protect the whitelists:
- Sparseness is a fixed point: `trip → editableBooking → serialize → parse`
  reproduces `itineraryVariants` and `batches` deep-equal, for (a) zero variants,
  (b) one variant overriding only `itinerary`+`included`, (c) two variants with
  one departure on each and one on base.
- Zero-variant trips are byte-stable — no `itineraryVariants` key, no batch gains
  a `variantId`.
- Deleting a variant orphans nothing: variants `[A]`, departure on `B` ⇒ batch
  returns with no `variantId`, offers intact.
- Tier id space never widens: offer tierIds ∪ override tierIds ⊆ catalog ids.

`tests/unit/resolveBooking.test.ts`: dangling `variantId` → base; unreferenced
variant excluded from `content`; `notIncluded`/`excluded` aliasing;
`occupancyOverrides` lands on `ResolvedOffer.label` but never changes `tierId`.

**2. Fixture + E2E — `npm run test:e2e`**
Add `src/content/trips/qa-test-variants.yaml`: three future departures, two on a
variant and one on base. Add `tests/e2e/itinerary-variants.spec.ts` following
`tests/e2e/booking.spec.ts` (click `[data-testid="departure-<id>"]`): assert day-1
title, the included list, and `glance-duration` all change; assert price still
tracks the date; assert a zero-variant trip renders **no** `[data-variant-block]`.

**3. Regression** — `booking.spec.ts`, `coming-soon.spec.ts`,
`trip-description.spec.ts` pass untouched, proving variant-less trips are unaffected.

**4. Manual, on the real case** — `npm run dev`, `/admin/trips/monsoon-meghalaya`:
add a "Living Root Route" variant overriding only day 2's `stay` and the
inclusions, assign it to `meghalaya-aug-2026` + `meghalaya-sep1-2026`, save. Then
- reopen the editor — variant and both assignments survived (the whitelist check);
- `git diff src/content/trips/monsoon-meghalaya.yaml` — the variant is **sparse**
  (only overridden keys), and no pre-existing key was dropped;
- `/trips/monsoon-meghalaya/` — switch across all four dates; itinerary,
  inclusions and price all follow the one selector; no flash on load;
- view source — exactly one TouristTrip `itinerary` in the JSON-LD;
- delete the variant while both departures still reference it — the save succeeds
  and both fall back to base.

**5. No-JS** — load with JavaScript disabled: the initial variant's itinerary and
inclusions are in the served HTML.
