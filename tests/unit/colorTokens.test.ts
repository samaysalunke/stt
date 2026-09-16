import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join } from 'node:path';

/* Colour lives in `src/styles/tokens.css` and nowhere else.
 *
 * This rule is not stylistic. Every accessibility retune the project has made —
 * the CTA fill, the body grey, the text-safe coral — was applied to the token
 * and then silently missed by the call sites that had copied its hex. The
 * booking flow shipped the pre-retune #D95F3B on every CTA for exactly that
 * reason, and the mail templates shipped the pre-retune #6B7280 body grey.
 *
 * So: no bare hex outside the files below. Plain white and black are fine.
 */
const ALLOWED: Record<string, string> = {
  'src/styles/tokens.css': 'the palette itself',
  'src/styles/fonts.css': 'no colours, but exempt for symmetry',
  'src/lib/emailPalette.ts':
    'mail clients strip custom properties, so email needs literal hex; this file is the single source',
  'src/pages/admin/analytics.astro':
    'a deliberate WhatsApp-lookalike skin, documented in place — not brand colour',
  'src/pages/login.astro': "Google's logo mark; brand SVG path fills must be exact",
  'src/pages/admin/login.astro': "Google's logo mark; brand SVG path fills must be exact",
};

const NEUTRAL = new Set(['#fff', '#ffffff', '#000', '#000000']);
// `#[0-9a-f]{3,6}` also matches a CSS id selector like `#add-day-btn`, so a hex
// must not be followed by another name character.
const HEX = /#[0-9A-Fa-f]{6}(?![0-9A-Za-z-])|#[0-9A-Fa-f]{3}(?![0-9A-Za-z-])/g;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('colour tokens', () => {
  const files = globSync('src/**/*.{astro,tsx,ts,css}').sort();

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('has no bare hex colours outside tokens.css', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.split('\\').join('/');
      if (ALLOWED[rel]) continue;
      const found = (stripComments(readFileSync(join(process.cwd(), file), 'utf8')).match(HEX) ?? [])
        .filter((h) => !NEUTRAL.has(h.toLowerCase()));
      if (found.length) offenders.push(`${rel}: ${[...new Set(found)].join(', ')}`);
    }
    expect(offenders, `use a var(--color-*) token from src/styles/tokens.css instead:\n${offenders.join('\n')}`)
      .toEqual([]);
  });

  it('keeps the email palette in sync with the tokens it mirrors', () => {
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    const palette = readFileSync('src/lib/emailPalette.ts', 'utf8');
    const drift: string[] = [];
    for (const [, name, hex] of palette.matchAll(/export const (\w+) = '(#[0-9A-Fa-f]{6})'/g)) {
      // Each constant documents the token it mirrors in the comment above it.
      const token = palette.slice(0, palette.indexOf(`export const ${name} `)).match(/--color-[\w-]+(?![\s\S]*--color-)/)?.[0];
      if (!token) continue;
      const actual = tokens.match(new RegExp(`${token}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
      if (actual && actual.toLowerCase() !== hex.toLowerCase()) drift.push(`${name} is ${hex}, ${token} is ${actual}`);
    }
    expect(drift, `email palette has drifted from tokens.css:\n${drift.join('\n')}`).toEqual([]);
  });
});
