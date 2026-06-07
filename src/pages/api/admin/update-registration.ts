import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { listTrips, readTrip, writeTrip } from '../../../lib/content';
import { sendRegistrationStatusConfirmed, sendRegistrationStatusRejected } from '../../../lib/email';

const VALID_STATUSES = ['pending', 'confirmed', 'rejected'];

/** The advance (paymentAmount) configured on the trip, used as the amount collected on confirm. */
function tripAdvanceAmount(tripName: string): number {
  try {
    const matched = listTrips().find((t: any) => t.name === tripName);
    if (!matched) return 0;
    const tripData = readTrip(matched.slug);
    const advance = tripData?.paymentAmount;
    return Number.isFinite(Number(advance)) ? Math.round(Number(advance)) : 0;
  } catch {
    return 0;
  }
}

/**
 * Adjust the booked count on the specific departure (batch) the booking is for.
 *
 * `bookedSpots` is an admin-maintained counter, NOT a pure derived value: it's
 * seeded/edited by hand in the trip editor (e.g. to reflect offline/phone
 * bookings) and confirm/un-confirm nudge it by ±1. So it must stay a stored
 * field — do not replace it with a live DB count.
 *
 * ATOMICITY INVARIANT — keep this function fully SYNCHRONOUS. Node is
 * single-threaded, so a synchronous read-modify-write (readTrip → mutate →
 * writeTrip) runs to completion in one tick and cannot interleave with another
 * confirmation. That is the only thing making concurrent confirms race-free.
 * Do NOT introduce `await` between the read and the write here (and never make
 * this `async`) — doing so reopens the lost-update race.
 */
function adjustBookingCount(tripName: string, batchId: string | null, delta: 1 | -1) {
  try {
    const matched = listTrips().find((t: any) => t.name === tripName);
    if (!matched) return;
    const tripData = readTrip(matched.slug);
    if (!tripData) return;

    const batches = Array.isArray(tripData.batches) ? tripData.batches : [];
    if (batches.length > 0 && batchId) {
      const b = batches.find((x: any) => x.id === batchId);
      if (b) {
        const cur = typeof b.bookedSpots === 'number' ? b.bookedSpots : 0;
        b.bookedSpots = Math.max(0, cur + delta);
        writeTrip(matched.slug, tripData);
        return;
      }
    }
    // Legacy fallback: trip-level counter (only for old trips without departures).
    const current = typeof tripData.currentBookings === 'number' ? tripData.currentBookings : 0;
    tripData.currentBookings = Math.max(0, current + delta);
    writeTrip(matched.slug, tripData);
  } catch (err) {
    console.error('[adjustBookingCount]', err);
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const id = parseInt(body.id);
    const newStatus = body.status?.toString();
    const adminNotes = body.admin_notes?.toString() ?? '';

    if (!id || !VALID_STATUSES.includes(newStatus)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid input.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fetch current state before updating
    const reg = getDb()
      .prepare('SELECT * FROM registrations WHERE id = ?')
      .get(id) as Record<string, any> | null;

    const prevStatus = reg?.status ?? 'pending';

    // Update DB
    getDb()
      .prepare(
        'UPDATE registrations SET status=?, admin_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      )
      .run(newStatus, adminNotes, id);

    // Side-effects only when status actually changes
    if (reg && newStatus !== prevStatus) {
      const tripName = reg.trip_name as string;

      // ── Booking count + revenue adjustment (on the booked departure) ──────
      const batchId = (reg.batch_id as string) ?? null;
      if (newStatus === 'confirmed' && prevStatus !== 'confirmed') {
        adjustBookingCount(tripName, batchId, 1);
        // Revenue: record the advance collected when the booking is confirmed.
        const advance = tripAdvanceAmount(tripName);
        getDb().prepare('UPDATE registrations SET amount_paid=? WHERE id=?').run(advance, id);
      } else if (prevStatus === 'confirmed' && newStatus !== 'confirmed') {
        adjustBookingCount(tripName, batchId, -1);
        // Reverse the recorded revenue when a confirmation is undone.
        getDb().prepare('UPDATE registrations SET amount_paid=0 WHERE id=?').run(id);
      }

      // ── Email notifications ───────────────────────────────────────────────
      if (newStatus === 'confirmed') {
        sendRegistrationStatusConfirmed({
          full_name: reg.full_name,
          email: reg.email,
          trip_name: tripName,
          trip_date: reg.trip_date ?? '',
        }).catch(err => console.error('[Email confirmed]', err));
      } else if (newStatus === 'rejected') {
        sendRegistrationStatusRejected({
          full_name: reg.full_name,
          email: reg.email,
          trip_name: tripName,
        }).catch(err => console.error('[Email rejected]', err));
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[update-registration]', err);
    return new Response(JSON.stringify({ success: false, error: 'Server error.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
