import { describe, expect, it, vi } from 'vitest';

// Only rows with a trip_slug reach readTrip, so the existing slug-less cases
// are unaffected by this stub.
const TRIPS: Record<string, Record<string, any>> = {
  'ladakh': {
    balanceDueRule: '15 days before trip',
    batches: [
      { id: 'oct', startDate: '2026-10-10', endDate: '2026-10-16' },
      { id: 'past', startDate: '2026-05-01', endDate: '2026-05-06' },
    ],
  },
  'no-rule': { balanceDueRule: 'on arrival', batches: [{ id: 'oct', startDate: '2026-10-10', endDate: '2026-10-16' }] },
};
vi.mock('../../src/lib/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/content')>()),
  readTrip: (slug: string) => { if (!TRIPS[slug]) throw new Error('missing'); return TRIPS[slug]; },
  isTripPublic: () => true,
}));

import { canonicalizeProfileTrips, groupProfileTrips, indiaDateOnly, shapePublicTrips, todayInIndia, type ProfileRegistrationRow } from '../../src/lib/profileTrips';

const row = (overrides: Partial<ProfileRegistrationRow> = {}): ProfileRegistrationRow => ({
  id: 1, email: ' Person@Example.com ', trip_name: 'Legacy Journey', trip_slug: null,
  trip_date: '2026-09-10', batch_id: null, status: 'lead', created_at: '2026-01-01 10:00:00',
  updated_at: null, status_changed_at: null, ...overrides,
});

