/**
 * In-process cache for the YAML content loaders.
 *
 * Every public render currently re-reads the whole content corpus from disk —
 * `readSiteSettings()` alone runs 2-3x per page (BaseLayout + Footer + the page
 * itself). The corpus is small, so this is not the headline win; it is cheap,
 * reversible, and cuts the cost of the origin renders that survive edge caching.
 *
 * TWO invalidation signals, deliberately not three:
 *
 *   1. A monotonic version counter, bumped inside every writer in src/lib.
 *      This is the authoritative signal — an admin edit is visible on the very
 *      next read, with no TTL wait.
 *   2. A 30s TTL, as the backstop for writes that bypass this process entirely.
 *      `scripts/reconcile-booked.mjs --apply` rewrites trip YAML from outside
 *      the app, so nothing bumps the counter for it.
 *
 * A content-directory mtime signal was considered and rejected: `writeFileSync`
 * to an existing path does not change the directory's mtime, so it would never
 * fire for the common case (editing an existing trip) and would be dead weight.
 *
 * FUTURE HAZARD — Keystatic. `keystatic.config.tsx` and its deps exist, but the
 * integration is not mounted (`astro.config.mjs` registers `react()` only, and
 * there is no `src/pages/keystatic/` route), so nothing writes through it today
 * and the `/keystatic` guards in middleware are dead paths. If it is ever
 * mounted, it writes YAML directly and will bypass every writer below — the
 * 30s TTL would then be the only thing saving it.
 */

import { getDb } from './db';

const TTL_MS = 30_000;
const VERSION_KEY = 'content_version';

/** Loader timing, shared flag with src/middleware.ts. */
const PERF_TIMING = process.env.PERF_TIMING === '1';

/**
 * `import.meta.env` is a Vite construct. Some tests import this module directly
 * under plain Node (the Playwright specs do), where it is undefined — so read
 * it defensively rather than assuming a bundler is present.
 */
const IS_DEV = (() => {
  try {
    return !!(import.meta as any).env?.DEV;
  } catch {
    return false;
  }
})();

interface Entry<T> {
  value: T;
  version: number;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

/**
 * Mirrors the persisted counter so the hot read path never touches SQLite.
 * `null` means "not yet loaded in this process" — the first read hydrates it.
 */
let versionCache: number | null = null;

export function getContentVersion(): number {
  if (versionCache !== null) return versionCache;
  try {
    const row = getDb()
      .prepare('SELECT value FROM app_meta WHERE key = ?')
      .get(VERSION_KEY) as { value: string } | undefined;
    versionCache = Number(row?.value ?? 0) || 0;
  } catch {
    // A DB that is unavailable must not take the site down; fall back to an
    // in-memory counter, where the TTL is still doing its job.
    versionCache = 0;
  }
  return versionCache;
}

/**
 * Invalidate every cached entry. Called from inside the content writers rather
 * than at their call sites, so any write path — including the booking one —
 * invalidates without the endpoint having to remember to.
 *
 * Synchronous by design (better-sqlite3 is): `adjustBookingCount` transitively
 * reaches this through `writeTrip`, and its ATOMICITY INVARIANT requires the
 * whole read-modify-write to complete in one tick.
 */
export function bumpContentVersion(): void {
  const next = getContentVersion() + 1;
  versionCache = next;
  try {
    getDb()
      .prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(VERSION_KEY, String(next));
  } catch {
    /* best-effort: the in-memory bump above already invalidated this process */
  }
}

/**
 * Deep-freeze in dev only, so an accidental in-place mutation of cached content
 * throws at the mutation site instead of silently corrupting every later reader.
 * Not done in production — the walk is not free and the contract is the same.
 */
function deepFreeze<T>(value: T, seen = new Set<unknown>()): T {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

/**
 * Cache a pure content read.
 *
 * CONTRACT: the returned value is SHARED and must be treated as read-only.
 * A loader whose result gets mutated in place must not be wrapped — see the
 * `readTrip` exclusion in src/lib/trips.ts.
 */
export function cachedRead<T>(key: string, loader: () => T): T {
  const version = getContentVersion();
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;

  if (hit && hit.version === version && hit.expiresAt > now) return hit.value;

  const startedAt = PERF_TIMING ? performance.now() : 0;
  let value = loader();
  if (IS_DEV) value = deepFreeze(value);
  if (PERF_TIMING) {
    console.log(`[perf] load ${key} ${(performance.now() - startedAt).toFixed(2)}ms`);
  }

  store.set(key, { value, version, expiresAt: now + TTL_MS });
  return value;
}

/** Test seam: drop every entry without touching the persisted version. */
export function clearContentCache(): void {
  store.clear();
}

/** Test seam: the keys currently registered with the cache. */
export function cachedKeys(): string[] {
  return [...store.keys()];
}
