import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { listTrips, readTrip, writeTrip } from '../../../lib/content';
import { sendRegistrationStatusConfirmed, sendRegistrationStatusRejected } from '../../../lib/email';
import { logAction } from '../../../lib/audit';
import { recalculateUserLeaderboard } from '../../../lib/stats';

const VALID_STATUSES = ['lead', 'pending', 'confirmed', 'rejected'];

/** The advance (paymentAmount) configured on the trip, used as the amount collected on confirm. */
function tripAdvanceAmount(tripName: string): number {
  try {
    const matched = listTrips().find((t: any) => (t.title || t.name) === tripName);
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
 * When `tierId` is provided and the batch uses the new per-offer schema
 * (batches[].offers[]), also updates the matching `offer.booked` field so that
 * `resolveBooking` reflects the confirmed count accurately.
 *
 * ATOMICITY INVARIANT — keep this function fully SYNCHRONOUS. Node is
 * single-threaded, so a synchronous read-modify-write (readTrip → mutate →
 * writeTrip) runs to completion in one tick and cannot interleave with another
 * confirmation. Do NOT introduce `await` here — doing so reopens the race.
 */
function adjustBookingCount(tripName: string, batchId: string | null, delta: 1 | -1, tierId?: string | null) {
  try {
    const matched = listTrips().find((t: any) => (t.title || t.name) === tripName);
    if (!matched) return;
    const tripData = readTrip(matched.slug);
    if (!tripData) return;

    const batches = Array.isArray(tripData.batches) ? tripData.batches : [];
    if (batches.length > 0 && batchId) {
      const b = batches.find((x: any) => x.id === batchId);
      if (b) {
        const cur = typeof b.bookedSpots === 'number' ? b.bookedSpots : 0;
        b.bookedSpots = Math.max(0, cur + delta);
        // Also update per-tier offer.booked for new-schema trips.
        if (tierId && Array.isArray(b.offers)) {
          const offer = b.offers.find((o: any) => o.tierId === tierId);
          if (offer) {
            const curBooked = typeof offer.booked === 'number' ? offer.booked : 0;
            offer.booked = Math.max(0, curBooked + delta);
          }
        }
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

export const POST: APIRoute = async ({ request, locals }) => {
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
    const tripName = reg?.trip_name as string;
    const batchId = (reg?.batch_id as string) ?? null;
    const tierId = (reg?.tier_id as string) ?? null;

    // ── Pre-flight: capacity check BEFORE writing to DB ──────────────────────
    // Must run before the UPDATE so the confirmed count doesn't include this row.
    if (reg && newStatus === 'confirmed' && prevStatus !== 'confirmed' && batchId && tierId) {
      const confirmedCount = (getDb()
        .prepare('SELECT COUNT(*) as n FROM registrations WHERE batch_id=? AND tier_id=? AND status=?')
        .get(batchId, tierId, 'confirmed') as { n: number }).n;
      try {
        const matched = listTrips().find((t: any) => (t.title || t.name) === tripName);
        if (matched) {
          const tripData = readTrip(matched.slug);
          const batch = (tripData?.batches as any[])?.find((b: any) => b.id === batchId);
          const offer = (batch?.offers as any[])?.find((o: any) => o.tierId === tierId);
          if (offer?.cap != null && confirmedCount >= offer.cap) {
            return new Response(JSON.stringify({
              success: false,
              error: `This tier is now full (${confirmedCount}/${offer.cap} confirmed). Please confirm another departure or reject this booking.`,
            }), { status: 400, headers: { 'Content-Type': 'application/json' } });
          }
        }
      } catch { /* non-fatal: proceed with confirm if cap check fails */ }
    }

    // Update DB
    getDb()
      .prepare(
        'UPDATE registrations SET status=?, admin_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      )
      .run(newStatus, adminNotes, id);

    // Side-effects only when status actually changes
    if (reg && newStatus !== prevStatus) {
      // ── Booking count + revenue adjustment (on the booked departure) ──────
      if (newStatus === 'confirmed' && prevStatus !== 'confirmed') {
        adjustBookingCount(tripName, batchId, 1, tierId);
        // Revenue: record the advance collected when the booking is confirmed.
        const advance = tripAdvanceAmount(tripName);
        getDb().prepare('UPDATE registrations SET amount_paid=? WHERE id=?').run(advance, id);
      } else if (prevStatus === 'confirmed' && newStatus !== 'confirmed') {
        adjustBookingCount(tripName, batchId, -1, tierId);
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

    // Recalculate leaderboard when a booking is confirmed or un-confirmed (non-blocking)
    if (reg && newStatus !== prevStatus &&
        (newStatus === 'confirmed' || prevStatus === 'confirmed')) {
      recalculateUserLeaderboard(reg.email as string).catch(err =>
        console.error('[leaderboard recalc]', err)
      );
    }

    // Audit log (non-blocking)
    if (reg && newStatus !== prevStatus) {
      logAction({
        actorUserId: locals.adminUser?.userId,
        actorEmail:  locals.adminUser?.email,
        actorRole:   locals.adminUser?.role,
        action: `booking.${newStatus}`,
        targetType: 'registration',
        targetId: String(id),
        previousValue: { status: prevStatus },
        newValue: { status: newStatus, admin_notes: adminNotes || undefined },
      });
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
