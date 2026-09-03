import { describe, it, expect } from 'vitest';
import {
  ADMIN_SETTABLE_STATUSES,
  assertTransition,
  derivePaymentStatus,
  isNoRefund,
  paymentOptionsFor,
  paymentStatusLabel,
  PAYMENT_OPTIONS,
  PAYMENT_STATUSES,
  paymentStatusStyle,
  REG_STATUSES,
  regStatusStyle,
} from '../../src/lib/registrationStatus';

const ctx = (over: Partial<{ amountPaid: number; totalAmount: number | null; requestedPaymentStatus: string }> = {}) => ({
  amountPaid: 0,
  totalAmount: 30000,
  requestedPaymentStatus: undefined as string | undefined,
  ...over,
});

describe('assertTransition', () => {
  it('allows lead → confirmed with a payment status and a positive total', () => {
    expect(() => assertTransition('lead', 'confirmed', ctx({ requestedPaymentStatus: 'advance_paid' }))).not.toThrow();
  });

  it('rejects confirm without a payment status', () => {
    expect(() => assertTransition('pending', 'confirmed', ctx())).toThrow(/advance or the full payment/i);
  });

  it('rejects confirm when the trip has no price', () => {
    expect(() => assertTransition('pending', 'confirmed', ctx({ requestedPaymentStatus: 'fully_paid', totalAmount: null }))).toThrow(/trip price/i);
  });

  // `rejected` was merged into `cancelled`; nothing can be set to it any more.
  it('blocks every → rejected, from any status', () => {
    for (const from of ['lead', 'pending', 'confirmed', 'cancelled']) {
      expect(() => assertTransition(from, 'rejected', ctx({ amountPaid: 1000 })), from)
        .toThrow(/not a status you can set/i);
    }
  });

  it('blocks confirmed → lead', () => {
    expect(() => assertTransition('confirmed', 'lead', ctx({ amountPaid: 1000 }))).toThrow();
  });

  it('allows confirmed → cancelled', () => {
    expect(() => assertTransition('confirmed', 'cancelled', ctx({ amountPaid: 1000 }))).not.toThrow();
  });

  it('blocks cancelled → lead', () => {
    expect(() => assertTransition('cancelled', 'lead', ctx())).toThrow(/Re-instate via Confirm/i);
  });

  it('allows cancelled → confirmed', () => {
    expect(() => assertTransition('cancelled', 'confirmed', ctx({ requestedPaymentStatus: 'advance_paid' }))).not.toThrow();
  });

  it('allows rejected → confirmed', () => {
    expect(() => assertTransition('rejected', 'confirmed', ctx({ requestedPaymentStatus: 'fully_paid' }))).not.toThrow();
  });

  // Was "Use Reject for a lead that won't proceed" — with `rejected` retired,
  // cancelling is the only way to close a lead out.
  it('allows lead → cancelled', () => {
    expect(() => assertTransition('lead', 'cancelled', ctx())).not.toThrow();
  });

  it('still lets a legacy rejected row move out', () => {
    expect(() => assertTransition('rejected', 'cancelled', ctx({ amountPaid: 1000 }))).not.toThrow();
  });

  it('treats same status as a no-op', () => {
    expect(() => assertTransition('confirmed', 'confirmed', ctx({ amountPaid: 1000 }))).not.toThrow();
  });
});

describe('derivePaymentStatus', () => {
  it('unpaid when nothing recorded', () => {
    expect(derivePaymentStatus({ amount_paid: 0, total_amount: 30000 })).toBe('unpaid');
  });
  it('fully_paid at or above total', () => {
    expect(derivePaymentStatus({ amount_paid: 30000, total_amount: 30000 })).toBe('fully_paid');
  });
  it('advance_paid below total', () => {
    expect(derivePaymentStatus({ amount_paid: 5000, total_amount: 30000 })).toBe('advance_paid');
  });
  it('legacy row with no total backfills to advance_paid', () => {
    expect(derivePaymentStatus({ amount_paid: 5000, total_amount: null })).toBe('advance_paid');
  });
});

