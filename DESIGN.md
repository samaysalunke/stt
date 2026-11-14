---
name: Seek the Thrill
description: The Offbeat Escape — warm, editorial travel design with friendly, confident controls.
colors:
  coral: "#E8725A"
  cta: "#C6472A"
  blush: "#FDF0EC"
  navy: "#1B2B3A"
  peach: "#F5DDD7"
  white: "#FFFFFF"
  gray-soft: "#F5F5F3"
  surface-soft: "#FCFAF9"
  gray-text: "#646B76"
  whatsapp: "#25D366"
  whatsapp-ink: "#128C7E"
  star: "#D4A854"
  step-active: "#E8A05A"
  coral-ink: "#B84E2B"
  navy-deep: "#111D27"
  coral-hover: "#D45C44"
  success: "#22A654"
  danger: "#D93025"
  danger-surface: "#FEE2E2"
  danger-ink: "#991B1B"
  danger-border: "#FECACA"
  success-ink: "#157A3F"
  warning-surface: "#FEF3C7"
  warning-border: "#FCD34D"
  warning-ink: "#92400E"
  success-surface: "#D1FAE5"
  success-surface-ink: "#065F46"
  info-surface: "#DBEAFE"
  info-ink: "#1E40AF"
  info-border: "#93C5FD"
  caution-surface: "#FEF9C3"
  caution-ink: "#78350F"
  interest-surface: "#E0E7FF"
  interest-ink: "#3730A3"
  interest-border: "#C7D2FE"
  interest-fill: "#4338CA"
  neutral-surface: "#E2E8F0"
  neutral-ink: "#334155"
  muted-surface: "#F3F4F6"
  muted-ink: "#374151"
  border: "#E8DDD9"
typography:
  display-xs:
    fontFamily: "'Fraunces', Georgia, serif"
    fontSize: clamp(1.2rem,   1.1563rem + 0.2183vw, 1.331rem)
    lineHeight: 1.35
  display-sm:
    fontFamily: "'Fraunces', Georgia, serif"
    fontSize: clamp(1.45rem,  1.3787rem + 0.3567vw, 1.664rem)
    lineHeight: 1.3
  display-md:
    fontFamily: "'Fraunces', Georgia, serif"
    fontSize: clamp(1.7rem,   1.5733rem + 0.6333vw, 2.08rem)
    lineHeight: 1.22
  display-lg:
    fontFamily: "'Fraunces', Georgia, serif"
    fontSize: clamp(1.95rem,  1.7333rem + 1.0833vw, 2.6rem)
    lineHeight: 1.12
  display-xl:
    fontFamily: "'Fraunces', Georgia, serif"
    fontSize: clamp(2.25rem,  1.9167rem + 1.6667vw, 3.25rem)
    lineHeight: 1.05
  body:
    fontFamily: "'Manrope', ui-sans-serif, system-ui, sans-serif"
    fontSize: 1rem
    lineHeight: 1.7
  label:
    fontFamily: "'Manrope', ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 500
  badge:
    fontFamily: "'Manrope', ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 700
    letterSpacing: 0.025em
rounded:
  card: 1.5rem
  pill: 9999px
  xl: 0.75rem
  2xl: 1rem
spacing:
  "2": 0.5rem
  "4": 1rem
  "5": 1.25rem
  "6": 1.5rem
  "8": 2rem
  "12": 3rem
  "16": 4rem
  "20": 5rem
  "28": 7rem
components:
  button-primary:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: 0.75rem 1.5rem
  button-cta:
    backgroundColor: "{colors.cta}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: 0.75rem 1.5rem
  button-outline:
    backgroundColor: transparent
    rounded: "{rounded.pill}"
    padding: 0.75rem 1.5rem
  button-ghost:
    backgroundColor: transparent
    rounded: "{rounded.pill}"
    padding: 0.75rem 1.5rem
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.navy}"
    rounded: "{rounded.xl}"
    padding: 0.625rem 1rem
    width: 100%
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.card}"
  badge-open:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success-surface-ink}"
    rounded: "{rounded.pill}"
    padding: 0.125rem 0.625rem
    typography: "{typography.badge}"
  navigation-link:
    textColor: "{colors.navy}"
    rounded: "{rounded.xl}"
    padding: 0.55rem 0.75rem
  navigation-link-active:
    backgroundColor: "{colors.blush}"
    textColor: "{colors.coral-ink}"
    rounded: "{rounded.xl}"
---

# Design System: Seek the Thrill

## Overview

**Creative North Star: "The Offbeat Escape"**

The Offbeat Escape is expressive and adventurous: travel imagery, warm accents, and characterful serif headings make the public experience feel personal. Its confirmed character is warm, editorial, and approachable, with quieter, practical booking and admin screens.

Controls are friendly and confident. Rounded shapes and layered surfaces make the interface welcoming; clear labels, stable hierarchy, and restrained operational layouts keep it usable. Depth is layered, with gentle lift for interactive elements.

**Key Characteristics:**

