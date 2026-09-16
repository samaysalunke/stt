import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from './db';
import { logAction } from './audit';
import type { PaymentStatus } from './registrationStatus';

export type PaymentEventType = 'advance' | 'balance' | 'payment' | 'reversal' | 'adjustment';
export type DocumentType = 'advance' | 'final';
export type ZohoMode = 'disabled' | 'draft' | 'live';

export interface PaymentInput {
  registrationId: number;
  amount: number;
  receivedAt: string;
  method?: string | null;
  transactionReference?: string | null;
  eventType: PaymentEventType;
  idempotencyKey: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  source?: string;
  documentType?: DocumentType;
  /** Negative-amount refund: also increments registrations.amount_refunded by abs(amount). */
  refund?: boolean;
  /** Written to registrations.payment_status inside the same immediate transaction. */
  setPaymentStatus?: PaymentStatus;
}

export const zohoMode = (): ZohoMode => {
  const value = String((import.meta.env as any).ZOHO_BOOKS_MODE || process.env.ZOHO_BOOKS_MODE || 'disabled');
  return value === 'draft' || value === 'live' ? value : 'disabled';
};

export function validReceivedAt(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.now() + 5 * 60_000;
}

export function sanitizePaymentMethod(value: unknown): string | null {
  const method = String(value ?? '').trim().toLowerCase();
  return ['upi', 'bank_transfer', 'cash', 'card', 'cheque', 'other'].includes(method) ? method : null;
}

export function billingSnapshot(reg: Record<string, any>) {
  return {
    customerName: String(reg.full_name || '').trim(),
    email: String(reg.email || '').trim(),
    phone: String(reg.phone || '').trim(),
    address: String(reg.address || '').trim(),
    city: String(reg.city || '').trim(),
    state: String(reg.state || '').trim(),
    pincode: String(reg.pincode || '').trim(),
    country: String(reg.country || 'India'),
    tripName: String(reg.trip_name || ''),
    tripDate: String(reg.trip_date || ''),
    totalAmount: Number(reg.total_amount) || 0,
    registrationId: Number(reg.id),
  };
}

/**
 * What genuinely blocks a Zoho document, and nothing more.
 *
 * Only the customer name qualifies: Zoho's `contact_name` is mandatory and
 * unique, so a blank one cannot create or match a contact.
 *
 * `state` used to be required here and was the single reason invoicing stalled
 * — every document raised for a booking without one failed pre-flight, which
 * was most of them, because only the public checkout collects a state. The
 * requirement was never real for this org: Zoho Books reports
 * `is_gst_india_version: false` and `is_registered_for_gst: false`, and
 * place-of-supply is mandatory only on the India GST version. The address
 * fields still ride along in the snapshot and fill the Zoho billing address
 * whenever the row happens to carry them.
 */
export function billingProblems(snapshot: ReturnType<typeof billingSnapshot>): string[] {
  const errors: string[] = [];
  if (!snapshot.customerName) errors.push('billing name');
  return errors;
}

function enqueueDocument(
  db: Database.Database,
  registrationId: number,
  type: DocumentType,
  paymentEventId: string | null,
  snapshot: ReturnType<typeof billingSnapshot>,
) {
  const mode = zohoMode();
  if (mode === 'disabled') return null;
  const id = randomUUID();
  const status = 'queued';
  db.prepare(`
    INSERT INTO invoice_documents (
      id, registration_id, document_type, external_reference, billing_snapshot,
      payment_event_id, mode, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(registration_id, document_type) DO NOTHING
  `).run(id, registrationId, type, `STT-REG-${registrationId}-${type.toUpperCase()}`, JSON.stringify(snapshot), paymentEventId, mode, status);
  return db.prepare('SELECT * FROM invoice_documents WHERE registration_id=? AND document_type=?').get(registrationId, type) as any;
}

