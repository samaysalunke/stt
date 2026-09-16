import { describe, it, expect } from 'vitest';
import { readFileSync, globSync } from 'node:fs';

/* A `<script>` Astro ships verbatim must be plain JavaScript.
 *
 * `define:vars` implies `is:inline`, and an inline script is emitted into the
 * HTML exactly as written — no TypeScript stripping, no bundling, no esbuild.
 * So a single type annotation is not a compile error, it is a SyntaxError in
 * the browser that kills the ENTIRE block at parse time. Nothing reports it:
 * the build succeeds, the page renders, the unit suite passes, and the feature
 * is simply dead.
 *
 * That is exactly how `admin/registrations.astro` shipped with
 * `getElementById('show-history') as HTMLInputElement | null`. The Show history
 * toggle did nothing, and the Export CSV link silently lost its batch filter
 * and exported every registration instead of the visible departures — one
 * annotation, two broken features, no error anywhere.
 *
 * A `<script>` WITHOUT those directives is processed by Astro and may use
 * TypeScript freely; those are skipped here.
 */

/** Every `<script` opening tag, self-closing or not. */
const SCRIPT_TAG = /<script\b([^>]*?)(\/)?>/g;

interface InlineScript {
  file: string;
  line: number;
  attrs: string;
  body: string;
}

function verbatimScripts(file: string): InlineScript[] {
  const source = readFileSync(file, 'utf8');
  const found: InlineScript[] = [];
  for (const match of source.matchAll(SCRIPT_TAG)) {
    const [tag, attrs, selfClosing] = match;
    // Three shapes carry no literal JavaScript body to check:
    //   `<script ... />`  — self-closing, no body at all
    //   `set:html={...}`  — the body is generated at render time, not written here
    //   `type="application/ld+json"` and friends — a data block, not script
    // The JSON-LD tags in each page's <Fragment slot="head"> are all three at
    // once, and matching them swallowed everything up to the next </script>.
    if (selfClosing) continue;
    if (attrs.includes('set:html')) continue;
    const type = attrs.match(/type=["']([^"']+)["']/)?.[1];
    if (type && !/^(module|text\/javascript|application\/javascript)$/.test(type)) continue;
    // A script without these is processed by Astro and may use TypeScript.
    if (!attrs.includes('define:vars') && !attrs.includes('is:inline')) continue;

    const bodyStart = match.index + tag.length;
    const bodyEnd = source.indexOf('</script>', bodyStart);
    if (bodyEnd === -1) continue;
    found.push({
      file,
      line: source.slice(0, match.index).split('\n').length,
      attrs,
      body: source.slice(bodyStart, bodyEnd),
    });
  }
  return found;
}

/**
 * Parse without executing. `new Function` compiles the body under the same
 * grammar a classic inline script gets, which is the actual question — pattern
 * matching for `as Foo` would both miss syntax it has not met and fire on the
 * string `"as HTMLElement"` inside a template. Undeclared identifiers (the ones
 * `define:vars` injects above the body) are a runtime concern, not a parse one,
 * so they do not matter here.
 */
function parseError(script: InlineScript): string | null {
  // `type="module"` permits import/export, which `new Function` rejects. No
  // such script exists today; skip rather than report a false failure if one
  // is added later.
  if (/type=["']module["']/.test(script.attrs)) return null;
  try {
    new Function(script.body);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('inline <script> blocks are plain JavaScript', () => {
  const files = globSync('src/**/*.astro').sort();

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  const scripts = files.flatMap(verbatimScripts);

  it('finds the inline scripts to check', () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it('every verbatim-shipped script parses as browser JavaScript', () => {
    const broken = scripts
      .map((script) => ({ script, error: parseError(script) }))
      .filter((r) => r.error)
      .map((r) => `${r.script.file}:${r.script.line} — ${r.error}`);

    expect(broken, `TypeScript (or other invalid syntax) in a script Astro ships verbatim:\n${broken.join('\n')}`).toEqual([]);
  });
});
