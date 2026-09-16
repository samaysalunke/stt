/**
 * Responsive variants for images served by src/pages/images/[...path].ts.
 *
 * The widths here MUST stay in sync with ALLOWED_WIDTHS in that route — a width
 * that isn't allowlisted is silently served at full size, so a mismatch shows
 * up as a performance regression rather than an error.
 *
 * Only paths under /images/ go through the resizing route. A trip cover can
 * also be an absolute third-party URL, and those are returned untouched so the
 * caller simply omits the attribute.
 */
export const IMAGE_VARIANT_WIDTHS = [480, 720, 1080, 1440] as const;

export function imageSrcset(src: string | null | undefined): string | undefined {
  if (!src || !src.startsWith('/images/')) return undefined;
  return IMAGE_VARIANT_WIDTHS.map((w) => `${src}?w=${w} ${w}w`).join(', ');
}
