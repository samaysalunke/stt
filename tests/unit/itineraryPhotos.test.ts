import { describe, it, expect } from 'vitest';
import { normalizeItineraryPhotos } from '../../src/lib/trips';

describe('normalizeItineraryPhotos', () => {
  it('drops non-/images URLs (external, javascript:)', () => {
    const itin = [{ day: 1, photos: [
      { image: 'https://evil.example/x.jpg' },
      { image: 'javascript:alert(1)' },
      { image: '/images/trips/x/ok.webp' },
    ] }];
    normalizeItineraryPhotos(itin);
    expect(itin[0].photos).toEqual([{ image: '/images/trips/x/ok.webp', width: null, height: null }]);
  });
});
