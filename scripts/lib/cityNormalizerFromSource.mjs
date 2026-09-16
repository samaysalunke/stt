/**
 * `normalizeIndiaCity`, rebuilt for plain-node scripts.
 *
 * The library is TypeScript and the migration scripts are plain .mjs, so they
 * cannot import it. Rather than a second hand-written copy that drifts — which
 * is exactly what happened: the trailing-state rule landed in the library and
 * the migration quietly kept matching without it — this reads the tables out of
 * the same source files and reproduces the same steps in the same order.
 *
 * tests/unit/cityNormalizerParity.test.ts runs both over a corpus of the values
 * this column has actually held and fails if they ever disagree.
 *
 * Side-effect free: importing this opens no database.
 */
import fs from 'node:fs';
import path from 'node:path';

const read = (root, file) => fs.readFileSync(path.join(root, 'src', 'lib', file), 'utf8');

function between(text, from, to) {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a);
  if (a === -1 || b === -1) throw new Error(`could not locate ${from} .. ${to}`);
  return text.slice(a, b);
}

const listOf = (block) => [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const mapOf = (block) => Object.fromEntries([...block.matchAll(/([a-zA-Z]+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));

export function buildCityNormalizer(root = process.cwd()) {
  const citiesSrc = read(root, 'indiaCities.ts');
  const statesSrc = read(root, 'indiaStates.ts');

  const CITIES = listOf(between(citiesSrc, 'INDIA_CITIES: string[] = [', '];'));
  const CITY_ALIASES = mapOf(between(citiesSrc, 'const CITY_ALIASES', 'const squashCity'));
  const STATES = listOf(between(statesSrc, 'INDIA_STATES: string[] = [', '];'));
  const STATE_ALIASES = mapOf(between(statesSrc, 'const STATE_ALIASES', 'const squash'));

  // If a rename ever breaks the parsing, stop rather than normalise everything
  // against an empty list — that would blank the column.
  if (CITIES.length < 50 || Object.keys(CITY_ALIASES).length < 20 || STATES.length < 30) {
    throw new Error(`refusing to run: parsed ${CITIES.length} cities, ${Object.keys(CITY_ALIASES).length} aliases, ${STATES.length} states`);
  }

  const squash = (v) => String(v ?? '').toLowerCase().replace(/[^a-z]/g, '');

  const normalizeState = (value) => {
    const key = squash(value);
    if (!key) return null;
    return STATES.find((s) => squash(s) === key) ?? STATE_ALIASES[key] ?? null;
  };

  const lookup = (text) => {
    const key = squash(text);
    if (!key) return null;
    return CITIES.find((c) => squash(c) === key) ?? CITY_ALIASES[key] ?? null;
  };

  const withoutTrailingState = (raw) => {
    const punctuated = raw.match(/^(.+?)\s*[,(/]\s*([^,()/]+?)\)?\s*$/);
    if (punctuated && normalizeState(punctuated[2])) return punctuated[1].trim();
    const words = raw.split(/\s+/);
    for (let i = words.length - 1; i >= 1; i--) {
      if (normalizeState(words.slice(i).join(' '))) return words.slice(0, i).join(' ');
    }
    return null;
  };

  return function normalizeIndiaCity(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (!squash(raw)) return raw;

    const direct = lookup(raw);
    if (direct) return direct;

    const trimmed = withoutTrailingState(raw);
    if (trimmed) {
      const resolved = lookup(trimmed);
      if (resolved) return resolved;
    }
    return raw;
  };
}
