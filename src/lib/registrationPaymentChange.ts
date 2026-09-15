/**
 * One row's payment move, as a function.
 *
 * Lifted out of the `for (const id of ids)` body in
 * `POST /api/admin/registrations/payment`. The endpoint keeps the request-level
 * concerns it always had — auth, validating the shared fields once, and turning
 * a per-row throw into a failed entry in `results` — and this owns what happens
 * to a single registration.
 *
 * Like `applyStatusChange`, the actor is a parameter so a non-HTTP caller can
 * run the same path. Unlike it, per-row failures stay exceptions: the endpoint's
 * contract is a 200 carrying a mixed results array, and each message is already
 * written to be shown to an admin.
 */
import { getDb } from './db';
import { logAction } from './audit';
import { tripAdvanceAmountBySlug } from './registrationWrite';
import { paymentState } from './payment';
import { recordPayment, recordRefund, zohoMode } from './paymentLedger';
import { processZohoDocument } from './zohoBooks';
import { sendRegistrationPaymentConfirmed } from './email';
import { assertPaymentActionAllowed, type PaymentStatus } from './registrationStatus';
import type { ActorRef } from './registrationStatusChange';

export type PaymentAction = 'record' | 'unpaid' | 'advance' | 'full' | 'refund';

export const PAYMENT_ACTIONS: readonly PaymentAction[] = ['record', 'unpaid', 'advance', 'full', 'refund'];

export interface PaymentChangeInput {
  id: number;
  action: string;
  /** Explicit rupee amount, or null to let the action derive it. */
  requestedAmount: number | null;
  receivedAt: string;
  method: string | null;
  /** `body.transactionReference`. */
  transactionReference?: unknown;
  /**
   * `body.transaction_reference`. Kept separate because the ledger accepts
   * either spelling while the audit row has only ever recorded the camelCase
   * one — a real inconsistency, preserved here rather than silently changed.
   */
  transactionReferenceAlt?: unknown;
  refundKind?: string;
  requestId: string;
  /**
   * More than one row in this request. Bulk skips the awaited Zoho round-trip
   * and the inline confirmation email, to avoid N synchronous round-trips.
   */
  bulk?: boolean;
}

export const resolvePaymentStatus = (action: string, nextAmount: number, total: number): PaymentStatus => {
  if (action === 'unpaid' || nextAmount <= 0) return 'unpaid';
  if (Number.isFinite(total) && total > 0 && nextAmount >= total) return 'fully_paid';
  return 'advance_paid';
};

/** Throws on a per-row failure; the caller records that as a failed result row. */
export async function applyPaymentChange(
  input: PaymentChangeInput,
  actor: ActorRef = {},
): Promise<Record<string, any>> {
  const { id, action, requestedAmount, receivedAt, method, refundKind, requestId } = input;
  const transactionReference = (input.transactionReference || input.transactionReferenceAlt) as string | null | undefined;
  const db = getDb();

  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(id) as any;
  if (!reg) throw new Error('Registration not found');
  const total = Number(reg.total_amount);
  const previousAmount = Number(reg.amount_paid) || 0;
  // Refunds carry their own, better-worded status check inside
  // recordRefund; everything else may only touch a live booking.
  if (action !== 'refund') assertPaymentActionAllowed(String(reg.status ?? 'pending'));

  if (action === 'refund') {
    const amount = requestedAmount;
    if (amount === null) throw new Error('Refund amount is required');
    const r = recordRefund({
      registrationId: id, amount, refundKind: refundKind as 'partial' | 'full',
      receivedAt, method, transactionReference,
      requestId, actorUserId: actor.userId, actorEmail: actor.email,
    });
    return { id, success: true, amountPaid: r.amountPaid, amountRefunded: r.amountRefunded, payment_status: r.paymentStatus, duplicate: r.duplicate };
  }

  // "Full" means "the remaining balance", which is undefined without a
  // trip price. An explicit amount needs no total — that is the only way
  // to record money on the legacy rows imported without one.
  if (action !== 'unpaid' && requestedAmount === null && (!Number.isFinite(total) || total <= 0)) {
    throw new Error('Set the trip price on this registration, or record an explicit amount.');
  }
  if (action === 'full' && (!Number.isFinite(total) || total <= 0)) {
    throw new Error('Set the trip price on this registration before recording it as fully paid.');
  }
  const advance = Math.min(tripAdvanceAmountBySlug(String(reg.trip_slug || '')), total || Infinity);
  const idempotencyKey = `admin-payment:${requestId}:${id}`;
  const existingEvent = db.prepare('SELECT id FROM payment_events WHERE idempotency_key=?').get(idempotencyKey);
  if (existingEvent) {
    return { id, success: true, amountPaid: previousAmount, paymentDate: reg.payment_date, state: paymentState(previousAmount, total, advance), payment_status: reg.payment_status, duplicate: true };
  }
  let amount: number;
  if (action === 'unpaid') amount = -previousAmount;
  else if (requestedAmount !== null) amount = requestedAmount;
  else if (action === 'advance') amount = Math.max(0, advance - previousAmount);
  else amount = Math.max(0, total - previousAmount);
  if (!amount) {
    if (action === 'unpaid') throw new Error('No recorded payment to reverse');
    if (action === 'advance' && advance <= 0) throw new Error('This trip has no advance amount configured — set paymentAmount, or record a custom amount.');
    throw new Error('No remaining amount to record');
  }

  const nextAmount = previousAmount + amount;
  const isAdvance = amount > 0 && previousAmount === 0 && nextAmount === advance;
  const isFull = amount > 0 && nextAmount === total;
  const nextPaymentStatus = resolvePaymentStatus(action, nextAmount, total);
  const recorded = recordPayment({
    registrationId: id, amount, receivedAt, method,
    transactionReference,
    eventType: amount < 0 ? 'reversal' : isAdvance ? 'advance' : previousAmount > 0 ? 'balance' : 'payment',
    idempotencyKey,
    actorUserId: actor.userId, actorEmail: actor.email,
    source: input.bulk ? 'admin-bulk' : 'admin',
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
    if (!input.bulk) {
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
  if (amount > 0 && !recorded.duplicate && !docHandled && (!input.bulk || zohoMode() === 'disabled')) {
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
    actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.role,
    action: amount < 0 ? 'booking.payment_reversed' : 'booking.payment_recorded', targetType: 'registration', targetId: String(id),
    previousValue: { amount: previousAmount, state: paymentState(previousAmount, total, advance) },
    newValue: { amount: nextAmount, delta: amount, state, receivedAt, method, transactionReference: input.transactionReference || undefined },
  });
  return { id, success: true, amountPaid: nextAmount, paymentDate: receivedAt, state, payment_status: nextPaymentStatus, documentId: recorded.document?.id };
}
