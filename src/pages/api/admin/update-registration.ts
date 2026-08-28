import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../../lib/db';
import { findTripByName, readTrip } from '../../../lib/content';
import {
  sendRegistrationPaymentConfirmed,
  sendRegistrationStatusRejected,
  sendRegistrationCancelled,
} from '../../../lib/email';
import { logAction } from '../../../lib/audit';
import { recalculateUserLeaderboard } from '../../../lib/stats';
import { tripAdvanceAmountBySlug, adjustBookingCount } from '../../../lib/registrationWrite';
import { requireRole } from '../../../lib/requireRole';
import {
  recordPayment,
  recordRefund,
  sanitizePaymentMethod,
  validReceivedAt,
} from '../../../lib/paymentLedger';
import { processZohoDocument } from '../../../lib/zohoBooks';
import { assertTransition, ADMIN_SETTABLE_STATUSES } from '../../../lib/registrationStatus';

const bad = (error: string, status = 400) =>
  new Response(JSON.stringify({ success: false, error }), { status, headers: { 'Content-Type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  // Confirming/rejecting/cancelling a booking records payment/refund + emails the
  // customer — a payment-data action, owner/ops only (matches create/import).
  const denied = requireRole(locals, ['owner', 'ops']);
  if (denied) return denied;
  try {
    const body = await request.json();
    const id = parseInt(body.id);
    const newStatus = body.status?.toString();
    const adminNotes = body.admin_notes?.toString() ?? '';
    const requestId = String(body.requestId || randomUUID());
    const requestedPaymentStatus = body.payment_status ? String(body.payment_status) : undefined;

    if (!id || !(ADMIN_SETTABLE_STATUSES as readonly string[]).includes(newStatus)) {
      return bad('Invalid input.');
    }

    const reg = getDb().prepare('SELECT * FROM registrations WHERE id = ?').get(id) as Record<string, any> | null;
    if (!reg) return bad('Registration not found.', 404);

    const prevStatus = (reg.status as string) ?? 'pending';
    const tripName = reg.trip_name as string;
    const batchId = (reg.batch_id as string) ?? null;
    const tierId = (reg.tier_id as string) ?? null;
    const currentPaid = Number(reg.amount_paid) || 0;
    const currentRefunded = Number(reg.amount_refunded) || 0;
    const totalRaw = Number(reg.total_amount);
    const totalAmount = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : null;

    // ── Transition matrix (single source of truth) ─────────────────────────
    if (newStatus === prevStatus) {
      return new Response(JSON.stringify({ success: true, noop: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    try {
      assertTransition(prevStatus, newStatus, { amountPaid: currentPaid, totalAmount, requestedPaymentStatus });
    } catch (e: any) {
      return bad(String(e?.message || 'This status change is not allowed.'));
    }

    const configuredAdvance = tripAdvanceAmountBySlug(String(reg.trip_slug || ''));

    // ── Pre-flight: capacity (must run before the UPDATE) ──────────────────
    if (newStatus === 'confirmed' && prevStatus !== 'confirmed' && batchId && tierId) {
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
            return bad(`This tier is now full (${confirmedCount}/${offer.cap} confirmed). Please confirm another departure or reject this booking.`);
          }
        }
      } catch { /* non-fatal */ }
    }

    // ── Pre-flight: confirm amount resolution (before any DB write) ────────
    let resolvedAmount = 0;
    let confirmDocType: 'advance' | 'final' | undefined;
    if (newStatus === 'confirmed') {
      // assertTransition guaranteed requestedPaymentStatus ∈ {advance_paid,fully_paid} and totalAmount > 0.
      const total = totalAmount as number;
      const remainingToTotal = Math.max(0, total - currentPaid);

      if (requestedPaymentStatus === 'advance_paid' && configuredAdvance <= 0 && currentPaid === 0
          && !(body.amount !== undefined && body.amount !== null && body.amount !== '')) {
        return bad('This trip has no advance amount configured — set paymentAmount, or record a custom amount.');
      }

      const hasOverride = body.amount !== undefined && body.amount !== null && body.amount !== '';
      const override = hasOverride ? Number(body.amount) : null;

      if (requestedPaymentStatus === 'fully_paid') {
        confirmDocType = 'final';
        resolvedAmount = remainingToTotal;
        if (hasOverride && override !== remainingToTotal) {
          return bad(`For a full payment the amount must be the ₹${remainingToTotal.toLocaleString('en-IN')} remaining balance.`);
        }
      } else {
        confirmDocType = 'advance';
        if (hasOverride) {
          if (!Number.isInteger(override as number) || (override as number) < 1 || (override as number) > remainingToTotal) {
            return bad(`Advance amount must be between ₹1 and the ₹${remainingToTotal.toLocaleString('en-IN')} balance.`);
          }
          resolvedAmount = override as number;
        } else {
          resolvedAmount = Math.max(0, Math.min(configuredAdvance, total) - currentPaid);
        }
      }
    }

    // ── Pre-flight: bundled refund on → cancelled (before any DB write) ────
    const refundBody =
      newStatus === 'cancelled' && body.refund && typeof body.refund === 'object' ? body.refund : null;
    if (refundBody) {
      const kind = String(refundBody.kind || '');
      const amt = Number(refundBody.amount);
      if (kind !== 'partial' && kind !== 'full') return bad('Refund kind must be "partial" or "full".');
      if (!Number.isInteger(amt) || amt < 1) return bad('Refund amount must be a positive whole rupee value.');
      if (kind === 'full' && amt !== currentPaid) {
        return bad(`A full refund must equal the ₹${currentPaid.toLocaleString('en-IN')} paid.`);
      }
      if (kind === 'partial' && amt > currentPaid - 1) {
        return bad('A partial refund must be less than the amount paid.');
      }
    }

    // ── Status write ─────────────────────────────────────────────────────
    getDb()
      .prepare('UPDATE registrations SET status=?, admin_notes=?, status_changed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(newStatus, adminNotes, id);

    let effectivePaymentStatus = reg.payment_status as string;
    let confirmQueuedDoc = false;
    let refundResult: { amountRefunded: number; paymentStatus: string } | null = null;

    if (newStatus === 'confirmed') {
      // Reset any prior refund history on re-instatement (audit keeps the pre-reset value).
      if (prevStatus === 'cancelled') {
        getDb().prepare('UPDATE registrations SET amount_refunded=0 WHERE id=?').run(id);
      }

      if (resolvedAmount === 0) {
        // Legit no-op: prior payments already cover the target. No ledger event,
        // no Zoho doc — just converge the column.
        getDb().prepare('UPDATE registrations SET payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(requestedPaymentStatus, id);
        effectivePaymentStatus = requestedPaymentStatus as string;
      } else {
        const receivedAt = body.receivedAt && validReceivedAt(String(body.receivedAt))
          ? String(body.receivedAt) : new Date().toISOString();
        const method = sanitizePaymentMethod(body.method) || reg.payment_method || 'bank_transfer';
        const eventType = currentPaid > 0 ? 'balance' : 'payment';
        let recorded;
        try {
          recorded = recordPayment({
            registrationId: id,
            amount: resolvedAmount,
            receivedAt,
            method,
            transactionReference: body.transactionReference ?? reg.transaction_id,
            eventType,
            idempotencyKey: `registration-confirm:${requestId}:${id}`,
            actorUserId: locals.adminUser?.userId,
            actorEmail: locals.adminUser?.email,
            source: 'status-confirmation',
            documentType: confirmDocType,
            setPaymentStatus: requestedPaymentStatus as any,
          });
        } catch (e: any) {
          return bad(String(e?.message || 'Could not record the payment.'));
        }
        effectivePaymentStatus = requestedPaymentStatus as string;

        if (recorded.document?.status === 'queued') {
          try {
            // Await during the request: the worker sends the branded email + PDF.
            await processZohoDocument(recorded.document.id);
            confirmQueuedDoc = true;
          } catch (err) {
            // Safety net — closes the "silent until the 3rd Zoho failure" gap.
            console.error('[Zoho document]', err);
            confirmQueuedDoc = false;
          }
        }
      }

      if (prevStatus !== 'confirmed') adjustBookingCount(tripName, batchId, 1, tierId);
    } else if (newStatus === 'cancelled') {
      if (prevStatus === 'confirmed') adjustBookingCount(tripName, batchId, -1, tierId);
      if (refundBody) {
        const r = recordRefund({
          registrationId: id,
          amount: Number(refundBody.amount),
          refundKind: refundBody.kind,
          receivedAt: refundBody.receivedAt,
          method: sanitizePaymentMethod(refundBody.method),
          transactionReference: refundBody.transactionReference,
          requestId,
          actorUserId: locals.adminUser?.userId,
          actorEmail: locals.adminUser?.email,
        });
        refundResult = { amountRefunded: r.amountRefunded, paymentStatus: r.paymentStatus };
        effectivePaymentStatus = r.paymentStatus;
      }
    } else {
      // lead ↔ pending, rejected → lead/pending, lead/pending → rejected.
      // assertTransition guaranteed amount_paid === 0 here.
      getDb().prepare('UPDATE registrations SET payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run('unpaid', id);
      effectivePaymentStatus = 'unpaid';
    }

    // ── Email notifications ──────────────────────────────────────────────
    if (newStatus === 'confirmed') {
      if (!confirmQueuedDoc) {
        const freshPaid = Number((getDb().prepare('SELECT amount_paid FROM registrations WHERE id=?').get(id) as any)?.amount_paid) || 0;
        const total = Number(reg.total_amount) || 0;
        sendRegistrationPaymentConfirmed({
          full_name: reg.full_name,
          email: reg.email,
          trip_name: tripName,
          trip_date: reg.trip_date ?? '',
          kind: effectivePaymentStatus === 'fully_paid' ? 'full' : 'advance',
          amountPaid: freshPaid,
          totalAmount: total,
          balanceDue: Math.max(0, total - freshPaid),
        }).catch((err) => console.error('[Email confirmed]', err));
      }
    } else if (newStatus === 'rejected') {
      sendRegistrationStatusRejected({
        full_name: reg.full_name,
        email: reg.email,
        trip_name: tripName,
      }).catch((err) => console.error('[Email rejected]', err));
    } else if (newStatus === 'cancelled') {
      sendRegistrationCancelled({
        full_name: reg.full_name,
        email: reg.email,
        trip_name: tripName,
        trip_date: reg.trip_date ?? '',
        refundKind: refundBody?.kind ?? 'none',
        refundAmount: Number(refundBody?.amount) || 0,
      }).catch((err) => console.error('[Email cancelled]', err));
    }

    // Leaderboard recalc when a booking is confirmed or un-confirmed (non-blocking)
    if (newStatus === 'confirmed' || prevStatus === 'confirmed') {
      recalculateUserLeaderboard(reg.email as string).catch((err) => console.error('[leaderboard recalc]', err));
    }

    // Audit (non-blocking)
    const finalRow = getDb()
      .prepare('SELECT amount_paid, amount_refunded, payment_status FROM registrations WHERE id=?')
      .get(id) as any;
    logAction({
      actorUserId: locals.adminUser?.userId,
      actorEmail: locals.adminUser?.email,
      actorRole: locals.adminUser?.role,
      action: `booking.${newStatus}`,
      targetType: 'registration',
      targetId: String(id),
      previousValue: {
        status: prevStatus,
        payment_status: reg.payment_status,
        amount_paid: currentPaid,
        amount_refunded: currentRefunded,
      },
      newValue: {
        status: newStatus,
        admin_notes: adminNotes || undefined,
        payment: {
          payment_status: finalRow?.payment_status ?? effectivePaymentStatus,
          amount_paid: Number(finalRow?.amount_paid) || 0,
          amount_refunded: Number(finalRow?.amount_refunded) || 0,
        },
        refund: refundResult ? { kind: refundBody?.kind, amount: Number(refundBody?.amount) || 0 } : undefined,
      },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[update-registration]', err);
    return bad('Server error.', 500);
  }
};