- Travel imagery paired with expressive Fraunces headings.
- Warm Coral, Deep Navy, and Soft Blush across light surfaces and dark bands.
- Manrope for readable body text, navigation, labels, and operational controls.
- Rounded cards, pill actions, and gentle interactive lift.
- Shared brand tokens with denser, quieter booking and admin layouts.

This record describes the current working-tree implementation, including uncommitted UI changes. Primary sources are `src/styles/tokens.css`, `src/styles/fonts.css`, `src/components/ui/`, `src/components/TripCard.astro`, `src/components/Header.astro`, and the public/admin layouts. Existing desktop and mobile regression captures corroborate the broad visual language; their homepage composition predates the current hero and header. The screenshot harness substitutes the logo for remote photography and masks some content, so those captures do not establish imagery or copy rules. No new visual anti-reference was specified.

## Colors

Warm Coral supplies energy, Deep Navy anchors text and dark surfaces, and Soft Blush introduces warmth. Frontmatter preserves the source token names and exact values.

### Primary

- **Warm Coral** (`coral`): large expressive accents, focus outlines, and readable coral accents against navy.
- **CTA Coral** (`cta`): darker fill for white-label conversion actions.
- **Coral Ink** (`coral-ink`): small accent text and links on light surfaces.
- **Coral Hover** (`coral-hover`): retained incumbent variant; shared buttons instead use brightness changes on hover.

### Secondary

- **Soft Blush** (`blush`): warm section bands, selected navigation, and supporting panels.
- **Peach** (`peach`): input borders and warm dividers.

### Neutral

- **Deep Navy** (`navy`) and `navy-deep`: primary text, ordinary affirmative buttons, and dark backgrounds.
- `white`: cards and form controls. `gray-soft`: page canvas. `surface-soft`: warmer nested panels and table headers.
- `gray-text`: supporting text. `border`: subdued separators.

Semantic colors retain their meanings: success for confirmation/open booking, danger for errors or sold out, interest for coming soon/wishlist, caution for draft/lead states, warning for advisories, info for informational/payment states, and neutral/muted for inactive or resolved states. Category badges use blush and navy. WhatsApp colors remain external brand colors; star and step-active represent ratings and checkout progress rather than generic warnings.

**The Coral Role Rule.** Use cta for the shared coral button fill, coral-ink for normal-size coral text on light surfaces, and coral for large accents or coral text on navy. These roles are not interchangeable.

**The Paired Status Rule.** Keep each semantic surface with its corresponding ink. Success text on white uses success-ink; mint success badges use success-surface-ink.

## Typography

**Display Font:** Fraunces, with Georgia and serif fallbacks. **Body Font:** Manrope, with UI sans-serif/system fallbacks. The accent family is also Manrope; there is no distinct brand monospace family.

Fraunces carries editorial headings and prominent prices. Manrope keeps descriptions and controls clear. Both families are self-hosted variable fonts with swap loading; the shipped font faces are normal style. Some display treatments request italic through CSS.

### Hierarchy

- **Display:** the five `display-xs` through `display-xl` frontmatter roles retain the exact fluid sizes and line heights. Size maxima form a major-third progression; mobile minima are compressed. Weight is chosen by the component, not fixed by the size token.
- **Headline and title:** shared section headings use display-md; trip-card names and prices use display-sm with local line-height overrides. Some route headings still use standard or custom sizes.
- **Body:** the documented body role matches rich text. Ordinary page and control copy also uses the framework's standard small/base sizes and local line heights.
- **Label:** form labels use medium-weight Manrope. Badges use bold uppercase text with modest tracking. Table headers use a wider tracked uppercase treatment.

**The Shared Scale Rule.** Use the existing fluid display scale for shared heading patterns. Preserve documented route-specific typography rather than claiming every heading already uses that scale.

## Layout

The shared container is centered with an 80rem maximum width. Gutters are 1.25rem, increasing to 2rem at 640px and 3rem at 1024px. The frontmatter spacing steps are reused framework utilities, not newly introduced CSS variables.

Shared sections offer 3rem vertical padding for small spacing; medium spacing grows from 4rem to 5rem at the large breakpoint; large spacing grows from 5rem to 7rem. Header blocks are capped at 42rem. Card bodies offer 1rem, 1.5rem, and 2rem padding, with the middle size as default.

Layouts respond to their task: trip listings move from one column to two at 640px; trip detail uses a flexible content column and a 360px booking column from 1024px, with a 3rem gap. Its booking panel becomes sticky on desktop, while mobile has a separate bottom booking action. These are existing route patterns, not mandatory templates for every screen.

Public discovery accommodates full-bleed imagery, horizontal trip collections, and alternating light/blush/navy bands. Admin layouts use compact navigation, filters, tables, and bordered panels. Both consume shared brand tokens through separate public and admin CSS bundles.

## Elevation & Depth

Layered, with gentle lift for interactive elements. White surfaces sit above off-white or blush backgrounds. Soft shadows separate cards; stronger shadows and dimmed backdrops distinguish overlays. Borders remain useful for forms, tables, and admin panels.

### Shadow Vocabulary

