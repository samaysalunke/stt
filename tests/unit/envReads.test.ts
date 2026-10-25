import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Secrets must reach server code through process.env only.
 *
 * Astro 6+ inlines `import.meta.env` at build time, and Railway exposes service
 * variables to the build. A static read of a public key (`import.meta.env.DEV`)
 * compiles to a literal and carries nothing else. Any other shape —
 * `import.meta.env.SECRET`, `(import.meta as any).env?.[name]`, passing
 * `import.meta.env` around — is compiled to an object literal holding the
 * values of every env var the module names, which is how
 * ANALYTICS_LLM_API_KEY ended up in dist/server/ during the Astro 7 upgrade.
 */
const ALLOWED = /^import\.meta\.env\.(PROD|DEV|MODE|SSR|BASE_URL|SITE)\b/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mts|js|mjs|astro)$/.test(entry.name) ? [full] : [];
  });
}

describe('env reads', () => {
  it('reads import.meta.env only as a static public key', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/*')) return;
        for (const match of code.matchAll(/import\.meta\b/g)) {
          if (!ALLOWED.test(code.slice(match.index))) offenders.push(`${file}:${i + 1}: ${code}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
