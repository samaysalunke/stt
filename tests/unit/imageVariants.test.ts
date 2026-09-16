import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { imageSrcset, IMAGE_VARIANT_WIDTHS } from '../../src/lib/imageVariants';

describe('imageSrcset', () => {
  it('offers every variant width for an image the resizing route serves', () => {
    expect(imageSrcset('/images/trips/a-featured.webp')).toBe(
      '/images/trips/a-featured.webp?w=480 480w, /images/trips/a-featured.webp?w=720 720w, ' +
        '/images/trips/a-featured.webp?w=1080 1080w, /images/trips/a-featured.webp?w=1440 1440w'
    );
  });

  it('declines anything the route does not serve, so no dead candidate is advertised', () => {
    // A trip cover may be an absolute third-party URL, and only /images/ goes
    // through src/pages/images/[...path].ts.
    expect(imageSrcset('https://images.unsplash.com/photo-1506905925346')).toBeUndefined();
    expect(imageSrcset('/logo.jpg')).toBeUndefined();
    expect(imageSrcset('')).toBeUndefined();
    expect(imageSrcset(null)).toBeUndefined();
    expect(imageSrcset(undefined)).toBeUndefined();
  });

  it('keeps its widths in step with the route allowlist', () => {
    // These two lists drifting apart degrades silently: an unlisted width is
    // served at full size, so the page still renders and only gets slower.
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/pages/images/[...path].ts'),
      'utf8'
    );
    const declared = route.match(/const ALLOWED_WIDTHS = new Set\(\[([^\]]+)\]\)/);
    expect(declared, 'ALLOWED_WIDTHS not found in the image route').not.toBeNull();
    const allowed = declared![1].split(',').map((n) => Number(n.trim()));
    expect(allowed).toEqual([...IMAGE_VARIANT_WIDTHS]);
  });
});
