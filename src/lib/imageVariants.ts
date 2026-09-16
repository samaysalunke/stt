/**
 * Responsive variants for images served by src/pages/images/[...path].ts.
 *
 * Every width here MUST also be in ALLOWED_WIDTHS in that route — a width that
 * isn't allowlisted is silently served at full size, so a mismatch shows up as
 * a performance regression rather than an error. The route may allow widths
 * this list no longer emits (see the legacy note there); it may never be the
 * other way round, and the unit test enforces that direction.
 *
 * The rungs are spaced about 1.2x apart, which is close enough that the width
 * the browser actually needs is rarely more than a few percent below a rung.
 * That matters more than it sounds: a `w` descriptor only qualifies if it is
 * greater than or equal to the required device pixels, so a gap in the ladder
 * doesn't degrade quality, it jumps to the next rung up and overshoots. With
 * the old [480, 720, 1080, 1440] ladder a 412px-wide phone at DPR 1.75 needed
 * 721px, missed the 720 rung by a single pixel, and downloaded 1080w — 161 KiB
 * where 768w would have been 88 KiB.
 *
 * Only paths under /images/ go through the resizing route. A trip cover can
 * also be an absolute third-party URL, and those are returned untouched so the
 * caller simply omits the attribute.
 */
export const IMAGE_VARIANT_WIDTHS = [480, 640, 768, 960, 1152, 1440] as const;

export function imageSrcset(src: string | null | undefined): string | undefined {
  if (!src || !src.startsWith('/images/')) return undefined;
  return IMAGE_VARIANT_WIDTHS.map((w) => `${src}?w=${w} ${w}w`).join(', ');
}

/**
 * `sizes` for a TripCard cover in the /trips/ grid: one column, then two from
 * the `sm` breakpoint, inside .container-app.
 *
 * Measured against production rather than read off the classes, because the
 * container's gutter changes at each breakpoint and the grid's max width caps
 * the card at 576px from 1280px up:
 *
 *   viewport   360  412  639  640  1023  1024  1280  1536
 *   card px    320  350* 599  276   468   448   576   576   (*390px viewport)
 *
 * Below `sm` the card is the full container, which is exactly the viewport
 * less the 20px gutter on each side — so calc() is both shorter and more
 * accurate than a rounded vw here, and it lands a 412px phone on the 768 rung
 * at DPR 2 instead of overshooting to 960.
 *
 * The values are deliberately tight rather than padded. Rounding `sizes` up
 * "for safety" is not free: 580px here instead of the measured 576px pushed a
 * DPR-2 desktop to 1160 required pixels, one over the 1152 rung, and cost
 * 145 KiB per card. Headroom costs a whole rung, so it is only worth carrying
 * where the layout could plausibly move.
 */
export const TRIP_GRID_SIZES =
  '(min-width: 1280px) 576px, (min-width: 640px) 46vw, calc(100vw - 40px)';

/**
 * `sizes` for a TripCard cover in the homepage featured carousel, whose slides
 * are 86% / 46% / 31% of .container-app. 86% of (100vw - 40px) is where the
 * mobile calc() comes from; above 1280px the container stops growing and the
 * slide settles at 367px.
 *
 *   viewport   360  412  639  640  1023  1024  1280  1536
 *   card px    275  320  515  265   441   288   367   367
 */
export const CAROUSEL_SIZES =
  '(min-width: 1280px) 370px, (min-width: 1024px) 29vw, (min-width: 640px) 44vw, calc(86vw - 35px)';