describe('labels and styles', () => {
  it('labels every payment status', () => {
    expect(['unpaid', 'advance_paid', 'fully_paid', 'partial_refund', 'full_refund'].map(paymentStatusLabel))
      .toEqual(['Unpaid', 'Advance paid', 'Fully paid', 'Partial refund', 'Refunded']);
  });
  it('styles every status from the shared palette, with no bare hex', () => {
    for (const status of REG_STATUSES) {
      const style = regStatusStyle(status);
      expect(style, status).toMatch(/background:var\(--color-[a-z-]+-surface\);color:var\(--color-[a-z-]+-ink\);/);
      expect(style, status).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
  it('styles every payment status from the shared palette', () => {
    for (const status of PAYMENT_STATUSES) {
      expect(paymentStatusStyle(status), status).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
  it('falls back to the pending pill for an unknown status', () => {
    expect(regStatusStyle('not-a-status')).toBe(regStatusStyle('pending'));
  });
});

// The bulk bar and the per-row Payment select both render from PAYMENT_OPTIONS.
// They drifted apart once — offering different words, and silently doing
// nothing for the ones only one of them understood.
describe('PAYMENT_OPTIONS', () => {
  it('covers every status an admin can set', () => {
    for (const status of ADMIN_SETTABLE_STATUSES) {
      expect(PAYMENT_OPTIONS[status], status).toBeDefined();
      expect(paymentOptionsFor(status).length, status).toBeGreaterThan(0);
    }
  });

  it('only ever offers real payment statuses', () => {
    for (const [status, options] of Object.entries(PAYMENT_OPTIONS)) {
      for (const option of options) {
        expect(PAYMENT_STATUSES, `${status} → ${option}`).toContain(option);
      }
    }
  });

  it('gives a wishlist entry no payment control, even holding a payment status', () => {
    expect(paymentOptionsFor('wishlist')).toEqual([]);
    expect(paymentOptionsFor('wishlist', 'advance_paid')).toEqual([]);
    expect(paymentOptionsFor('not-a-status')).toEqual([]);
  });

  // Production carries a `lead` with a recorded advance. Dropping that value
  // would show the row as Unpaid and count as an edit on page load, leaving a
  // live payment one click from being reversed.
  it('keeps a row its own payment status when the matrix does not offer it', () => {
    expect(paymentOptionsFor('lead')).toEqual(['unpaid']);
    expect(paymentOptionsFor('lead', 'advance_paid')).toEqual(['advance_paid', 'unpaid']);
    expect(paymentOptionsFor('lead', 'advance_paid')[0]).toBe('advance_paid');
  });

  it('does not duplicate or invent a value it already offers', () => {
    expect(paymentOptionsFor('pending', 'advance_paid')).toEqual(['unpaid', 'advance_paid']);
    expect(paymentOptionsFor('lead', 'not-a-payment-status')).toEqual(['unpaid']);
  });

  it('keeps refund states to cancelled bookings, and money states off them', () => {
    for (const refundState of ['no_refund', 'partial_refund', 'full_refund']) {
      expect(paymentOptionsFor('cancelled')).toContain(refundState);
      expect(paymentOptionsFor('confirmed')).not.toContain(refundState);
      expect(paymentOptionsFor('pending')).not.toContain(refundState);
    }
    expect(paymentOptionsFor('cancelled')).not.toContain('advance_paid');
    expect(paymentOptionsFor('cancelled')).not.toContain('fully_paid');
  });

  it('lets a confirmed row be reversed to unpaid — confirmed → pending is not legal', () => {
    expect(paymentOptionsFor('confirmed')).toContain('unpaid');
    expect(() => assertTransition('confirmed', 'pending', ctx())).toThrow();
  });

  it('labels every payment status, no raw identifiers', () => {
    for (const status of PAYMENT_STATUSES) {
      expect(paymentStatusLabel(status), status).not.toBe(status);
    }
    expect(paymentStatusLabel('no_refund')).toBe('No refund');
  });
});

describe('isNoRefund', () => {
  it('is a cancelled booking that kept the money', () => {
    expect(isNoRefund({ status: 'cancelled', amount_paid: 5000, amount_refunded: 0 })).toBe(true);
    expect(isNoRefund({ status: 'rejected', amount_paid: 5000, amount_refunded: 0 })).toBe(true);
  });

  it('is not a refunded, unpaid, or still-live booking', () => {
    expect(isNoRefund({ status: 'cancelled', amount_paid: 5000, amount_refunded: 5000 })).toBe(false);
    expect(isNoRefund({ status: 'cancelled', amount_paid: 0, amount_refunded: 0 })).toBe(false);
    expect(isNoRefund({ status: 'confirmed', amount_paid: 5000, amount_refunded: 0 })).toBe(false);
  });
});
