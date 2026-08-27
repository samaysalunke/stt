import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from './db';

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

export function billingProblems(snapshot: ReturnType<typeof billingSnapshot>): string[] {
  const errors: string[] = [];
  if (!snapshot.customerName) errors.push('billing name');
  if (!snapshot.state) errors.push('state');
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
    db.prepare(`UPDATE registrations SET amount_paid=?, payment_date=?, payment_method=?, transaction_id=COALESCE(?, transaction_id), updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(nextAmount, input.receivedAt, sanitizePaymentMethod(input.method), String(input.transactionReference || '').trim() || null, input.registrationId);

    const updated = { ...reg, amount_paid: nextAmount, payment_date: input.receivedAt };
    const snapshot = billingSnapshot(updated);
    const document = input.documentType ? enqueueDocument(db, input.registrationId, input.documentType, eventId, snapshot) : null;
    const event = db.prepare('SELECT * FROM payment_events WHERE id=?').get(eventId);
    return { event, registration: updated, document, duplicate: false };
  });
  return transaction.immediate();
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
