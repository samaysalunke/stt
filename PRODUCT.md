# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Seek the Thrill primarily serves solo travelers aged 22–35 looking for offbeat, small-group trips across India. Friend groups are also welcome. Staff use the product to manage travel operations.

## Product Purpose

Help travelers discover trips, book with payment proof, and manage their travel through traveler profiles. Support staff operations alongside the traveler experience.

The audience, geographic focus, and core workflows above were confirmed by the product owner during initialization. A more specific priority among discovery, booking conversion, repeat travel, and staff efficiency remains undecided.

## Positioning

Offbeat, small-group trips across India for solo travelers and friend groups. No exclusive competitive advantage or stronger marketing claim has been confirmed.

## Operating Context

The product spans public trip discovery, booking with payment proof, signed-in traveler profiles, and staff operations. Future changes should account for the traveler journey and the staff work needed to support it.

## Capabilities and Constraints

- Preserve trip discovery, booking with payment proof, traveler profiles, and staff operations unless a task explicitly changes their scope.
- The existing implementation is an Astro web application with React components; implementation details and commands remain authoritative in `package.json` and source code.
- The product owner confirmed the existing content and claims as verified, including founder copy, testimonials, trip photography, group sizes, and confirmation timelines. Preserve these approved facts and service commitments; do not replace factual copy or add claims without authorization.
- Product-specific accessibility requirements, additional audience needs, and measurable success criteria remain open decisions.

## Brand Commitments

The product name is Seek the Thrill. Existing founder copy and published content are approved by the product owner. Preserve their factual meaning. Further voice and brand commitments remain open; this record does not authorize a change to the existing visual identity or copy.

## Evidence on Hand

Repository materials available for review include:

- Trip content in `src/content/trips/`, including files explicitly named as QA fixtures. QA fixtures are not customer evidence or production offerings.
- FAQ content in `src/content/faqs/`.
- Verified testimonial content in `src/content/testimonials/`.
- Site settings in `src/content/site-settings.yaml` and founder-story fallback copy in `src/lib/aboutDefaults.ts`.
- Approved trip photography and images referenced by the application, including stock-image URLs. Preserve their approved use without inventing additional provenance or identity claims.

The product owner explicitly verified the existing claims and content during initialization. This approval does not extend to QA fixtures or newly invented claims, testimonials, or evidence.

## Product Principles

- Keep offbeat, small-group travel across India central to the product.
- Serve solo travelers while accommodating friend groups.
- Support continuity from discovering a trip through booking and managing travel.
- Account for staff operations when changing traveler-facing workflows.
