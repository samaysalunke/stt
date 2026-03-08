import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { listTrips, readTrip, writeTrip } from '../../../lib/content';
import { sendRegistrationStatusConfirmed, sendRegistrationStatusRejected } from '../../../lib/email';

const VALID_STATUSES = ['pending', 'confirmed', 'rejected'];

/** Adjust the trip's currentBookings count in the YAML file */
function adjustBookingCount(tripName: string, delta: 1 | -1) {
  try {
    const allTrips = listTrips();
    const matched = allTrips.find((t: any) => t.name === tripName);
    if (!matched) return;
    const tripData = readTrip(matched.slug);
    if (!tripData) return;
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

      // ── Booking count adjustment ──────────────────────────────────────────
      if (newStatus === 'confirmed' && prevStatus !== 'confirmed') {
        adjustBookingCount(tripName, 1);
      } else if (prevStatus === 'confirmed' && newStatus !== 'confirmed') {
        adjustBookingCount(tripName, -1);
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
