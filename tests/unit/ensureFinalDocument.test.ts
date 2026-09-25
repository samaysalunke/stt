/**
 * `ensureFinalDocumentIfFullyPaid` is the single place that decides a fully-paid
 * booking needs an invoice. Three call sites reach it — the payment endpoint,
 * the confirm transition and the occupancy move — and each has already
 * committed real work by the time it runs, so the contract that matters most
 * is the one about not throwing.
 *
 * The database is mocked by routing on SQL rather than seeded (the repo's unit
 * suite does not open a real DB), which lets the real `ensureDocument` and
 * `enqueueDocument` run underneath instead of being stubbed out.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const rows = {
  registration: null as Record<string, unknown> | null,
  paymentEvent: null as Record<string, unknown> | null,
  existingDocument: null as Record<string, unknown> | null,
};
const inserted: unknown[][] = [];

vi.mock('../../src/lib/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: () => {
        if (/FROM registrations/.test(sql)) return rows.registration;
        if (/FROM payment_events/.test(sql)) return rows.paymentEvent;
        // The helper's own existence check is `SELECT id`; enqueueDocument
        // reads the row back with `SELECT *` after inserting it.
        if (/SELECT id FROM invoice_documents/.test(sql)) return rows.existingDocument;
        if (/SELECT \* FROM invoice_documents/.test(sql)) return { id: 'doc-new', status: 'queued' };
        return null;
      },
      run: (...args: unknown[]) => { inserted.push(args); return { changes: 1 }; },
      all: () => [],
    }),
  }),
}));
vi.mock('../../src/lib/audit', () => ({ logAction: vi.fn() }));

const previousMode = process.env.ZOHO_BOOKS_MODE;
process.env.ZOHO_BOOKS_MODE = 'live';
const { ensureFinalDocumentIfFullyPaid } = await import('../../src/lib/paymentLedger');
afterAll(() => { process.env.ZOHO_BOOKS_MODE = previousMode; });

const REG = {
  id: 1, full_name: 'A Traveller', email: 'traveller@example.invalid',
  trip_name: 'Offbeat South Goa', trip_date: '10 Sept 2026', country: 'India',
};

describe('ensureFinalDocumentIfFullyPaid', () => {
  beforeEach(() => {
    rows.registration = null;
    rows.paymentEvent = { id: 'evt-1' };
    rows.existingDocument = null;
    inserted.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('is a no-op when the booking is not fully paid', () => {
    rows.registration = { ...REG, amount_paid: 5000, total_amount: 20000 };
    expect(ensureFinalDocumentIfFullyPaid(1)).toEqual({ enqueued: false, reason: 'not fully paid' });
    expect(inserted).toHaveLength(0);
  });

  it('is a no-op when the booking has no price set', () => {
    rows.registration = { ...REG, amount_paid: 5000, total_amount: 0 };
    expect(ensureFinalDocumentIfFullyPaid(1).enqueued).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it('is a no-op when an invoice has already been raised', () => {
    rows.registration = { ...REG, amount_paid: 20000, total_amount: 20000 };
    rows.existingDocument = { id: 'doc-1' };
    expect(ensureFinalDocumentIfFullyPaid(1)).toEqual({ enqueued: false, reason: 'already raised' });
    expect(inserted).toHaveLength(0);
  });

  // `>=`, matching resolvePaymentStatus — a row the status calls fully paid is
  // a row that gets an invoice, overpayment included.
  it('raises the invoice when payment meets or exceeds the total', () => {
    for (const amount_paid of [20000, 20001]) {
      inserted.length = 0;
      rows.registration = { ...REG, amount_paid, total_amount: 20000 };
      expect(ensureFinalDocumentIfFullyPaid(1).enqueued).toBe(true);
      expect(inserted.some((args) => args.includes('final'))).toBe(true);
    }
  });
});
