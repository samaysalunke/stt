import { describe, it, expect } from 'vitest';
import {
  assertPaymentActionAllowed,
  assertTransition,
  derivePaymentStatus,
  paymentOptionsFor,
} from '../../src/lib/registrationStatus';

const ctx = (over: Partial<{ amountPaid: number; totalAmount: number | null; requestedPaymentStatus: string }> = {}) => ({
  amountPaid: 0,
  totalAmount: 30000,
  requestedPaymentStatus: undefined as string | undefined,
  ...over,
});

describe('assertTransition', () => {
  it('rejects confirm when the trip has no price', () => {
    expect(() => assertTransition('pending', 'confirmed', ctx({ requestedPaymentStatus: 'fully_paid', totalAmount: null }))).toThrow(/trip price/i);
  });

  it('treats same status as a no-op', () => {
    expect(() => assertTransition('confirmed', 'confirmed', ctx({ amountPaid: 1000 }))).not.toThrow();
  });
});

describe('derivePaymentStatus', () => {
  it('legacy row with no total backfills to advance_paid', () => {
    expect(derivePaymentStatus({ amount_paid: 5000, total_amount: null })).toBe('advance_paid');
  });
});

describe('PAYMENT_OPTIONS', () => {
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
});

describe('assertPaymentActionAllowed', () => {
  it('sends a terminal booking to the refund path instead', () => {
    for (const status of ['cancelled', 'rejected']) {
      expect(() => assertPaymentActionAllowed(status), status).toThrow(/refund/i);
    }
  });

  it('refuses a wishlist entry, which has no money attached', () => {
    expect(() => assertPaymentActionAllowed('wishlist')).toThrow(/no payment to record/i);
  });
});
