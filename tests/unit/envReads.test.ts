import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Secrets must reach server code through process.env only.
 *
 * Astro 6+ rewrites `import.meta.env` at build time, and Railway exposes every
 * service variable to the build. Astro 7's plugin
 * (astro/dist/env/vite-plugin-import-meta-env.js) does two things:
 *
 *  1. `import.meta.env.<KEY>` for a private key is replaced by its value.
 *  2. If the file's source text — comments included — contains `import.meta.env`
 *     not followed by `.`, every `import.meta.env` in the file becomes an object
 *     literal holding each private env var whose NAME appears anywhere in the
 *     file as a substring. `(import.meta as any).env?.[name]` counts once
 *     TypeScript drops the cast.
 *
 * Rule 2 is how ANALYTICS_LLM_API_KEY reached dist/server/ during the upgrade:
 * src/lib/analytics/llm.ts read `(import.meta as any).env?.[name]` and named
 * the keys. A comment in contentCache.ts tripped it too, inlining `_` (the
 * build machine's path to the astro binary).
 *
 * So, over the whole text: only static reads of Astro's public keys.
 */
const PUBLIC_KEYS = 'PROD|DEV|MODE|SSR|BASE_URL|SITE|ASSETS_PREFIX';
const RULES: Array<[string, RegExp]> = [
  ['private key read from import.meta.env', new RegExp(`import\\.meta\\.env\\.(?!(?:${PUBLIC_KEYS})\\b)`, 'g')],
  ['bare import.meta.env (object form)', /\bimport\.meta\.env\b(?!\.)/g],
  ['import.meta.env behind a cast', /\(\s*import\.meta\s+as\s+\w+\s*\)\s*\.\s*env\b/g],
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mts|js|mjs|astro)$/.test(entry.name) ? [full] : [];
  });
}

describe('env reads', () => {
  it('reads import.meta.env only as a static public key, anywhere in the text', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      const text = fs.readFileSync(file, 'utf8');
      for (const [rule, re] of RULES) {
        for (const match of text.matchAll(re)) {
          const line = text.slice(0, match.index).split('\n').length;
          offenders.push(`${file}:${line}: ${rule}: ${text.split('\n')[line - 1].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
