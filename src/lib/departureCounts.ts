// Live per-departure counts from confirmed registrations, for the public
// "Only N spots left" and "N women already booked" lines.
//
// Both lines read the same rows so they can never disagree with each other.
// Confirmed only: a confirm/cancel already purges `/`, `/trips/` and the trip
// page (registrationStatusChange.ts), so these stay fresh at the edge; a
// pending registration purges nothing and would go stale.

import { getDb } from './db';
import { genderBucket } from './occupancyMatrix';
import { liveSpotsLeft } from './urgency';

export type DepartureCounts = { confirmed: number; women: number };

export const departureKey = (slug: string, batchId: string) => `${slug}::${batchId}`;

/** Pure fold of registration rows into per-departure counts — safe to test. */
export function tallyConfirmed(
  rows: Array<{ trip_slug: unknown; batch_id: unknown; gender: unknown }>,
): Map<string, DepartureCounts> {
  const out = new Map<string, DepartureCounts>();
  for (const r of rows) {
    const key = departureKey(String(r.trip_slug), String(r.batch_id));
    const e = out.get(key) ?? { confirmed: 0, women: 0 };
    e.confirmed += 1;
    if (genderBucket(r.gender) === 'female') e.women += 1;
    out.set(key, e);
  }
  return out;
}

/**
 * One query for any number of departures. Filters on batch_id so it stays on
 * the registrations_batch_id index; the key still includes the slug in case
 * two trips reuse a batch id.
 */
export function confirmedCountsByBatch(
  pairs: Array<{ slug: string; batchId: string }>,
): Map<string, DepartureCounts> {
  const batchIds = [...new Set(pairs.map((p) => p.batchId))];
  if (batchIds.length === 0) return new Map();
  const rows = getDb().prepare(`
    SELECT trip_slug, batch_id, gender
      FROM registrations
     WHERE status = 'confirmed' AND batch_id IN (${batchIds.map(() => '?').join(',')})
  `).all(...batchIds) as Array<{ trip_slug: string; batch_id: string; gender: string | null }>;
  return tallyConfirmed(rows);
}

/**
 * Live spots left on each card's soonest bookable departure, keyed by trip
 * slug — one query for the whole grid. Null when the trip has no open,
 * capped departure.
 */
export function cardLiveSpots(
  cards: Array<{ slug: string; nextOpenBatchId: string | null; nextOpenTotalCap: number | null }>,
): Map<string, number | null> {
  const open = cards.filter((c) => c.nextOpenBatchId != null && c.nextOpenTotalCap != null);
  const counts = confirmedCountsByBatch(open.map((c) => ({ slug: c.slug, batchId: c.nextOpenBatchId! })));
  const out = new Map<string, number | null>();
  for (const c of cards) {
    out.set(c.slug, c.nextOpenBatchId == null
      ? null
      : liveSpotsLeft(c.nextOpenTotalCap, counts.get(departureKey(c.slug, c.nextOpenBatchId))?.confirmed ?? 0));
  }
  return out;
}