/** Append a payment event and update amount_paid in one immediate transaction. */
export function recordPayment(input: PaymentInput) {
  const db = getDb();
  const transaction = db.transaction(() => {
    const duplicate = db.prepare('SELECT * FROM payment_events WHERE idempotency_key=?').get(input.idempotencyKey) as any;
    if (duplicate) {
      // Converge the payment_status column even on a replay (cheap, idempotent).
      if (input.setPaymentStatus) {
        db.prepare('UPDATE registrations SET payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(input.setPaymentStatus, input.registrationId);
      }
      const registration = db.prepare('SELECT * FROM registrations WHERE id=?').get(input.registrationId) as any;
      const document = input.documentType
        ? db.prepare('SELECT * FROM invoice_documents WHERE registration_id=? AND document_type=?').get(input.registrationId, input.documentType)
        : null;
      return { event: duplicate, registration, document, duplicate: true };
    }

    const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(input.registrationId) as any;
    if (!reg) throw new Error('Registration not found');
    if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error('Payment amount must be a non-zero whole rupee amount');
    if (!validReceivedAt(input.receivedAt)) throw new Error('Received date is invalid or in the future');
    const nextAmount = (Number(reg.amount_paid) || 0) + input.amount;
    const total = Number(reg.total_amount);
    if (nextAmount < 0) throw new Error('Payment reversal exceeds the recorded amount');
    if (input.amount > 0 && Number.isFinite(total) && total > 0 && nextAmount > total) {
      throw new Error(`Payment exceeds the remaining balance of ₹${Math.max(0, total - (Number(reg.amount_paid) || 0)).toLocaleString('en-IN')}`);
    }

    const eventId = randomUUID();
    db.prepare(`
      INSERT INTO payment_events (
        id, registration_id, event_type, amount, received_at, payment_method,
        transaction_reference, source, actor_user_id, actor_email, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId, input.registrationId, input.eventType, input.amount, input.receivedAt,
      sanitizePaymentMethod(input.method), String(input.transactionReference || '').trim() || null,
      input.source || 'admin', input.actorUserId || null, input.actorEmail || null, input.idempotencyKey,
    );
    const extraSet: string[] = [];
    const extraVals: unknown[] = [];
    if (input.refund) { extraSet.push('amount_refunded = amount_refunded + ?'); extraVals.push(Math.abs(input.amount)); }
    if (input.setPaymentStatus) { extraSet.push('payment_status = ?'); extraVals.push(input.setPaymentStatus); }
    db.prepare(
      `UPDATE registrations SET amount_paid=?, payment_date=?, payment_method=?, transaction_id=COALESCE(?, transaction_id)`
      + (extraSet.length ? ', ' + extraSet.join(', ') : '')
      + `, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    ).run(
      nextAmount, input.receivedAt, sanitizePaymentMethod(input.method),
      String(input.transactionReference || '').trim() || null, ...extraVals, input.registrationId,
    );

    const updated = { ...reg, amount_paid: nextAmount, payment_date: input.receivedAt };
    const snapshot = billingSnapshot(updated);
    const document = input.documentType ? enqueueDocument(db, input.registrationId, input.documentType, eventId, snapshot) : null;
    const event = db.prepare('SELECT * FROM payment_events WHERE id=?').get(eventId);
    return { event, registration: updated, document, duplicate: false };
  });
  return transaction.immediate();
}

export interface RefundInput {
  registrationId: number;
  amount: number;
  refundKind: 'partial' | 'full';
  receivedAt?: string;
  method?: string | null;
  transactionReference?: string | null;
  requestId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
}

/**
 * Record a refund against a `cancelled` registration. Shared by
 * update-registration (`→ cancelled` bundled) and payment.ts (`action:'refund'`).
 * Writes the ledger event, amount_paid, amount_refunded, and payment_status in
 * one atomic transaction (recordPayment's immediate tx). Never sends email.
 */
export function recordRefund(input: RefundInput) {
  const db = getDb();
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(input.registrationId) as any;
  if (!reg) throw new Error('Registration not found');
  if (reg.status !== 'cancelled') throw new Error('Refunds can only be recorded against a cancelled booking.');

  const idempotencyKey = `admin-refund:${input.requestId}:${input.registrationId}`;
  const setPaymentStatusEarly: PaymentStatus = input.refundKind === 'full' ? 'full_refund' : 'partial_refund';

  // Idempotency replay: the amount-vs-paid checks below no longer hold once the
  // first call has already decremented amount_paid. Short-circuit and converge.
  const priorEvent = db.prepare('SELECT id FROM payment_events WHERE idempotency_key=?').get(idempotencyKey);
  if (priorEvent) {
    db.prepare('UPDATE registrations SET payment_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?')
      .run(setPaymentStatusEarly, input.registrationId);
    const row = db.prepare('SELECT amount_paid, amount_refunded, payment_status FROM registrations WHERE id=?').get(input.registrationId) as any;
    return {
      amountPaid: Number(row.amount_paid) || 0,
      amountRefunded: Number(row.amount_refunded) || 0,
      paymentStatus: row.payment_status as PaymentStatus,
      duplicate: true,
    };
  }

  const paid = Number(reg.amount_paid) || 0;
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Refund amount must be a positive whole rupee value.');
  if (input.refundKind === 'full') {
    if (amount !== paid) throw new Error(`A full refund must equal the amount paid (₹${paid.toLocaleString('en-IN')}).`);
  } else if (input.refundKind === 'partial') {
    if (amount >= paid) throw new Error('A partial refund must be less than the amount paid.');
  } else {
    throw new Error('Refund kind must be "partial" or "full".');
  }

  const setPaymentStatus: PaymentStatus = input.refundKind === 'full' ? 'full_refund' : 'partial_refund';
  const before = { amount_paid: paid, amount_refunded: Number(reg.amount_refunded) || 0, payment_status: reg.payment_status };

  const recorded = recordPayment({
    registrationId: input.registrationId,
    amount: -amount,
    receivedAt: input.receivedAt && validReceivedAt(input.receivedAt) ? input.receivedAt : new Date().toISOString(),
    method: input.method ?? null,
    transactionReference: input.transactionReference ?? null,
    eventType: 'reversal',
    refund: true,
    setPaymentStatus,
    idempotencyKey,
    actorUserId: input.actorUserId ?? null,
    actorEmail: input.actorEmail ?? null,
    source: 'admin-refund',
    documentType: undefined,
  });

  const row = db.prepare('SELECT amount_paid, amount_refunded, payment_status FROM registrations WHERE id=?').get(input.registrationId) as any;
  const after = { amount_paid: Number(row.amount_paid) || 0, amount_refunded: Number(row.amount_refunded) || 0, payment_status: row.payment_status };

  if (!recorded.duplicate) {
    logAction({
      actorUserId: input.actorUserId ?? undefined,
      actorEmail: input.actorEmail ?? undefined,
      action: 'booking.payment_refunded',
      targetType: 'registration',
      targetId: String(input.registrationId),
      previousValue: before,
      newValue: after,
    });
  }

  return {
    amountPaid: after.amount_paid,
    amountRefunded: after.amount_refunded,
    paymentStatus: after.payment_status as PaymentStatus,
    duplicate: !!recorded.duplicate,
  };
}

export function ensureDocument(registrationId: number, type: DocumentType) {
  if (zohoMode() === 'disabled') throw new Error('Zoho Books integration is disabled');
  const db = getDb();
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(registrationId) as any;
  if (!reg) throw new Error('Registration not found');
  const snapshot = billingSnapshot(reg);
  const problems = billingProblems(snapshot);
  if (problems.length) throw new Error(`Complete ${problems.join(', ')} before generating a document`);
  let event = db.prepare(
    type === 'advance'
      ? "SELECT * FROM payment_events WHERE registration_id=? AND event_type='advance' ORDER BY created_at LIMIT 1"
      : 'SELECT * FROM payment_events WHERE registration_id=? AND amount>0 ORDER BY created_at DESC LIMIT 1',
  ).get(registrationId) as any;
  // Reviewed historical records pre-date the ledger. Create a reconciliation
  // event without changing amount_paid (which already contains the same truth).
  if (!event) {
    const amount = Number(reg.amount_paid) || 0;
    if (amount <= 0) throw new Error('Record a payment before generating a document');
    const eventId = randomUUID();
    db.prepare(`INSERT INTO payment_events (id, registration_id, event_type, amount, received_at, payment_method, transaction_reference, source, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, 'historical-review', ?)`)
      .run(eventId, registrationId, type === 'advance' ? 'advance' : 'payment', amount, reg.payment_date || reg.created_at || new Date().toISOString(), sanitizePaymentMethod(reg.payment_method) || 'other', reg.transaction_id || null, `historical-document:${registrationId}:${type}`);
    event = { id: eventId };
  }
  return enqueueDocument(db, registrationId, type, event.id, snapshot);
}

/**
 * Raise the final invoice for a booking that is fully paid and has none.
 *
 * `payment_status` and the invoice are decided in different places — the
 * payment endpoint, the confirm transition, and the occupancy move each work
 * out "fully paid" for themselves, and each used to be free to reach it
 * without raising a document. This is the one call that closes that gap, so
 * the rule lives in a single place rather than three.
 *
 * It never throws. `ensureDocument` rejects a handful of perfectly ordinary
 * situations — Zoho disabled, no payment on the row yet, an incomplete billing
 * name — and none of them should fail the booking operation that got us here.
 * The caller has already committed real work; a document that cannot be raised
 * is for the retry worker and the health check to surface, not for the request
 * to die on.
 */
export function ensureFinalDocumentIfFullyPaid(
  registrationId: number,
): { enqueued: boolean; reason?: string } {
  try {
    const db = getDb();
    const reg = db
      .prepare('SELECT amount_paid, total_amount FROM registrations WHERE id=?')
      .get(registrationId) as { amount_paid: number | null; total_amount: number | null } | undefined;
    if (!reg) return { enqueued: false, reason: 'registration not found' };

    const total = Number(reg.total_amount);
    const paid = Number(reg.amount_paid) || 0;
    // Same test as derivePaymentStatus/resolvePaymentStatus: a priced booking
    // whose recorded money covers the price.
    if (!(Number.isFinite(total) && total > 0 && paid >= total)) {
      return { enqueued: false, reason: 'not fully paid' };
    }

    const existing = db
      .prepare("SELECT id FROM invoice_documents WHERE registration_id=? AND document_type='final'")
      .get(registrationId);
    if (existing) return { enqueued: false, reason: 'already raised' };

    const document = ensureDocument(registrationId, 'final');
    return { enqueued: Boolean(document), ...(document ? {} : { reason: 'zoho disabled' }) };
  } catch (error) {
    const reason = String(error instanceof Error ? error.message : error);
    console.error('[ensureFinalDocumentIfFullyPaid]', registrationId, reason);
    return { enqueued: false, reason };
  }
}
