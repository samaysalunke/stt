import type { APIRoute } from 'astro';
import { getDb } from '../../../lib/db';
import { findTripByName, readTrip } from '../../../lib/content';
import { sendRegistrationPaymentConfirmed, sendRegistrationStatusRejected } from '../../../lib/email';
import { logAction } from '../../../lib/audit';
import { recalculateUserLeaderboard } from '../../../lib/stats';
import { tripAdvanceAmountBySlug, adjustBookingCount } from '../../../lib/registrationWrite';
import { requireRole } from '../../../lib/requireRole';
import { recordPayment, sanitizePaymentMethod, validReceivedAt } from '../../../lib/paymentLedger';
import { paymentState } from '../../../lib/payment';
import { processZohoDocument } from '../../../lib/zohoBooks';

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

    // Confirm-with-payment selection (honoured only on a lead/pending → confirmed
    // transition). Absent → the legacy auto-advance path below is preserved.
    const paymentSel = body.payment && typeof body.payment === 'object' ? body.payment : null;
    let confirmPayment: { kind: string; amount: number; queuedDoc: boolean } | null = null;

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

    // ── Pre-flight: reject an invalid custom payment amount BEFORE any DB write.
    if (reg && newStatus === 'confirmed' && prevStatus !== 'confirmed'
        && paymentSel && String(paymentSel.kind) === 'custom') {
      const total = Number(reg.total_amount);
      const currentPaid = Number(reg.amount_paid) || 0;
      const remaining = Number.isFinite(total) && total > 0 ? Math.max(0, total - currentPaid) : Infinity;
      const amt = Number(paymentSel.amount);
      if (!Number.isInteger(amt) || amt <= 0 || (Number.isFinite(remaining) && amt > remaining)) {
        return new Response(JSON.stringify({ success: false, error: 'Custom payment amount is invalid for this booking.' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }
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

        // Revenue: record the payment received when the booking is confirmed.
        const configuredAdvance = tripAdvanceAmountBySlug(String(reg.trip_slug || ''));
        const total = Number(reg.total_amount);
        const hasTotal = Number.isFinite(total) && total > 0;
        const currentPaid = Number(reg.amount_paid) || 0;
        const remaining = hasTotal ? Math.max(0, total - currentPaid) : Infinity;

        // No `payment` field → legacy behaviour: auto-record the configured
        // advance, but only when nothing has been paid yet.
        const kind = paymentSel ? String(paymentSel.kind || '') : (currentPaid <= 0 ? 'advance' : 'none');

        let resolvedAmount = 0;
        if (kind === 'advance') {
          const target = hasTotal ? Math.min(configuredAdvance, total) : configuredAdvance;
          resolvedAmount = Math.max(0, target - currentPaid);
        } else if (kind === 'full') {
          resolvedAmount = hasTotal ? Math.max(0, total - currentPaid) : 0;
        } else if (kind === 'custom') {
          const amt = Number(paymentSel?.amount);
          if (!Number.isInteger(amt) || amt <= 0 || (Number.isFinite(remaining) && amt > remaining)) {
            return new Response(JSON.stringify({ success: false, error: 'Custom payment amount is invalid for this booking.' }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            });
          }
          resolvedAmount = amt;
        }

        const documentType = kind === 'full' ? 'final' : (kind === 'advance' || kind === 'custom') ? 'advance' : undefined;
        const receivedAt = paymentSel?.receivedAt && validReceivedAt(String(paymentSel.receivedAt))
          ? String(paymentSel.receivedAt) : new Date().toISOString();
        const method = sanitizePaymentMethod(paymentSel?.method) || reg.payment_method || 'bank_transfer';

        let queuedDoc = false;
        if (resolvedAmount > 0) {
          const eventType = currentPaid === 0 && resolvedAmount === configuredAdvance
            ? 'advance' : currentPaid > 0 ? 'balance' : 'payment';
          const recorded = recordPayment({
            registrationId: id,
            amount: resolvedAmount,
            receivedAt,
            method,
            transactionReference: paymentSel?.transactionReference ?? reg.transaction_id,
            eventType,
            idempotencyKey: `registration-confirmed:${id}`,
            actorUserId: locals.adminUser?.userId,
            actorEmail: locals.adminUser?.email,
            source: 'status-confirmation',
            documentType,
          });
          if (recorded.document?.status === 'queued') {
            queuedDoc = true;
            void processZohoDocument(recorded.document.id).catch((err) => console.error('[Zoho document]', err));
          }
        }
        confirmPayment = { kind, amount: resolvedAmount, queuedDoc };
      } else if (prevStatus === 'confirmed' && newStatus !== 'confirmed') {
        adjustBookingCount(tripName, batchId, -1, tierId);
      }

      // ── Email notifications ───────────────────────────────────────────────
      if (newStatus === 'confirmed') {
        // When the Zoho worker has a document queued it sends the branded email
        // itself (with the invoice PDF). Otherwise — disabled mode, or no new
        // payment — we send the same branded email inline, without an attachment.
        if (!confirmPayment?.queuedDoc) {
          const freshPaid = Number((getDb().prepare('SELECT amount_paid FROM registrations WHERE id=?').get(id) as any)?.amount_paid) || 0;
          const total = Number(reg.total_amount) || 0;
          sendRegistrationPaymentConfirmed({
            full_name: reg.full_name,
            email: reg.email,
            trip_name: tripName,
            trip_date: reg.trip_date ?? '',
            kind: confirmPayment?.kind === 'full' ? 'full' : 'advance',
            amountPaid: freshPaid,
            totalAmount: total,
            balanceDue: Math.max(0, total - freshPaid),
          }).catch(err => console.error('[Email confirmed]', err));
        }
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
        newValue: {
          status: newStatus,
          admin_notes: adminNotes || undefined,
          payment: confirmPayment ? {
            kind: confirmPayment.kind,
            amount: confirmPayment.amount,
            state: paymentState(
              Number((getDb().prepare('SELECT amount_paid FROM registrations WHERE id=?').get(id) as any)?.amount_paid) || 0,
              Number(reg?.total_amount) || 0,
              tripAdvanceAmountBySlug(String(reg?.trip_slug || '')),
            ),
          } : undefined,
        },
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
