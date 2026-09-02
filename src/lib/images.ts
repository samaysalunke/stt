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

/** Hero/cover stand-in for a trip or page with no image set. */
export const FALLBACK_HERO = '/images/og-default.jpg';

/** Gallery stand-ins for a trip with no photos and no linked album. */
export const FALLBACK_PHOTOS: readonly string[] = [FALLBACK_HERO];
