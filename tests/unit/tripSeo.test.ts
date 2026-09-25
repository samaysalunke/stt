import { describe, expect, it } from 'vitest';
import { generateTripSeo, markdownToPlainText } from '../../src/lib/tripSeo';

describe('generateTripSeo', () => {
  it('does not repeat a location already present in the name', () => {
    const result = generateTripSeo({ name: 'Winter in Ladakh', location: 'Ladakh' });
    expect(result.seoTitle).toBe('Winter in Ladakh | Seek the Thrill');
    expect(result.imageAlt).toBe('Winter in Ladakh group trip');
  });

  it('keeps a complete itinerary-specific name instead of truncating an appended location', () => {
    const result = generateTripSeo({
      name: 'The Hidden Valleys and Living Root Bridges',
      location: 'Meghalaya and Assam',
    });
    expect(result.seoTitle).toBe('The Hidden Valleys and Living Root Bridges | Seek the Thrill');
    expect(result.seoTitle).not.toContain('…');
  });

  it('cleans markup and keeps generated fields within their metadata limits', () => {
    const result = generateTripSeo({
      name: '*A Very Long Journey Through the Mountains and Valleys of Northeast India*',
      location: 'Arunachal Pradesh',
      description: '<p>' + 'First-hand route details and practical advice. '.repeat(8) + '</p>',
    });
    expect(result.seoTitle.length).toBeLessThanOrEqual(70);
    expect(result.seoDescription.length).toBeLessThanOrEqual(170);
    expect(result.imageAlt.length).toBeLessThanOrEqual(180);
    expect(result.seoDescription).not.toContain('<p>');
  });

  it('removes rich Markdown syntax from search-facing text', () => {
    const markdown = '## Hidden valleys\n\nA **bold** and *quiet* [journey](https://example.com).\n\n- Waterfalls\n- Villages';
    expect(markdownToPlainText(markdown)).toBe('Hidden valleys A bold and quiet journey. Waterfalls Villages');
    expect(generateTripSeo({ name: 'A Trip', description: markdown }).seoDescription)
      .toBe('Hidden valleys A bold and quiet journey. Waterfalls Villages');
  });
});
