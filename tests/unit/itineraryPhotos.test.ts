import { describe, it, expect } from 'vitest';
import { normalizeItineraryPhotos } from '../../src/lib/trips';

describe('normalizeItineraryPhotos', () => {
  it('keeps valid /images photos and coerces dimensions', () => {
    const itin = [{ day: 1, photos: [
      { image: '/images/trips/x/a.webp', width: 800, height: 600 },
      { image: '/images/trips/x/b.webp' },
    ] }];
    normalizeItineraryPhotos(itin);
    expect(itin[0].photos).toEqual([
      { image: '/images/trips/x/a.webp', width: 800, height: 600 },
      { image: '/images/trips/x/b.webp', width: null, height: null },
    ]);
  });

  it('caps at 3 per day', () => {
    const itin = [{ day: 1, photos: Array.from({ length: 5 }, (_, i) => ({ image: `/images/trips/x/${i}.webp` })) }];
    normalizeItineraryPhotos(itin);
    expect(itin[0].photos).toHaveLength(3);
  });

  it('drops non-/images URLs (external, javascript:)', () => {
    const itin = [{ day: 1, photos: [
      { image: 'https://evil.example/x.jpg' },
      { image: 'javascript:alert(1)' },
      { image: '/images/trips/x/ok.webp' },
    ] }];
    normalizeItineraryPhotos(itin);
    expect(itin[0].photos).toEqual([{ image: '/images/trips/x/ok.webp', width: null, height: null }]);
  });

  it('removes the photos key when nothing valid remains', () => {
    const itin: any[] = [{ day: 1, photos: [{ image: 'https://evil/x' }] }];
    normalizeItineraryPhotos(itin);
    expect('photos' in itin[0]).toBe(false);
  });

  it('leaves a day with no photos key untouched', () => {
    const itin: any[] = [{ day: 1, title: 'x' }];
    normalizeItineraryPhotos(itin);
    expect(itin[0]).toEqual({ day: 1, title: 'x' });
  });

  it('is a no-op for non-arrays', () => {
    expect(() => normalizeItineraryPhotos(undefined)).not.toThrow();
    expect(() => normalizeItineraryPhotos(null)).not.toThrow();
  });
});
