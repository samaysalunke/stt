import { getDb } from './db';

/**
 * Old→current trip slug map. When a live trip is renamed the old slug is kept
 * here so shared links, search results and bookmarks 301 to the new URL instead
 * of 404ing. Lives on the DATA_DIR volume (see db.ts) so it survives deploys.
 */

const MAX_CHAIN = 16;

/**
 * Record that `oldSlug` now points at `newSlug`. Safe to call repeatedly.
 * Collapses existing chains so lookups stay O(1), and guarantees the new
 * (canonical) slug is never itself an alias.
 */
export function recordTripSlugAlias(oldSlug: string, newSlug: string): void {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  const db = getDb();
  const tx = db.transaction(() => {
    // The new slug is a real trip now — it must not shadow-redirect anywhere.
    db.prepare('DELETE FROM trip_slug_aliases WHERE alias = ?').run(newSlug);
    // Anything that used to resolve to the old slug now resolves straight to new.
    db.prepare('UPDATE trip_slug_aliases SET target = ? WHERE target = ?').run(newSlug, oldSlug);
    // The old slug redirects to the new one.
    db.prepare(`
      INSERT INTO trip_slug_aliases (alias, target) VALUES (?, ?)
      ON CONFLICT(alias) DO UPDATE SET target = excluded.target, createdAt = unixepoch()
    `).run(oldSlug, newSlug);
  });
  tx();
}

/**
 * Follow the alias chain from `slug` to the current slug. Returns null when
 * `slug` is not an alias (or the chain is circular / too long).
 */
export function resolveTripSlugAlias(slug: string): string | null {
  if (!slug) return null;
  const stmt = getDb().prepare('SELECT target FROM trip_slug_aliases WHERE alias = ?');
  const seen = new Set<string>([slug]);
  let current = slug;
  for (let i = 0; i < MAX_CHAIN; i++) {
    const row = stmt.get(current) as { target: string } | undefined;
    if (!row) break;
    current = row.target;
    if (seen.has(current)) return null; // cycle — refuse to redirect
    seen.add(current);
  }
  return current === slug ? null : current;
}

/** Drop any alias occupying `slug` (e.g. a new trip is created at that slug). */
export function clearTripSlugAlias(slug: string): void {
  if (!slug) return;
  getDb().prepare('DELETE FROM trip_slug_aliases WHERE alias = ?').run(slug);
}
