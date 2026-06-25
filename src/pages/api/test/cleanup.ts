// Test-only endpoint — wipes registrations for a given batchId+tierId back to 'pending'.
// Active only in dev builds OR when ENABLE_TEST_ENDPOINTS=true (test harness).
// Never gate destructive/PII test routes on the rate-limit kill switch.
import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findTripByName, readTrip, writeTrip } from '../../../lib/content';
import { testEndpointsEnabled } from '../../../lib/testGuard';

export const POST: APIRoute = async ({ request }) => {
  if (!testEndpointsEnabled()) {
    return new Response(JSON.stringify({ error: 'Not available' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    });
  }
  const body = await request.json();
  const batchId: string = body.batchId;
  const tierId: string = body.tierId;
  const tripTitle: string = body.tripTitle;

  if (!batchId || !tierId) {
    return new Response(JSON.stringify({ error: 'batchId and tierId required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }

  // Delete ALL test registrations for this batch+tier (emails end in @example.invalid).
  // This ensures the confirmed count is 0 before capacity tests run.
  const db = getDb();
  db.prepare(
    "DELETE FROM registrations WHERE batch_id=? AND tier_id=? AND email LIKE '%@example.invalid'"
  ).run(batchId, tierId);

  // Also reset offer.booked in YAML to 0
  try {
    const matched = findTripByName(tripTitle);
    if (matched) {
      const tripData = readTrip(matched.slug);
      if (tripData) {
        const batches = Array.isArray(tripData.batches) ? tripData.batches : [];
        const batch = batches.find((b: any) => b.id === batchId);
        if (batch) {
          batch.bookedSpots = 0;
          if (Array.isArray(batch.offers)) {
            const offer = batch.offers.find((o: any) => o.tierId === tierId);
            if (offer) offer.booked = 0;
          }
          writeTrip(matched.slug, tripData);
        }
      }
    }
  } catch { /* non-fatal */ }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
};
