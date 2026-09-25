import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { imageSrcset, IMAGE_VARIANT_WIDTHS } from '../../src/lib/imageVariants';

describe('imageSrcset', () => {
  it('declines anything the route does not serve, so no dead candidate is advertised', () => {
    // A trip cover may be an absolute third-party URL, and only /images/ goes
    // through src/pages/images/[...path].ts.
    expect(imageSrcset('https://images.unsplash.com/photo-1506905925346')).toBeUndefined();
    expect(imageSrcset('/logo.jpg')).toBeUndefined();
    expect(imageSrcset('')).toBeUndefined();
    expect(imageSrcset(null)).toBeUndefined();
    expect(imageSrcset(undefined)).toBeUndefined();
  });

  it('emits no width the route would refuse to resize', () => {
    // Drifting apart degrades silently: a width the route does not allow is
    // served at full size, so the page still renders and only gets slower.
    // The check is one-directional on purpose. The route is allowed to accept
    // widths this list no longer emits — retired rungs stay accepted so that
    // edge-cached HTML referencing them keeps getting a resized image — but a
    // width we advertise and the route rejects is always a bug.
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/pages/images/[...path].ts'),
      'utf8'
    );
    const declared = route.match(/const ALLOWED_WIDTHS = new Set\(\[([^\]]+)\]\)/);
    expect(declared, 'ALLOWED_WIDTHS not found in the image route').not.toBeNull();
    const allowed = new Set(declared![1].split(',').map((n) => Number(n.trim())));
    const unserveable = IMAGE_VARIANT_WIDTHS.filter((w) => !allowed.has(w));
    expect(unserveable, 'advertised widths the image route will not resize').toEqual([]);
  });
});
