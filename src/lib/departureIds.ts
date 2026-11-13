import { listTripSlugs, readTrip } from './trips';

/**
 * Departure ids are a global key: registrations, the admin registrations view
 * (grouped by batch_id alone), trip-lead permissions and booking URLs all look
 * a departure up by its id without the trip slug. Two trips sharing an id mix
 * their travellers. The editor derives ids from the start date and "duplicate"
 * used to copy them verbatim, so collisions were easy to make.
 */

/** Every departure id used by a trip file on disk, soft-deleted ones included. */
export function departureIdsInUse(excludeSlug?: string): Set<string> {
  const ids = new Set<string>();
  for (const slug of listTripSlugs()) {
    if (slug === excludeSlug) continue;
    const trip = readTrip(slug);
    for (const b of Array.isArray(trip?.batches) ? trip!.batches : []) {
      if (b?.id) ids.add(String(b.id));
    }
  }
  return ids;
}

/**
 * Give each departure an id no other trip uses. Ids in `keep` are left alone:
 * those departures already exist and may have registrations pointing at them.
 * Anything else that collides is re-keyed to `<slug>-<startDate>` (then -2, -3…).
 * Pure; returns new objects.
 */
export function uniqueDepartureIds<T extends { id?: unknown; startDate?: unknown }>(
  batches: T[],
  opts: { slug: string; taken: Set<string>; keep?: Set<string> },
): T[] {
  const used = new Set(opts.taken);
  const keep = opts.keep ?? new Set<string>();
  return batches.map((b) => {
    const id = String(b.id ?? '');
    if (id && (keep.has(id) || !used.has(id))) {
      used.add(id);
      return b;
    }
    const date = String(b.startDate ?? '').slice(0, 10);
    const base = date ? `${opts.slug}-${date}` : `${opts.slug}-departure`;
    let next = base;
    for (let n = 2; used.has(next); n++) next = `${base}-${n}`;
    used.add(next);
    return { ...b, id: next };
  });
}