- **Card:** `0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)` — shallow control and small-panel separation.
- **Lifted:** `0 10px 25px rgba(0,0,0,0.12), 0 4px 10px rgba(0,0,0,0.06)` — stronger elevation where the incumbent component calls for it.
- **Media:** `0 4px 30px -12px rgba(27,43,58,0.18)` — diffuse navy-tinted depth under card shells.

**The Gentle Lift Rule.** Keep shared interactive lift small: buttons and hover-enabled cards rise 2px. Reserve the strongest separation for overlays and elevated panels.

Dark image scrims are functional contrast layers. The current homepage slide scrim follows bottom-positioned mobile copy and left-positioned desktop copy; do not replace it with the weaker generic scrim. The header uses a translucent navy background and blur when visible over content; the navigation drawer uses a dimmed, blurred backdrop.

## Shapes

Friendly and confident: generous rounded card shells, pill actions, and smaller rounded form controls. The card and pill frontmatter values are explicit brand variables; xl and 2xl describe existing framework radii used by controls and panels. They do not imply that every component uses the same corner size.

Card media defaults to a clipped 4:3 slot. Portrait and route-specific imagery can retain their existing aspect ratios. Thin peach or neutral borders distinguish inputs and operational panels; dark image chips use translucent backgrounds for legibility.

## Components

### Buttons

The shared primitive has four variants and three sizes. Primary is navy with white text; CTA is the darker coral with white text; outline uses a current-color border; ghost uses a transparent surface. Outline and ghost inherit their foreground from context.

Small padding is 0.375rem by 1rem, medium is 0.75rem by 1.5rem, and large is 1rem by 2rem. Small and medium labels are 0.875rem; large labels are 1rem. All use semibold Manrope and pill corners. Hover lifts 2px over 150ms and brightens solid variants or adds a subtle navy tint to transparent ones. Keyboard focus uses a 2px coral outline with a 2px offset. Disabled and aria-disabled styles reduce opacity to 40% and block pointer interaction; disabled link semantics still require caller handling.

The primitive's intended hierarchy reserves CTA for the principal action and outline for repeated list actions. **Observed exception:** TripCard currently renders its own coral, Fraunces-label “View Details” action. Preserve this distinction when documenting or extending existing cards; documentation alone does not migrate it.

### Inputs and fields

White inputs use peach borders, xl corners, small Manrope text, full width, and the shared coral focus outline. Labels sit above controls; hint or error copy sits below. Shared Field errors use coral-ink, while larger error callouts use the danger surface/ink pair. Select and textarea primitives follow the same family.

### Cards and trip media

The base card is a white flex column with clipped card-radius corners and the media shadow. Hover lift is opt-in on the primitive. CardBody supplies padding and spacing; CardFooter pins actions to the bottom. TripCard adds 4:3 photography, departure overlays, saved-trip controls, a display-face title/price, and booking-state messaging. Sold-out content renders a subdued status in place of its action.

### Status and category badges

Compact uppercase pills use semantic surface/ink pairs. Booking Open is success; Coming Soon is interest; Sold Out is danger; Draft is caution. Unknown status values use the draft tone. Categories use blush/navy. Keep text labels alongside color.

### Navigation

The current public header is a 64px row with branding, account access, and a menu trigger. It can overlay hero imagery transparently before switching to translucent navy. Navigation opens as a right-side drawer capped at 25rem or 92vw, with grouped links, account context, and a footer action. Active links use blush/coral-ink. The drawer supplies dialog semantics and keyboard behavior; a static preview represents its appearance only. Mobile hides desktop account controls below 640px.

### Operational tables

Admin tables use warm surface-soft header rows, neutral border separators, and 0.75rem by 1rem cell padding. Header labels are 0.75rem, semibold, uppercase, and tracked at 0.1em. Body rows gain a warm background on hover. Keep the operational density distinct from spacious promotional sections.

### Motion and focus

Shared buttons transition over 150ms, hover-enabled cards over 200ms, and the navigation drawer over 300ms. Entrance effects use a 14px rise over 700ms; the rise-only hero treatment stays visible to avoid delaying the largest-contentful-paint candidate. Existing entrance, skeleton, hero, and drawer code includes reduced-motion handling; the generic button/card hover transitions are not uniformly disabled. This is a record of the implementation, not a claim of complete accessibility compliance.

## Do's and Don'ts

### Do:

- Do reuse the existing tokens and shared component variants.
- Do preserve readable coral roles and paired semantic status colors.
- Do keep image overlays matched to the position of the text.
- Do retain visible keyboard focus and the existing reduced-motion treatments.
- Do preserve the approved content and identity commitments recorded in PRODUCT.md.

### Don't:

- Don't use the bright coral token as normal-size text on light backgrounds or as the shared white-label CTA fill.
- Don't substitute success fill green for readable success text.
- Don't turn the documented button hierarchy into a claim that all current trip-card actions already follow it.
- Don't use old screenshot layouts or stubbed fixture imagery as authority over current source.
- Don't invent visual anti-references or treat synthesized preview ramps as production tokens.
