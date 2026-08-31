import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { requireRole } from '../../../../lib/requireRole';
import { jsonOk, jsonFail } from '../../../../lib/apiResponse';
import { logAction } from '../../../../lib/audit';
import { sanitizeInput, formatINR } from '../../../../lib/utils';
import { resolveSelection } from './create';
import { confirmedCountForTier, tierCapFor, moveBookingTier } from '../../../../lib/registrationWrite';
import { derivePaymentStatus, REFUND_PAYMENT_STATUSES } from '../../../../lib/registrationStatus';
import { purgeUrls, tripPaths } from '../../../../lib/cachePurge';

// Change a registration's occupancy tier on the same departure. Occupancy is
// write-once at insert everywhere else — this is the only post-create path that
// moves it, so it also has to move the money (total_amount, payment_status) and
// the per-tier seat counter. Paid/confirmed bookings are never blocked: the
// route surfaces warnings (overpayment, already-issued invoice) and lets ops
// resolve them by hand.
//
// Modeled on fields.ts for shape and on update-registration.ts for the
// side-effect ordering (validate → capacity pre-flight → write → seat move →
// audit → cache purge).

export const PATCH: APIRoute = async ({ request, locals }) => {
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;

  try {
    const body = await request.json();

    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) return jsonFail('A valid registration id is required.');

    const tierId = sanitizeInput(body.tierId);
    if (!tierId) return jsonFail('An occupancy option is required.');

    const db = getDb();
    const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(id) as any;
    if (!reg) return jsonFail('Registration not found.', 404);

    // A row with no trip_slug / batch_id can't be resolved to a departure — and
    // resolveSelection('', …) → readTrip('') → assertSafeSlug('') throws
    // synchronously outside any try/catch, which would surface as an opaque 500
    // for exactly the mis-linked legacy row this feature exists to fix.
    if (!reg.trip_slug || !reg.batch_id) {
      return jsonFail("This booking isn't linked to a departure — occupancy can't be changed.");
    }

    if (reg.status === 'rejected' || reg.status === 'cancelled') {
      return jsonFail('Re-instate the booking before changing occupancy.');
    }

    if (tierId === reg.tier_id) return jsonOk({ success: true, noop: true });

    const sel = resolveSelection(reg.trip_slug, reg.batch_id, tierId);
    if ('error' in sel) return jsonFail(sel.error);

    // editableBooking reads the raw catalog price through numOrNull, so an offer
    // with no price yields total_amount 0 — which would strand the booking as
    // unconfirmable (needsConfirmPayment requires total_amount > 0).
    if (!(sel.total_amount > 0)) {
      return jsonFail('That occupancy option has no price set — fix the trip catalog first.');
    }

    // Capacity pre-flight, before any write. Only meaningful for a confirmed
    // booking on a live departure — a pending row holds no seat yet.
    if (reg.status === 'confirmed' && !sel.is_past) {
      const cap = tierCapFor(reg.trip_name, reg.batch_id, tierId);
      if (cap != null && confirmedCountForTier(reg.batch_id, tierId) >= cap) {
        return jsonFail(`That occupancy option is full (${cap}/${cap} confirmed).`);
      }
    }

    const amountPaid = Number(reg.amount_paid) || 0;
    const warnings: string[] = [];
    if (amountPaid > sel.total_amount) {
      warnings.push(`${formatINR(amountPaid)} paid now exceeds the ${formatINR(sel.total_amount)} price — record a refund.`);
    } else if (amountPaid < sel.total_amount && reg.payment_status === 'fully_paid') {
      warnings.push(`Balance of ${formatINR(sel.total_amount - amountPaid)} is now due.`);
    }

    const liveDocs = db.prepare(
      "SELECT document_type, zoho_document_number, status FROM invoice_documents WHERE registration_id=? AND status NOT IN ('failed','disabled')",
    ).all(id) as Array<{ document_type: string; zoho_document_number: string | null }>;
    for (const doc of liveDocs) {
      const kind = doc.document_type === 'advance' ? 'advance' : 'final';
      const num = doc.zoho_document_number ? ` (${doc.zoho_document_number})` : '';
      warnings.push(`A ${kind} invoice${num} was already issued — its amount is now stale. Fix it in Zoho.`);
    }

    // A refunded booking must keep its refund payment_status — never re-derive it
    // back to advance_paid.
    const keepRefundStatus = (REFUND_PAYMENT_STATUSES as readonly string[]).includes(reg.payment_status);
    const nextPaymentStatus = keepRefundStatus
      ? reg.payment_status
      : derivePaymentStatus({ amount_paid: amountPaid, total_amount: sel.total_amount });

    const previousValue = {
      tier_id: reg.tier_id,
      sharing_option: reg.sharing_option,
      total_amount: reg.total_amount,
      payment_status: reg.payment_status,
    };
    const newValue = {
      tier_id: sel.tier_id,
      sharing_option: sel.sharing_option,
      total_amount: sel.total_amount,
      payment_status: nextPaymentStatus,
    };

    db.transaction(() => {
      db.prepare(`
        UPDATE registrations
           SET tier_id=?, sharing_option=?, total_amount=?, payment_status=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=?
      `).run(sel.tier_id, sel.sharing_option, sel.total_amount, nextPaymentStatus, id);
    })();

    // Only a confirmed booking holds a seat. moveBookingTier is a single
    // synchronous read-modify-write — same atomicity invariant as
    // adjustBookingCount.
    const seatMoved = reg.status === 'confirmed';
    if (seatMoved) moveBookingTier(reg.trip_name, reg.batch_id, reg.tier_id, sel.tier_id);

    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: 'booking.occupancy_changed',
      targetType: 'registration',
      targetId: String(id),
      previousValue,
      newValue,
    });

    // The per-tier "N spots left" and sold-out badge on the trip page are
    // edge-cached; only a seat move changes them.
    if (seatMoved) await purgeUrls(tripPaths(reg.trip_slug));

    return jsonOk({
      success: true,
      sharing_option: sel.sharing_option,
      total_amount: sel.total_amount,
      payment_status: nextPaymentStatus,
      warnings,
    });
  } catch (err) {
    console.error('[registrations/occupancy]', err);
    return jsonFail('Server error.', 500);
  }
};