describe('profile trip view model', () => {
  it('keeps date-only values stable and computes India today at the UTC boundary', () => {
    expect(indiaDateOnly('2026-09-10')).toBe('2026-09-10');
    expect(todayInIndia(new Date('2026-08-28T20:00:00Z'))).toBe('2026-08-29');
  });

  it('selects a later terminal duplicate over an active record', () => {
    const records = canonicalizeProfileTrips([
      row({ id: 1, status: 'confirmed', status_changed_at: '2026-01-02T00:00:00Z' }),
      row({ id: 2, status: 'cancelled', status_changed_at: '2026-01-03T00:00:00Z', amount_paid: 5000 }),
    ], '2026-01-01');
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('cancelled');
    expect(records[0].details.amountPaid).toBe(5000);
  });

  it('otherwise applies Confirmed > Pending > Lead > Wishlist and never sums duplicates', () => {
    const [record] = canonicalizeProfileTrips([
      row({ id: 2, status: 'pending', amount_paid: 2000 }),
      row({ id: 1, status: 'confirmed', amount_paid: 3000 }),
    ], '2026-01-01');
    expect(record.status).toBe('confirmed');
    expect(record.details.amountPaid).toBe(3000);
  });

  it('keeps unresolved non-terminal records active and terminal records in history', () => {
    const records = canonicalizeProfileTrips([
      row({ id: 1, trip_date: null, created_at: null, status: 'lead' }),
      row({ id: 2, trip_name: 'Other', trip_date: null, created_at: null, status: 'rejected' }),
    ], '2026-08-28');
    const grouped = groupProfileTrips(records);
    expect(grouped.active.map((r) => r.id)).toContain(1);
    expect(grouped.history.map((r) => r.id)).toContain(2);
  });

  // A hardcoded copy of the payment-status list dropped `no_refund` through to
  // derivePaymentStatus, which showed a cancelled booking whose money we kept as
  // "Advance paid" on the traveller's own profile.
  it('shows a cancelled booking that kept the money as No refund, not Advance paid', () => {
    const [record] = canonicalizeProfileTrips([
      row({ status: 'cancelled', payment_status: 'no_refund', amount_paid: 1000, total_amount: 5000 }),
    ], '2026-01-01');
    expect(record.paymentStatus).toBe('no_refund');
    expect(record.paymentLabel).toBe('No refund');
  });

  it('uses stored payment status and public shaping excludes private details', () => {
    const [record] = canonicalizeProfileTrips([row({ status:'confirmed', payment_status:'partial_refund', full_name:'Private Name', phone:'999', emergency_name:'Secret' })], '2026-01-01');
    expect(record.paymentStatus).toBe('partial_refund');
    const publicRow = shapePublicTrips([record])[0];
    expect(Object.keys(publicRow).sort()).toEqual(['location','startDate','status','tripName','tripSlug'].sort());
    expect(JSON.stringify(publicRow)).not.toContain('Private Name');
  });

  describe('balance due', () => {
    const booked = (overrides: Partial<ProfileRegistrationRow> = {}) => row({
      trip_slug: 'ladakh', batch_id: 'oct', trip_date: '2026-10-10', status: 'confirmed',
      total_amount: 30000, amount_paid: 6000, created_at: '2026-06-01 10:00:00', ...overrides,
    });
    const today = '2026-09-24';

    it('derives the due date from the batch and the trip rule', () => {
      const [record] = canonicalizeProfileTrips([booked()], today);
      expect(record.details.balance).toBe(24000);
      expect(record.details.balanceDueDate).toBe('2026-09-25');
      expect(record.details.balanceDueRule).toBe('15 days before trip');
      expect(record.details.daysOverdue).toBe(-1);
      expect(record.details.balanceActionable).toBe(true);
    });

    it('reports days late, clamped by the booking date', () => {
      const [late] = canonicalizeProfileTrips([booked()], '2026-10-01');
      expect(late.details.daysOverdue).toBe(6);
      const [fresh] = canonicalizeProfileTrips([booked({ created_at: '2026-09-29 10:00:00' })], '2026-10-01');
      expect(fresh.details.daysOverdue).toBe(2);
    });

    it.each([[null], [0]])('treats a total of %p as unknown, never as ₹0 owed', (total) => {
      const [record] = canonicalizeProfileTrips([booked({ total_amount: total })], today);
      expect(record.details.balance).toBeNull();
      expect(record.details.balanceActionable).toBe(false);
    });

    it('has no due date when the rule does not parse', () => {
      const [record] = canonicalizeProfileTrips([booked({ trip_slug: 'no-rule' })], today);
      expect(record.details.balanceDueDate).toBeNull();
      expect(record.details.daysOverdue).toBeNull();
      expect(record.details.balance).toBe(24000);
    });

    // startDate falls back to trip_date and then created_at; a due date built
    // from that would be overdue the moment the booking was made.
    it('has no due date when the batch matches nothing, even though startDate falls back', () => {
      const [record] = canonicalizeProfileTrips([booked({ batch_id: 'gone', trip_date: null })], today);
      expect(record.startDate).toBe('2026-06-01');
      expect(record.details.balanceDueDate).toBeNull();
      expect(record.details.daysOverdue).toBeNull();
    });

    it.each(['lead', 'pending', 'cancelled'])('does not ask a %s booking to pay the balance', (status) => {
      const [record] = canonicalizeProfileTrips([booked({ status })], today);
      expect(record.details.balanceActionable).toBe(false);
    });

    it('does not ask for the balance on a trip that has already run', () => {
      const [record] = canonicalizeProfileTrips([booked({ batch_id: 'past', trip_date: '2026-05-01' })], today);
      expect(record.period).toBe('completed');
      expect(record.details.balance).toBe(24000);
      expect(record.details.balanceActionable).toBe(false);
    });

    it('does not ask a fully paid booking to pay', () => {
      const [record] = canonicalizeProfileTrips([booked({ amount_paid: 30000 })], today);
      expect(record.details.balance).toBe(0);
      expect(record.details.balanceActionable).toBe(false);
    });

    it('keeps the new fields off the public shape', () => {
      const publicRow = shapePublicTrips(canonicalizeProfileTrips([booked()], today))[0];
      expect(Object.keys(publicRow).sort()).toEqual(['location','startDate','status','tripName','tripSlug'].sort());
    });
  });
});
