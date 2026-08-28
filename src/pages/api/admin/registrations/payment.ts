import { randomUUID } from 'node:crypto';
import type { APIRoute } from 'astro';
import { getDb } from '../../../../lib/db';
import { logAction } from '../../../../lib/audit';
import { tripAdvanceAmountBySlug } from '../../../../lib/registrationWrite';
import { paymentState } from '../../../../lib/payment';
import { jsonOk as json } from '../../../../lib/apiResponse';
import { recordPayment, recordRefund, sanitizePaymentMethod, validReceivedAt, zohoMode } from '../../../../lib/paymentLedger';
import { processZohoDocument } from '../../../../lib/zohoBooks';
import { sendRegistrationPaymentConfirmed } from '../../../../lib/email';
import type { PaymentStatus } from '../../../../lib/registrationStatus';

const resolvePaymentStatus = (action: string, nextAmount: number, total: number): PaymentStatus => {
  if (action === 'unpaid' || nextAmount <= 0) return 'unpaid';
  if (Number.isFinite(total) && total > 0 && nextAmount >= total) return 'fully_paid';
  return 'advance_paid';
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    if (!locals.adminUser || locals.adminUser.role === 'trip_lead') return json({ success: false, error: 'Access denied' }, 403);
    const body = await request.json();
    const action = String(body.action || 'record');
    const ids: number[] = Array.isArray(body.ids)
      ? [...new Set(body.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))]
          .map(Number)
      : [];
    if (!ids.length || !['record', 'unpaid', 'advance', 'full', 'refund'].includes(action)) return json({ success: false, error: 'Invalid payment action or registration IDs.' }, 400);
    if (ids.length > 500) return json({ success: false, error: 'Too many registrations (max 500).' }, 400);

    const receivedAt = String(body.receivedAt || body.received_at || new Date().toISOString());
    const method = sanitizePaymentMethod(body.method || body.paymentMethod || (action === 'unpaid' ? 'other' : 'bank_transfer'));
    if (!validReceivedAt(receivedAt)) return json({ success: false, error: 'Received date is invalid or in the future.' }, 400);
    if (action !== 'unpaid' && !method) return json({ success: false, error: 'Choose a valid payment method.' }, 400);
    const refundKind = action === 'refund' ? String(body.refundKind || '') : '';
    if (action === 'refund' && refundKind !== 'partial' && refundKind !== 'full') return json({ success: false, error: 'Refund kind must be "partial" or "full".' }, 400);
    const requestedAmount = body.amount === undefined || body.amount === null || body.amount === '' ? null : Number(body.amount);
    if (requestedAmount !== null && (!Number.isInteger(requestedAmount) || requestedAmount <= 0)) return json({ success: false, error: 'Amount must be a positive whole rupee value.' }, 400);

    const db = getDb();
    const requestId = String(body.requestId || randomUUID());
    const results: Record<string, any>[] = [];
    for (const id of ids) {
      try {
        const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(id) as any;
        if (!reg) throw new Error('Registration not found');
        const total = Number(reg.total_amount);
        const previousAmount = Number(reg.amount_paid) || 0;

        if (action === 'refund') {
          const amount = requestedAmount;
          if (amount === null) throw new Error('Refund amount is required');
          const r = recordRefund({
            registrationId: id, amount, refundKind: refundKind as 'partial' | 'full',
            receivedAt, method, transactionReference: body.transactionReference || body.transaction_reference,
            requestId, actorUserId: locals.adminUser.userId, actorEmail: locals.adminUser.email,
          });
          results.push({ id, success: true, amountPaid: r.amountPaid, amountRefunded: r.amountRefunded, payment_status: r.paymentStatus, duplicate: r.duplicate });
          continue;
        }

        if (action !== 'unpaid' && (!Number.isFinite(total) || total <= 0)) throw new Error('Valid total amount is required');
        const advance = Math.min(tripAdvanceAmountBySlug(String(reg.trip_slug || '')), total || Infinity);
        const idempotencyKey = `admin-payment:${requestId}:${id}`;
        const existingEvent = db.prepare('SELECT id FROM payment_events WHERE idempotency_key=?').get(idempotencyKey);
        if (existingEvent) {
          results.push({ id, success: true, amountPaid: previousAmount, paymentDate: reg.payment_date, state: paymentState(previousAmount, total, advance), payment_status: reg.payment_status, duplicate: true });
          continue;
        }
        let amount: number;
        if (action === 'unpaid') amount = -previousAmount;
        else if (requestedAmount !== null) amount = requestedAmount;
        else if (action === 'advance') amount = Math.max(0, advance - previousAmount);
        else amount = Math.max(0, total - previousAmount);
        if (!amount) throw new Error(action === 'unpaid' ? 'No recorded payment to reverse' : 'No remaining amount to record');

        const nextAmount = previousAmount + amount;
        const isAdvance = amount > 0 && previousAmount === 0 && nextAmount === advance;
        const isFull = amount > 0 && nextAmount === total;
        const nextPaymentStatus = resolvePaymentStatus(action, nextAmount, total);
        const recorded = recordPayment({
          registrationId: id, amount, receivedAt, method,
          transactionReference: body.transactionReference || body.transaction_reference,
          eventType: amount < 0 ? 'reversal' : isAdvance ? 'advance' : previousAmount > 0 ? 'balance' : 'payment',
          idempotencyKey,
          actorUserId: locals.adminUser.userId, actorEmail: locals.adminUser.email,
          source: ids.length > 1 ? 'admin-bulk' : 'admin',
          // Advance payments no longer generate a Zoho document (retainer
          // invoices need a paid plan) — the customer still gets the branded
          // email. Only a fully-paid booking issues the final invoice.
          documentType: isFull ? 'final' : undefined,
          setPaymentStatus: nextPaymentStatus,
        });
        // Single-row admin action: await the Zoho worker so we know whether it
        // emailed the customer (branded mail, + PDF on live). Bulk stays
        // fire-and-forget to avoid N synchronous Zoho round-trips.
        let docHandled = false;
        if (recorded.document?.status === 'queued') {
          if (ids.length === 1) {
            try {
              const done = await processZohoDocument(recorded.document.id) as any;
              docHandled = done?.status === 'emailed' || done?.status === 'draft';
            } catch (err) {
              console.error('[Zoho document]', err);
            }
          } else {
            void processZohoDocument(recorded.document.id).catch((err) => console.error('[Zoho document]', err));
          }
        }
        // Send an inline confirmation when the Zoho worker didn't email the
        // customer — it failed, or Zoho is disabled. Skipped for bulk in
        // draft/live (there the worker/retry cron is the only sender).
        if (amount > 0 && !recorded.duplicate && !docHandled && (ids.length === 1 || zohoMode() === 'disabled')) {
          const totalAmount = Number(total) || 0;
          void sendRegistrationPaymentConfirmed({
            full_name: reg.full_name,
            email: reg.email,
            trip_name: reg.trip_name,
            trip_date: reg.trip_date ?? '',
            kind: isFull ? 'full' : 'advance',
            amountPaid: nextAmount,
            totalAmount,
            balanceDue: Math.max(0, totalAmount - nextAmount),
          }).catch((err) => console.error('[Email payment confirmed]', err));
        }
        const state = paymentState(nextAmount, total, advance);
        logAction({
          actorUserId: locals.adminUser.userId, actorEmail: locals.adminUser.email, actorRole: locals.adminUser.role,
          action: amount < 0 ? 'booking.payment_reversed' : 'booking.payment_recorded', targetType: 'registration', targetId: String(id),
          previousValue: { amount: previousAmount, state: paymentState(previousAmount, total, advance) },
          newValue: { amount: nextAmount, delta: amount, state, receivedAt, method, transactionReference: body.transactionReference || undefined },
        });
        results.push({ id, success: true, amountPaid: nextAmount, paymentDate: receivedAt, state, payment_status: nextPaymentStatus, documentId: recorded.document?.id });
      } catch (error: any) {
        results.push({ id, success: false, error: String(error?.message || error) });
      }
    }
    return json({ success: true, results, succeeded: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length });
  } catch (err) {
    console.error('[registrations/payment]', err);
    return json({ success: false, error: 'Server error.' }, 500);
  }
};
