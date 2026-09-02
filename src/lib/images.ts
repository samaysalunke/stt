/**
 * Local fallbacks for content that has no image of its own.
 *
 * These used to be hardcoded Unsplash URLs repeated across nine call sites. A
 * hotlinked third-party photo is a bad default anywhere, but it is a real
 * problem in the places these flow into: `Event.image` in JSON-LD, the OG
 * image, and the Twitter card. If Unsplash moves or removes the photo, the
 * rich result degrades and the social card breaks on a page we control.
 *
 * Keep every fallback here so a replacement is one edit, not nine.
 */

/**
 * Hero/cover stand-in for a trip or page with no image set.
 *
 * TO REPLACE IT, SWAP THE FILE — no code change needed. It currently ships as a
 * copy of og-default.jpg, which is a brand card rather than a photograph and
 * reads poorly at 4:3 on a trip card. A real wide landscape photo dropped at
 * `public/images/fallback-hero.jpg` is the intended contents; the filename is
 * deliberately its own slot so that swap does not disturb the OG default.
 *
 * There is intentionally no gallery equivalent: a trip with no real
 * photographs shows no photo strip rather than stock images under a heading
 * that reads "From the trail. No filters, no staging."
 */
export const FALLBACK_HERO = '/images/fallback-hero.jpg';
