import { describe, expect, it } from 'vitest';
import { renderSafeMarkdown } from '../../src/lib/safeMarkdown';

describe('safe Markdown rendering', () => {
  it('renders the trip editor formatting set', () => {
    const html = renderSafeMarkdown('## Heading\n\nA **bold** and *italic* [link](/trips/).\n\n- One\n- Two\n\n1. First\n2. Second');
    expect(html).toContain('<h2>Heading</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<a href="/trips/">link</a>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
  });

  it('escapes raw HTML and blocks script execution', () => {
    const html = renderSafeMarkdown('<script>window.compromised = true</script>\n\n<strong>not raw HTML</strong>');
    expect(html).toContain('&lt;script&gt;window.compromised = true&lt;/script&gt;');
    expect(html).toContain('&lt;strong&gt;not raw HTML&lt;/strong&gt;');
    expect(html).not.toContain('<script>');
  });

  it('opens external links safely but leaves relative links in place', () => {
    const html = renderSafeMarkdown('[External](https://example.com) [Internal](/trips/)');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">External</a>');
    expect(html).toContain('<a href="/trips/">Internal</a>');
  });
});
