import { describe, expect, it } from 'vitest';
import { selectFeaturedTestimonials } from '../../src/lib/testimonials';

describe('selectFeaturedTestimonials', () => {
  it('keeps source order, includes only explicitly featured items, and caps at four', () => {
    const testimonials = [
      { name: 'One', featured: true },
      { name: 'Two', featured: false },
      { name: 'Three', featured: true },
      { name: 'Four', featured: true },
      { name: 'Five' },
      { name: 'Six', featured: true },
      { name: 'Seven', featured: true },
    ];

    expect(selectFeaturedTestimonials(testimonials).map(t => t.name)).toEqual(['One', 'Three', 'Four', 'Six']);
  });

  it('returns an empty collection when none are featured', () => {
    expect(selectFeaturedTestimonials([{ featured: false }, {}])).toEqual([]);
  });
});
