/**
 * Which departure a registration belongs to.
 *
 * A departure is a YAML batch, and batch ids are NOT unique across trips: a
 * duplicated trip used to keep its source's ids, and a departure saved without
 * an id falls back to its start date. So a departure is only ever identified by
 * the (trip slug, batch id) pair, and every reader that groups or counts
 * registrations has to place them through this one ladder. A second copy would
 * let two screens disagree about whose booking a row is.
 *
 * Pure: the alias lookup is injected so this has no database dependency.
 */

export function departureKey(tripSlug: string, batchId: string): string {
  // NUL separator: it cannot appear in a slug or a batch id.
  return `${tripSlug}\u0000${batchId}`;
}

export interface DepartureIndex {
  knownKeys: Set<string>;
  keyByBatch: Map<string, string[]>;
}

export function buildDepartureIndex(
  departures: Array<{ tripSlug: string; batchId: string }>,
): DepartureIndex {
  const knownKeys = new Set<string>();
  const keyByBatch = new Map<string, string[]>();
  for (const d of departures) {
    const key = departureKey(d.tripSlug, d.batchId);
    if (knownKeys.has(key)) continue;
    knownKeys.add(key);
    const list = keyByBatch.get(d.batchId) ?? [];
    list.push(key);
    keyByBatch.set(d.batchId, list);
  }
  return { knownKeys, keyByBatch };
}

/** Old slug -> current slug, or null when `slug` is not an alias. */
export type AliasResolver = (slug: string) => string | null;

/** Wrap a resolver so each distinct slug costs one lookup. */
export function memoAlias(resolve: AliasResolver): AliasResolver {
  const seen = new Map<string, string | null>();
  return (slug) => {
    if (!seen.has(slug)) seen.set(slug, resolve(slug));
    return seen.get(slug) ?? null;
  };
}

/** The departure key a registration belongs to, or null when it cannot be placed. */
export function placeDeparture(
  index: DepartureIndex,
  tripSlug: unknown,
  batchId: unknown,
  resolveAlias: AliasResolver,
): string | null {
  const batch = String(batchId ?? '').trim();
  if (!batch) return null;
  const rawSlug = String(tripSlug ?? '').trim();
  // A renamed trip leaves its registrations on the old slug forever
  // (api/admin/trips/update.ts records an alias but never rewrites them).
  const slug = rawSlug ? (resolveAlias(rawSlug) ?? rawSlug) : '';
  const composite = slug ? departureKey(slug, batch) : '';
  if (composite && index.knownKeys.has(composite)) return composite;
  // No slug (legacy) or the slug no longer names a trip: fall back to the batch
  // id, but only when it identifies exactly one departure — otherwise two trips
  // sharing a batch id would pool each other's bookings.
  const candidates = index.keyByBatch.get(batch) ?? [];
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Does a confirmed row on this batch hold a seat on `tripSlug`'s departure?
 *
 * Deliberately lopsided: a row is excluded only when it provably belongs to a
 * DIFFERENT live departure. A row that cannot be placed anywhere still counts,
 * because miscounting upward refuses a booking an admin can override, while
 * miscounting downward silently oversells a room.
 */
export function holdsSeatOn(
  index: DepartureIndex,
  tripSlug: string,
  batchId: string,
  rowTripSlug: unknown,
  resolveAlias: AliasResolver,
): boolean {
  const placed = placeDeparture(index, rowTripSlug, batchId, resolveAlias);
  return placed === null || placed === departureKey(tripSlug, batchId);
}
