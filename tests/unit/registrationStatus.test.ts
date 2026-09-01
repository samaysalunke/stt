import { describe, it, expect } from 'vitest';
import {
  assertTransition,
  derivePaymentStatus,
  paymentStatusLabel,
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

  it('blocks confirmed → rejected', () => {
    expect(() => assertTransition('confirmed', 'rejected', ctx({ amountPaid: 1000 }))).toThrow(/Use Cancel/i);
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

  it('blocks lead → cancelled', () => {
    expect(() => assertTransition('lead', 'cancelled', ctx())).toThrow(/Use Reject/i);
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
