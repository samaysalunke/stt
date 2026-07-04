import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findTripByName, readTrip } from '../../../lib/content';
import { sendRegistrationStatusConfirmed, sendRegistrationStatusRejected } from '../../../lib/email';
import { logAction } from '../../../lib/audit';
import { recalculateUserLeaderboard } from '../../../lib/stats';
import { tripAdvanceAmountBySlug, adjustBookingCount } from '../../../lib/registrationWrite';
import { requireRole } from '../../../lib/requireRole';

const VALID_STATUSES = ['lead', 'pending', 'confirmed', 'rejected'];

export const POST: APIRoute = async ({ request, locals }) => {
  // Confirming/rejecting a booking records payment + emails the customer —
  // a payment-data action, owner/ops only (matches registration create/import).
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
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
        const matched = findTripByName(tripName);
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
        newStatus !== prevStatus
          ? 'UPDATE registrations SET status=?, admin_notes=?, status_changed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?'
          : 'UPDATE registrations SET status=?, admin_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
      )
      .run(newStatus, adminNotes, id);

    // Side-effects only when status actually changes
    if (reg && newStatus !== prevStatus) {
      // ── Booking count + revenue adjustment (on the booked departure) ──────
      if (newStatus === 'confirmed' && prevStatus !== 'confirmed') {
        adjustBookingCount(tripName, batchId, 1, tierId);
        // Revenue: record the advance collected when the booking is confirmed.
        const configuredAdvance = tripAdvanceAmountBySlug(String(reg.trip_slug || ''));
        const total = Number(reg.total_amount);
        const advance = Number.isFinite(total) && total > 0 ? Math.min(configuredAdvance, total) : configuredAdvance;
        const currentPaid = Number(reg.amount_paid) || 0;
        if (currentPaid <= 0 && advance > 0) {
          getDb().prepare('UPDATE registrations SET amount_paid=?, payment_date=COALESCE(payment_date, CURRENT_TIMESTAMP) WHERE id=?').run(advance, id);
        }
      } else if (prevStatus === 'confirmed' && newStatus !== 'confirmed') {
        adjustBookingCount(tripName, batchId, -1, tierId);
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
